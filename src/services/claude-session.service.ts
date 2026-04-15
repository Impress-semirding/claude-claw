import { mkdirSync, rmSync, existsSync, copyFileSync, readdirSync, cpSync, writeFileSync, createWriteStream } from 'fs';
import { resolve, join } from 'path';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { v4 as uuidv4 } from 'uuid';
import { appConfig } from '../config.js';
import { sessionDb, messageDb, groupDb, taskDb } from '../db.js';
import type { ISessionInfo, IStreamEvent, StreamEvent } from '../types.js';
import { broadcastNewMessage } from './ws.service.js';
import { getIsolator } from './workspace-isolator/factory.js';
import * as processRegistry from './process-registry.js';
import { ClawStreamProcessor } from './stream-processor.js';
import {
  categorizeError,
  calculateRetryDelay,
  shouldRetry,
  extractRetryAfterMs,
} from './retry.js';
import { agentPool } from './agent-pool.js';
import { runnerPool } from './runner-pool.js';
import { providerPool } from './provider-pool.js';
import { logger } from '../logger.js';
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';

const COMPACT_MESSAGE_THRESHOLD = appConfig.claude.compactThreshold || 50;

function shouldCompactSession(sessionId: string): boolean {
  const count = messageDb.countBySession(sessionId);
  return count > COMPACT_MESSAGE_THRESHOLD;
}

function buildCompactSummary(sessionId: string): string {
  const messages = messageDb.findBySession(sessionId, 20);
  const lines = messages.map((m) => {
    const role = m.role === 'assistant' ? 'Claude' : 'User';
    const text = m.content.slice(0, 500).replace(/\n/g, ' ');
    return `${role}: ${text}`;
  });
  return `Here is a summary of the recent conversation:\n\n${lines.join('\n')}`;
}

function buildCanUseTool(
  allowedTools?: string[],
  disallowedTools?: string[]
): CanUseTool | undefined {
  if (
    (!allowedTools || allowedTools.length === 0) &&
    (!disallowedTools || disallowedTools.length === 0)
  ) {
    return undefined;
  }

  return async (
    toolName: string,
    _input: Record<string, unknown>,
    _options: { signal: AbortSignal; toolUseID: string; agentID?: string }
  ): Promise<PermissionResult> => {
    logger.trace({ toolName, allowedTools, disallowedTools }, '[canUseTool] checking');
    if (disallowedTools && disallowedTools.length > 0 && disallowedTools.includes(toolName)) {
      logger.trace({ toolName }, '[canUseTool] DENY');
      return { behavior: 'deny', message: `Tool ${toolName} is disallowed by group policy` };
    }
    if (allowedTools && allowedTools.length > 0 && !allowedTools.includes(toolName)) {
      logger.trace({ toolName }, '[canUseTool] DENY');
      return { behavior: 'deny', message: `Tool ${toolName} is not in the allowed tools list` };
    }
    logger.trace({ toolName }, '[canUseTool] ALLOW');
    return { behavior: 'allow', updatedInput: {} };
  };
}

// Session registry for runtime tracking
const sessions = new Map<string, ISessionInfo & { abortController?: AbortController }>();

// Per-session async mutex to prevent concurrent queries on the same session
const sessionLocks = new Map<string, Promise<void>>();

function acquireSessionLock(sessionId: string, timeoutMs = 120000): Promise<() => void> {
  const prev = sessionLocks.get(sessionId) || Promise.resolve();
  let resolveNext: (() => void) | null = null;
  const next = new Promise<void>((resolve) => {
    resolveNext = resolve;
  });

  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      logger.warn({ sessionId, timeoutMs }, '[session] lock acquisition timed out, forcing release');
      if (resolveNext) {
        resolveNext();
      }
      resolve();
    }, timeoutMs);
  });

  sessionLocks.set(sessionId, prev.then(() => Promise.race([next, timeout])));
  return prev.then(() => resolveNext!);
}

// Generate session key
function sessionKey(userId: string, workspace: string, sessionId: string): string {
  return `${userId}:${workspace}:${sessionId}`;
}

// Create directory structure for session
function createSessionDirectories(userId: string, workspace: string, sessionId: string) {
  const group = groupDb.findById(workspace);
  const folder = group?.folder || workspace;

  // Shared group workspace for all sessions in this group
  const relativeWorkDir = folder;
  // Session-private directories remain isolated
  const relativeConfigDir = join(userId, workspace, sessionId, '.claude');
  const relativeTmpDir = join(userId, workspace, sessionId, 'tmp');
  const relativeUploadDir = join(userId, workspace, sessionId, 'upload-files');

  const absWorkDir = resolve(appConfig.claude.baseDir, relativeWorkDir);
  const absConfigDir = resolve(appConfig.claude.baseDir, relativeConfigDir);
  const absTmpDir = resolve(appConfig.claude.baseDir, relativeTmpDir);
  const absUploadDir = resolve(appConfig.claude.baseDir, relativeUploadDir);

  // Create directories
  mkdirSync(absWorkDir, { recursive: true });
  mkdirSync(absConfigDir, { recursive: true });
  mkdirSync(absTmpDir, { recursive: true });
  mkdirSync(absUploadDir, { recursive: true });

  // Copy template if exists (into shared workspace)
  if (appConfig.claude.templateDir && existsSync(appConfig.claude.templateDir)) {
    copyTemplateFiles(appConfig.claude.templateDir, absWorkDir);
  }

  return {
    relativeWorkDir,
    relativeConfigDir,
    relativeTmpDir,
    relativeUploadDir,
    absWorkDir,
    absConfigDir,
    absTmpDir,
    absUploadDir,
  };
}

// Copy template files
function copyTemplateFiles(templateDir: string, targetDir: string) {
  try {
    const files = readdirSync(templateDir);
    for (const file of files) {
      const srcPath = join(templateDir, file);
      const destPath = join(targetDir, file);
      if (!existsSync(destPath)) {
        copyFileSync(srcPath, destPath);
      }
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to copy template files');
  }
}

// Create new session
export async function createSession(
  userId: string,
  workspace: string,
  sessionId: string = uuidv4(),
  agentId?: string
): Promise<ISessionInfo> {
  const key = sessionKey(userId, workspace, sessionId);

  // Check if session already exists
  if (sessions.has(key)) {
    return sessions.get(key)!;
  }

  // Create directories
  const dirs = createSessionDirectories(userId, workspace, sessionId);

  // Create session info
  const session: ISessionInfo = {
    sessionId,
    userId,
    workspace,
    agentId,
    configDir: dirs.relativeConfigDir,
    workDir: dirs.relativeWorkDir,
    tmpDir: dirs.relativeTmpDir,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    status: 'idle',
  };

  // Save to database
  sessionDb.create({
    id: sessionId,
    userId,
    workspace,
    agentId,
    configDir: dirs.relativeConfigDir,
    workDir: dirs.relativeWorkDir,
    tmpDir: dirs.relativeTmpDir,
    status: 'idle',
  });

  // Register in memory
  sessions.set(key, session);

  return session;
}

// Get session
export function getSession(userId: string, workspace: string, sessionId: string): ISessionInfo | undefined {
  const key = sessionKey(userId, workspace, sessionId);
  return sessions.get(key);
}

// Get or create session
export async function getOrCreateSession(
  userId: string,
  workspace: string,
  sessionId?: string,
  agentId?: string
): Promise<ISessionInfo> {
  // 如果显式传了 sessionId，精确匹配或新建
  if (sessionId) {
    const existing = getSession(userId, workspace, sessionId);
    if (existing) {
      return existing;
    }
    return createSession(userId, workspace, sessionId, agentId);
  }

  // 未传 sessionId 时，复用该用户在该 workspace + agentId 下最新的 active session
  const candidates = listUserSessions(userId).filter(
    (s) =>
      s.workspace === workspace &&
      s.status !== 'destroyed' &&
      (s.agentId || undefined) === (agentId || undefined)
  );
  if (candidates.length > 0) {
    return candidates[0];
  }

  // 完全没有则新建
  const sid = uuidv4();
  return createSession(userId, workspace, sid, agentId);
}

// List user sessions
export function listUserSessions(userId: string): ISessionInfo[] {
  const result: ISessionInfo[] = [];
  for (const [key, session] of sessions.entries()) {
    if (key.startsWith(`${userId}:`)) {
      result.push(session);
    }
  }
  return result.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

// Destroy session
export function destroySession(userId: string, workspace: string, sessionId: string): boolean {
  const key = sessionKey(userId, workspace, sessionId);
  const session = sessions.get(key);

  if (!session) {
    return false;
  }

  // Abort running query if any
  if (session.abortController) {
    session.abortController.abort();
  }

  // Remove from memory
  sessions.delete(key);

  // Update database
  sessionDb.update(sessionId, { status: 'destroyed' });

  // Clean up ephemeral session directories only; configDir (.claude/) is preserved
  // so the SDK JSONL transcript survives idle cleanup and can be resumed after restart.
  // workDir is shared per group and is never deleted here.
  try {
    const absTmpDir = resolve(appConfig.claude.baseDir, session.tmpDir);
    const absIpcDir = resolve(appConfig.paths.logs, 'ipc', sessionId);
    if (existsSync(absTmpDir)) {
      rmSync(absTmpDir, { recursive: true, force: true });
    }
    if (existsSync(absIpcDir)) {
      rmSync(absIpcDir, { recursive: true, force: true });
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to cleanup session directory');
  }

  // Release any lingering session lock
  sessionLocks.delete(sessionId);

  return true;
}

// Abort running query
export function abortQuery(userId: string, workspace: string, sessionId: string): boolean {
  const key = sessionKey(userId, workspace, sessionId);
  const session = sessions.get(key);

  if (!session || !session.abortController) {
    return false;
  }

  session.abortController.abort();

  // Graceful interrupt via sentinel: runner will call stream.interrupt() instead of hard kill
  const ipcInputDir = resolve(appConfig.paths.logs, 'ipc', sessionId, 'input');
  try {
    mkdirSync(ipcInputDir, { recursive: true });
    writeFileSync(resolve(ipcInputDir, '_interrupt'), JSON.stringify({ timestamp: Date.now() }), 'utf-8');
  } catch (err) {
    logger.error({ sessionId, err }, '[claude-session] failed to write interrupt sentinel');
  }

  // Fallback hard-kill after a short grace period if the runner doesn't exit on its own
  setTimeout(() => {
    const stillActive = agentPool.getProcess(sessionId);
    if (stillActive && !stillActive.killed) {
      logger.warn({ sessionId }, '[claude-session] interrupt grace period expired, sending SIGTERM');
      agentPool.kill(sessionId, 'SIGTERM');
    }
  }, 3000);

  session.status = 'idle';
  sessionDb.update(sessionId, { status: 'idle' });

  return true;
}

// Query Claude with streaming
function syncSkillsToSession(userId: string, workspace: string, sessionConfigDir: string): void {
  const sessionSkillsDir = resolve(sessionConfigDir, 'skills');
  mkdirSync(sessionSkillsDir, { recursive: true });

  // Sync user-level skills
  const userSkillsDir = resolve(appConfig.dataDir, 'skills', userId);
  if (existsSync(userSkillsDir)) {
    for (const entry of readdirSync(userSkillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const src = join(userSkillsDir, entry.name);
      const dest = join(sessionSkillsDir, entry.name);
      if (existsSync(dest)) {
        rmSync(dest, { recursive: true, force: true });
      }
      cpSync(src, dest, { recursive: true });
    }
  }

  // Sync workspace-level skills
  const group = groupDb.findById(workspace);
  if (group) {
    const workspaceSkillsDir = resolve(appConfig.claude.baseDir, group.folder || group.id, '.claude', 'skills');
    if (existsSync(workspaceSkillsDir)) {
      for (const entry of readdirSync(workspaceSkillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const src = join(workspaceSkillsDir, entry.name);
        const dest = join(sessionSkillsDir, entry.name);
        if (existsSync(dest)) {
          rmSync(dest, { recursive: true, force: true });
        }
        cpSync(src, dest, { recursive: true });
      }
    }
  }
}

export async function* querySession({
  userId,
  workspace,
  sessionId,
  prompt,
  mcpServers = {} as Record<string, unknown>,
  systemPrompt,
  onStreamEvent,
  turnId,
  isMemoryFlush = false,
  agentOptions,
}: {
  userId: string;
  workspace: string;
  sessionId: string;
  prompt: string;
  mcpServers?: Record<string, unknown>;
  systemPrompt?: string;
  onStreamEvent?: (event: StreamEvent) => void;
  turnId?: string;
  isMemoryFlush?: boolean;
  agentOptions?: {
    maxTurns?: number;
    allowedTools?: string[];
    disallowedTools?: string[];
  };
}): AsyncGenerator<IStreamEvent> {
  const releaseLock = await acquireSessionLock(sessionId);
  let session: (ISessionInfo & { abortController?: AbortController }) | undefined;
  try {
    const key = sessionKey(userId, workspace, sessionId);
    session = sessions.get(key);

  // Auto-create session if not exists
  if (!session) {
    session = await createSession(userId, workspace, sessionId);
  }

  // Check if session is already running
  if (session.status === 'running') {
    throw new Error('Session is already running a query');
  }

  // Update status
  session.status = 'running';
  session.lastActiveAt = Date.now();
  sessionDb.update(sessionId, { status: 'running', last_active_at: session.lastActiveAt });

  // Migrate old sessions: workDir should be the shared group folder, not an isolated path
  const group = groupDb.findById(workspace);
  const expectedWorkDir = group?.folder || workspace;
  const groupConfig = group?.config;

  if (session.workDir !== expectedWorkDir) {
    session.workDir = expectedWorkDir;
    sessionDb.update(sessionId, { workDir: expectedWorkDir });
  }

  // Context compaction: if session has too many messages, reset SDK session
  const isCompacting = shouldCompactSession(sessionId);
  if (isCompacting) {
    logger.warn({ sessionId }, '[claude-session] compacting session message count exceeded threshold');
    session.sdkSessionId = undefined;
    session.lastAssistantUuid = undefined;
    sessionDb.update(sessionId, { sdk_session_id: undefined, last_assistant_uuid: undefined });
  }

  // Build absolute paths
  const absWorkDir = resolve(appConfig.claude.baseDir, session.workDir);
  const absConfigDir = resolve(appConfig.claude.baseDir, session.configDir);
  const absTmpDir = resolve(appConfig.claude.baseDir, session.tmpDir);

  // Ensure directories exist
  mkdirSync(absWorkDir, { recursive: true });
  mkdirSync(absConfigDir, { recursive: true });
  mkdirSync(absTmpDir, { recursive: true });
  syncSkillsToSession(userId, workspace, absConfigDir);

  // Create abort controller
  const abortController = new AbortController();
  session.abortController = abortController;

  // Select provider from the pool
  const selected = providerPool.selectProvider();
  const selectedProvider = selected?.provider;
  const selectedSecret = selected?.secret;
  const selectedProviderId = selectedProvider?.id;

  let baseUrl = selectedProvider?.anthropicBaseUrl || appConfig.claude.baseUrl;
  const model = selectedProvider?.anthropicModel || appConfig.claude.model || 'claude-sonnet-4-20250514';

  // The claude-agent-sdk appends /v1 to the base URL internally.
  // If the provider baseUrl already ends with /v1 (e.g. Kimi's https://api.kimi.com/coding/v1),
  // strip it to avoid double /v1 paths like /coding/v1/v1/messages.
  if (baseUrl && baseUrl.endsWith('/v1')) {
    baseUrl = baseUrl.slice(0, -3);
  }

  logger.info({ sessionId, providerId: selectedProviderId, baseUrl, model, hasAuth: !!(selectedSecret?.anthropicAuthToken || selectedSecret?.anthropicApiKey) }, '[claude-session] querySession start');

  // Prepare isolated workspace
  const isolator = getIsolator();
  await isolator.prepareWorkspace(sessionId, userId);

  // Build environment variables (whitelist only – never leak full host env to runner)
  const env: Record<string, string> = {
    CLAUDE_CONFIG_DIR: absConfigDir,
    CLAUDE_CODE_TMPDIR: absTmpDir,
    CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
    HOME: absConfigDir,
    MAX_MCP_OUTPUT_TOKENS: '50000',
    ANTHROPIC_BASE_URL: baseUrl,
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    NODE_OPTIONS: '--max-old-space-size=4096',
  };

  // Pass authentication from provider secrets
  if (selectedSecret?.anthropicAuthToken) {
    env.ANTHROPIC_API_KEY = selectedSecret.anthropicAuthToken;
    env.ANTHROPIC_AUTH_TOKEN = selectedSecret.anthropicAuthToken;
  }
  if (selectedSecret?.anthropicApiKey) {
    env.ANTHROPIC_API_KEY = selectedSecret.anthropicApiKey;
  }

  // Pass provider custom env
  if (selectedProvider?.customEnv) {
    for (const [k, v] of Object.entries(selectedProvider.customEnv)) {
      env[k] = v;
    }
  }

  // Build system prompt: use claude_code preset with custom content appended.
  // The preset injects the full Claude Code system prompt (tools, rules, CLAUDE.md from cwd).
  // Our custom content (user memory, agent prompt, group config) goes into `append`.
  const builtSystemPrompt: { type: 'preset'; preset: 'claude_code'; append?: string } = systemPrompt
    ? { type: 'preset', preset: 'claude_code', append: systemPrompt }
    : { type: 'preset', preset: 'claude_code' };

  // Effective tool constraints: agentOptions override groupConfig
  const effectiveAllowedTools = agentOptions?.allowedTools ?? groupConfig?.allowedTools;
  const effectiveDisallowedTools = agentOptions?.disallowedTools ?? groupConfig?.disallowedTools;

  // Build options
  const options: any = {
    cwd: absWorkDir,
    env,
    mcpServers,
    model,
    maxTurns: agentOptions?.maxTurns ?? appConfig.claude.maxTurns ?? 100,
    maxBudgetUsd: appConfig.claude.maxBudgetUsd || 10,
    permissionMode:
      effectiveAllowedTools?.length || effectiveDisallowedTools?.length
        ? 'default'
        : 'bypassPermissions',
    allowDangerouslySkipPermissions:
      !effectiveAllowedTools?.length && !effectiveDisallowedTools?.length,
    systemPrompt: builtSystemPrompt,
    thinking: { type: 'adaptive' },
    hooks: {
      PreCompact: [
        {
          type: 'command',
          command: `node -e "
const fs = require('fs');
const path = require('path');
const archiveDir = path.join('${absWorkDir}', 'conversations');
fs.mkdirSync(archiveDir, { recursive: true });
let data = '';
process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const transcriptPath = input.transcript_path || '';
    const agentId = input.agent_id || '';

    // Skip sub-agent compactions to avoid archiving unchanged transcripts
    if (agentId) process.exit(0);

    let messages = [];
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'user' && entry.message && entry.message.content) {
            const c = entry.message.content;
            const text = typeof c === 'string' ? c : c.filter(x => x.type === 'text').map(x => x.text).join('');
            if (text.trim()) messages.push({ role: 'user', content: text });
          } else if (entry.type === 'assistant' && entry.message && entry.message.content) {
            const text = entry.message.content.filter(x => x.type === 'text').map(x => x.text).join('');
            if (text.trim()) messages.push({ role: 'assistant', content: text });
          }
        } catch {}
      }
    }

    // 1. Archive as Markdown
    if (messages.length > 0) {
      const date = new Date().toISOString().split('T')[0];
      const mdFile = path.join(archiveDir, date + '-session.md');
      const mdLines = ['# Conversation', '', 'Archived: ' + new Date().toLocaleString(), '', '---', ''];
      for (const msg of messages) {
        const sender = msg.role === 'user' ? 'User' : 'Claude';
        const content = msg.content.length > 2000 ? msg.content.slice(0, 2000) + '...' : msg.content;
        mdLines.push('**' + sender + '**: ' + content.replace(/\\n/g, ' '), '');
      }
      try { fs.writeFileSync(mdFile, mdLines.join('\\n'), 'utf-8'); } catch {}
    }

    // 2. Trim JSONL: remove entries before last compact_boundary
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      try {
        const rawLines = fs.readFileSync(transcriptPath, 'utf-8').split('\\n').filter(l => l.trim());
        let lastBoundary = -1;
        for (let i = rawLines.length - 1; i >= 0; i--) {
          try {
            const e = JSON.parse(rawLines[i]);
            if (e.type === 'system' && e.subtype === 'compact_boundary') { lastBoundary = i; break; }
          } catch {}
        }
        if (lastBoundary > 50) {
          const trimmed = rawLines.slice(lastBoundary).join('\\n') + '\\n';
          const tmp = transcriptPath + '.trim-tmp';
          fs.writeFileSync(tmp, trimmed, 'utf-8');
          fs.renameSync(tmp, transcriptPath);
        }
      } catch {}
    }
  } catch {}
});
"`,
        },
      ],
    },
    spawnClaudeCodeProcess: (spawnOpts: any) => {
      logger.trace({ command: spawnOpts.command, args: spawnOpts.args?.slice(0, 5) }, '[claude-session] spawnClaudeCodeProcess');
      const proc = isolator.spawn({
        ...spawnOpts,
        workspaceId: sessionId,
        userId,
      });
      proc.stdout?.on('data', (data: Buffer) => {
        logger.trace({ chunk: data.toString().slice(0, 500) }, '[claude-session] spawn stdout');
      });
      proc.stderr?.on('data', (data: Buffer) => {
        logger.trace({ chunk: data.toString().slice(0, 500) }, '[claude-session] spawn stderr');
      });
      proc.on('exit', (code, signal) => {
        logger.info({ code, signal }, '[claude-session] spawn exit');
      });
      const processId = proc.pid?.toString() || `${userId}-${sessionId}-${Date.now()}`;
      processRegistry.registerProcess(processId, proc, workspace, userId);
      return proc;
    },
  };

  // Add user global dir as additional directory so the preset picks up CLAUDE.md from there
  const userGlobalDir = resolve(appConfig.dataDir, 'groups', 'user-global', userId);
  mkdirSync(userGlobalDir, { recursive: true });
  const userGlobalClaudeMd = resolve(userGlobalDir, 'CLAUDE.md');
  if (!existsSync(userGlobalClaudeMd)) {
    writeFileSync(userGlobalClaudeMd, [
      '# 用户全局记忆',
      '',
      '## 用户身份',
      '- 姓名：待记录',
      '- 职业/角色：待记录',
      '- 技术栈偏好：待记录',
      '',
      '## 长期偏好',
      '- 沟通风格：待记录',
      '- 称呼方式：待记录',
      '- 喜好：待记录',
      '- 厌恶：待记录',
      '',
      '## 常用项目与上下文',
      '- 待记录',
      '',
      '## 其他需要记住的信息',
      '- 待记录',
      '',
    ].join('\n'), 'utf-8');
  }
  const memoryDir = resolve(appConfig.dataDir, 'memory', userId);
  mkdirSync(memoryDir, { recursive: true });
  options.additionalDirectories = [userGlobalDir];

  // Resume SDK session unless compacting
  if (!isCompacting && session.sdkSessionId) {
    options.resume = session.sdkSessionId;
    if (session.lastAssistantUuid) {
      options.resumeSessionAt = session.lastAssistantUuid;
    }
  }

  // Enable partial message recovery and agent progress tracking
  options.includePartialMessages = true;
  options.agentProgressSummaries = true;
  options.settingSources = ['project', 'user'];

  // Tool loop controls
  const canUseTool = buildCanUseTool(effectiveAllowedTools, effectiveDisallowedTools);
  if (canUseTool) {
    options.canUseTool = canUseTool;
  }
  if (effectiveAllowedTools && effectiveAllowedTools.length > 0) {
    options.allowedTools = effectiveAllowedTools;
  }
  if (effectiveDisallowedTools && effectiveDisallowedTools.length > 0) {
    options.disallowedTools = effectiveDisallowedTools;
  }

  // Only pass sandbox option when explicitly enabled;
  // passing sandbox: { enabled: false } causes the SDK to hang on macOS
  if (appConfig.claude.sandboxEnabled) {
    // Resolve the users data root — all user session dirs live under here.
    // We deny access to the entire baseDir tree, then explicitly re-allow
    // only the current session's workspace so Claude cannot read/write
    // other users' files even if asked to.
    const absBaseDir = resolve(appConfig.claude.baseDir);
    options.sandbox = {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      filesystem: {
        // Whitelist: current session workspace + config dir + tmp dir
        allowRead: [
          absWorkDir,
          `${absWorkDir}/**`,
          absConfigDir,
          `${absConfigDir}/**`,
          absTmpDir,
          `${absTmpDir}/**`,
        ],
        allowWrite: [
          absWorkDir,
          `${absWorkDir}/**`,
          absConfigDir,
          `${absConfigDir}/**`,
          absTmpDir,
          `${absTmpDir}/**`,
        ],
        // Blacklist: entire users data directory — covers all other users
        denyRead:  [absBaseDir, `${absBaseDir}/**`],
        denyWrite: [absBaseDir, `${absBaseDir}/**`],
      },
    };
  }

  // Build prompt: prepend compact summary if compacting.
  // systemPrompt is now handled via the claude_code preset (options.systemPrompt.append).
  let fullPrompt = prompt;
  if (isCompacting) {
    const compactSummary = buildCompactSummary(sessionId);
    fullPrompt = `${compactSummary}\n\n${fullPrompt}`;
  } else if (!session.sdkSessionId && !isMemoryFlush) {
    // No SDK transcript available (new session or transcript was lost).
    // Inject the last N DB messages so Claude can answer history questions
    // like "我今天问过哪几个问题" even without a live transcript.
    const recentMsgs = messageDb.findBySession(sessionId, 30);
    if (recentMsgs.length > 0) {
      const historyLines = recentMsgs.map((m) => {
        const role = m.role === 'assistant' ? 'Claude' : '用户';
        const text = (m.content || '').length > 500
          ? (m.content || '').slice(0, 500) + '…'
          : (m.content || '');
        return `[${role}]: ${text}`;
      });
      const historyBlock = [
        '<conversation-history>',
        '以下是本次会话的历史消息记录（最近 ' + recentMsgs.length + ' 条），供你回答历史相关问题时参考：',
        '',
        historyLines.join('\n'),
        '</conversation-history>',
      ].join('\n');
      fullPrompt = `${historyBlock}\n\n${fullPrompt}`;
    }
  }

  // Build runner path with runtime detection (dist first, then dev fallback)
  const distRunnerPath = resolve(process.cwd(), 'dist/agent-runner-v2/index.js');
  const devRunnerPath = resolve(process.cwd(), 'src/agent-runner-v2/index.ts');

  if (appConfig.nodeEnv === 'production' && !existsSync(distRunnerPath)) {
    throw new Error('Production runner not found at dist/agent-runner-v2/index.js. Please run npm run build.');
  }
  const runnerPath = existsSync(distRunnerPath) ? distRunnerPath : devRunnerPath;

  // Ensure IPC directory exists for mid-query injection (monitored by runner)
  const ipcInputDir = resolve(appConfig.paths.logs, 'ipc', sessionId, 'input');
  mkdirSync(ipcInputDir, { recursive: true });

  // Serialize options: strip non-serializable functions that will be rebuilt in runner
  const serializableOptions: any = { ...options };
  delete serializableOptions.canUseTool;
  delete serializableOptions.spawnClaudeCodeProcess;

  // TypeScript cannot narrow `session` inside nested closures; assert non-null once here.
  const resolvedSession = session!;

  // ── Shared stream-consumer logic ──────────────────────────────────────────
  // Extracted so both the persistent-runner path and the fallback spawn path
  // can reuse the exact same message-dispatch code.
  // Returns true if at least one assistant message was produced (used by retry logic).
  async function* consumeRunnerLines(
    lineSource: AsyncIterable<string>,
    runnerStartTs: number,
    killRunner: () => void,
    onAssistantOutput: () => void,
  ): AsyncGenerator<IStreamEvent> {
    const processor = onStreamEvent
      ? new ClawStreamProcessor(onStreamEvent, turnId || `turn-${Date.now()}`)
      : null;
    let streamError: string | null = null;

    const STATUS_SLOW_MS = Math.min(15000, appConfig.claude.firstTokenTimeoutMs);
    const FIRST_TOKEN_KILL_MS = appConfig.claude.firstTokenTimeoutMs;
    let firstTokenReceived = false;
    let killedByFirstTokenTimeout = false;

    const slowStatusTimer = setTimeout(() => {
      onStreamEvent?.({ eventType: 'status', statusText: '模型响应较慢，请稍候…', turnId: turnId || `turn-${Date.now()}` });
    }, STATUS_SLOW_MS);

    const firstTokenKillTimer = setTimeout(() => {
      killedByFirstTokenTimeout = true;
      logger.error({ sessionId, timeoutMs: FIRST_TOKEN_KILL_MS }, '[claude-session] first token timeout reached, killing runner');
      killRunner();
    }, FIRST_TOKEN_KILL_MS);

    for await (const line of lineSource) {
      if (!firstTokenReceived) {
        firstTokenReceived = true;
        clearTimeout(slowStatusTimer);
        clearTimeout(firstTokenKillTimer);
        if (selectedProviderId) {
          providerPool.reportLatency(selectedProviderId, Date.now() - runnerStartTs);
        }
      }
      if (abortController.signal.aborted) {
        yield { type: 'error', error: 'Query aborted by user', timestamp: Date.now() };
        break;
      }

      const trimmed = line.trim();
      if (!trimmed || trimmed === '__CLAW_END__') {
        if (trimmed === '__CLAW_END__') break;
        continue;
      }

      let message: any;
      try {
        message = JSON.parse(trimmed);
      } catch {
        logger.error({ sessionId, line: trimmed.slice(0, 200) }, '[claude-session] Failed to parse runner output line');
        continue;
      }

      if (message.__runner_error__) {
        streamError = message.error || 'Agent runner error';
        yield { type: 'error', error: streamError || 'Agent runner error', timestamp: Date.now() };
        continue;
      }

      if (message.__claw_event__) {
        const { __claw_event__, ...event } = message;
        if (event.eventType === 'init' && (event.sessionId || event.session_id)) {
          const sid = event.sessionId || event.session_id;
          resolvedSession.sdkSessionId = sid;
          sessionDb.update(sessionId, { sdk_session_id: sid });
        }
        onStreamEvent?.(event as StreamEvent);
        continue;
      }

      if (message.type === 'result') {
        if (message.is_error) {
          yield { type: 'error', error: message.result || 'Claude Code error', timestamp: Date.now() };
        }
        // Persist SDK session ID from result marker (persistent mode emits this)
        if (message.session_id) {
          if (message.session_id !== resolvedSession.sdkSessionId) {
            resolvedSession.sdkSessionId = message.session_id;
            sessionDb.update(sessionId, { sdk_session_id: message.session_id });
          }
          if (message.last_assistant_uuid) {
            resolvedSession.lastAssistantUuid = message.last_assistant_uuid;
            sessionDb.update(sessionId, { last_assistant_uuid: message.last_assistant_uuid });
          }
        }
        continue;
      }

      if (message.type === 'system' && message.subtype === 'init') {
        resolvedSession.sdkSessionId = message.session_id;
        sessionDb.update(sessionId, { sdk_session_id: message.session_id });
      }

      if (processor) {
        processor.processMessage(message);
        if (message.type === 'assistant') onAssistantOutput();
        if (message.type === 'error') {
          yield { type: 'error', error: message.error || 'Unknown error', timestamp: Date.now() };
        }
        continue;
      }

      // Backwards-compatible path when no onStreamEvent provided
      let content: string | undefined = message.content;
      if (message.type === 'assistant' && !content && message.message) {
        const msgContent = message.message.content;
        if (Array.isArray(msgContent)) {
          content = msgContent.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
        } else if (typeof msgContent === 'string') {
          content = msgContent;
        }
      }
      if (message.type === 'assistant') onAssistantOutput();

      yield {
        type: message.type as IStreamEvent['type'],
        subtype: message.subtype,
        content,
        tool_name: message.tool_name || message.message?.tool_name,
        tool_input: message.tool_input || message.message?.tool_input,
        tool_output: message.tool_output,
        error: message.error,
        session_id: message.session_id || resolvedSession.sdkSessionId,
        timestamp: Date.now(),
      };
    }

    clearTimeout(slowStatusTimer);
    clearTimeout(firstTokenKillTimer);

    if (killedByFirstTokenTimeout) {
      throw new Error('First token timeout after 30s');
    }

    if (processor) {
      processor.cleanup();
      const fullText = processor.getFullText();
      if (fullText) {
        yield { type: 'assistant', content: fullText, timestamp: Date.now() };
        onAssistantOutput();
      }
    }

    if (streamError) throw new Error(streamError);
  }

  // Retry loop for spawning agent runner and consuming stream (covers both stage 1 & stage 2)
  const MAX_RETRIES = 3;
  const QUERY_HARD_TIMEOUT_MS = appConfig.claude.queryHardTimeoutMs;
  let lastError: Error | null = null;
  let proc: ReturnType<typeof spawn> | null = null;
  let runnerLogStream: ReturnType<typeof createWriteStream> | null = null;
  let streamConsumed = false;
  let hadAssistantOutput = false;

  // Build the runner input JSON once (re-built per attempt below for resume options)
  const buildRunnerInput = (attemptOptions: any) => JSON.stringify({
    prompt: fullPrompt,
    options: attemptOptions,
    ipcDir: ipcInputDir,
    allowedTools: agentOptions?.allowedTools ?? groupConfig?.allowedTools,
    disallowedTools: agentOptions?.disallowedTools ?? groupConfig?.disallowedTools,
    mcpEnv: {
      userId,
      chatJid: workspace,
      workspaceDir: absWorkDir,
      userGlobalPath: resolve(appConfig.dataDir, 'groups', 'user-global', userId, 'CLAUDE.md'),
      memoryDir,
      groupConfig,
      isHome: true,
    },
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.trace({ sessionId, attempt }, '[claude-session] acquiring pool slot attempt');
      await agentPool.acquire(sessionId, 30000);

      // Re-build resume options on every attempt so previous mutations don't leak
      const attemptOptions: any = { ...serializableOptions };
      if (!isCompacting && session.sdkSessionId) {
        attemptOptions.resume = session.sdkSessionId;
        if (session.lastAssistantUuid) {
          attemptOptions.resumeSessionAt = session.lastAssistantUuid;
        }
      }
      const runnerInput = buildRunnerInput(attemptOptions);
      const runnerStartTs = Date.now();

      // ── Path A: persistent runner pool ────────────────────────────────────
      const usePersistent = runnerPool.totalCount > 0;
      if (usePersistent) {
        logger.info({ sessionId, idle: runnerPool.idleCount, total: runnerPool.totalCount }, '[claude-session] using persistent runner');
        const entry = await runnerPool.acquire(30000);

        // Hard timeout aborts the query by releasing the runner
        const hardTimeout = setTimeout(() => {
          logger.error({ sessionId }, '[claude-session] hard timeout reached, releasing persistent runner');
          runnerPool.release(entry);
        }, QUERY_HARD_TIMEOUT_MS);

        try {
          await runnerPool.sendQuery(entry, runnerInput);
          const lineSource = runnerPool.readUntilEnd(entry);
          yield* consumeRunnerLines(lineSource, runnerStartTs, () => runnerPool.release(entry), () => { hadAssistantOutput = true; });
        } finally {
          clearTimeout(hardTimeout);
          runnerPool.release(entry);
          agentPool.release(sessionId);
        }

      } else {
        // ── Path B: fallback — spawn a fresh runner process (original logic) ──
        const isTs = runnerPath.endsWith('.ts');
        const command = isTs ? resolve(process.cwd(), 'node_modules/.bin/tsx') : 'node';
        logger.info({ sessionId, command, runnerPath, workspace }, '[claude-session] spawning agent runner (fallback)');

        const runnerLogPath = resolve(appConfig.paths.logs, `runner-${sessionId}.log`);
        runnerLogStream = createWriteStream(runnerLogPath, { flags: 'a' });

        const runnerEnv: Record<string, string> = {
          ...env,
          HAPPYCLAW_WORKSPACE_GROUP: absWorkDir,
          HAPPYCLAW_WORKSPACE_GLOBAL: userGlobalDir,
          HAPPYCLAW_WORKSPACE_MEMORY: memoryDir,
          HAPPYCLAW_WORKSPACE_IPC: resolve(appConfig.paths.logs, 'ipc', sessionId),
        };
        proc = isolator.spawn({
          command,
          args: [runnerPath],
          cwd: process.cwd(),
          env: runnerEnv,
          signal: abortController.signal,
          workspaceId: sessionId,
          userId,
        });

        agentPool.bind(sessionId, proc);
        const processId = `${userId}-${sessionId}-${Date.now()}`;
        processRegistry.registerProcess(processId, proc, workspace, userId);

        proc.on('exit', (code, signal) => {
          logger.info({ sessionId, code, signal, pid: proc?.pid }, '[claude-session] agent runner exited');
        });
        proc.on('error', (err) => {
          logger.error({ sessionId, error: err.message }, '[claude-session] agent runner process error');
        });

        // Safe stdin write
        await new Promise<void>((resolve, reject) => {
          if (!proc!.stdin) { reject(new Error('Agent runner stdin is not available')); return; }
          proc!.stdin.on('error', (err) => {
            logger.error({ sessionId, error: err.message }, '[claude-session] runner stdin error');
          });
          proc!.stdin.write(runnerInput, (err) => {
            if (err) { reject(err); return; }
            proc!.stdin!.end();
            logger.trace({ sessionId, inputBytes: runnerInput.length }, '[claude-session] runner stdin write complete');
            resolve();
          });
        });

        // Quick sanity check: if process exits within 500ms, treat as spawn failure
        await new Promise<void>((resolve, reject) => {
          const onExitEarly = (code: number | null) => reject(new Error(`Agent runner exited immediately with code ${code}`));
          proc!.once('exit', onExitEarly);
          setTimeout(() => { proc!.off('exit', onExitEarly); resolve(); }, 500);
        });

        // Startup heartbeat
        let startupHeartbeatReceived = false;
        const startupHeartbeatTimer = setTimeout(() => {
          if (!startupHeartbeatReceived) {
            logger.error({ sessionId }, '[claude-session] startup heartbeat timeout, killing runner');
            try { proc!.kill('SIGKILL'); } catch {}
          }
        }, 5000);

        // Wire up stderr forwarding
        let stderrBuffer = '';
        proc.stderr?.on('data', (data: Buffer) => {
          if (!startupHeartbeatReceived) {
            startupHeartbeatReceived = true;
            clearTimeout(startupHeartbeatTimer);
          }
          runnerLogStream?.write(data);
          stderrBuffer += data.toString('utf-8');
          let newlineIndex: number;
          while ((newlineIndex = stderrBuffer.indexOf('\n')) !== -1) {
            const line = stderrBuffer.slice(0, newlineIndex);
            stderrBuffer = stderrBuffer.slice(newlineIndex + 1);
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('{')) {
              try {
                const logMsg = JSON.parse(trimmed);
                if (logMsg.source === 'agent-runner' && typeof logMsg.msg === 'string') {
                  const logLevel = ['trace', 'debug', 'info', 'warn', 'error'].includes(logMsg.level) ? logMsg.level : 'info';
                  (logger as any)[logLevel]({ sessionId, ...logMsg }, '[agent-runner]');
                  continue;
                }
                if (logMsg.__mcp__) {
                  const mcp = logMsg;
                  if (mcp.type === 'send_message') {
                    const msgId = uuidv4();
                    const ts = new Date().toISOString();
                    messageDb.create({ id: msgId, sessionId, userId: '__assistant__', role: 'assistant', content: mcp.content, metadata: { senderName: 'Claude', timestamp: ts, sourceKind: 'mcp_send_message' } });
                    broadcastNewMessage(mcp.chatJid, { id: msgId, chat_jid: mcp.chatJid, sender: '__assistant__', sender_name: 'Claude', content: mcp.content, timestamp: ts, is_from_me: true, sdk_message_uuid: null, source_kind: 'mcp_send_message' });
                  } else if (mcp.type === 'schedule_task') {
                    const taskId = uuidv4();
                    taskDb.create({ id: taskId, name: mcp.name, description: '', cron: mcp.cron, prompt: mcp.prompt, groupId: mcp.chatJid, enabled: true });
                    logger.info({ sessionId, taskId }, '[claude-session] scheduled task via MCP');
                  }
                  continue;
                }
              } catch { /* not JSON */ }
            }
            logger.info({ sessionId, line: trimmed }, '[agent-runner] stderr');
          }
        });

        if (!proc.stdout) throw new Error('Agent runner stdout is not available');
        const rl = createInterface({ input: proc.stdout });

        const hardTimeout = setTimeout(() => {
          logger.error({ sessionId }, '[claude-session] hard timeout reached, killing runner');
          try { proc!.kill('SIGKILL'); } catch {}
        }, QUERY_HARD_TIMEOUT_MS);

        try {
          yield* consumeRunnerLines(rl, runnerStartTs, () => { try { proc!.kill('SIGKILL'); } catch {} }, () => { hadAssistantOutput = true; });
        } finally {
          clearTimeout(hardTimeout);
          clearTimeout(startupHeartbeatTimer);
          runnerLogStream?.end();
          runnerLogStream = null;
        }
      }

      logger.trace({ sessionId, hadAssistantOutput }, '[claude-session] runner stream ended');

      yield { type: 'complete', timestamp: Date.now(), hadCompaction: isCompacting, isMemoryFlush } as IStreamEvent & { hadCompaction?: boolean; isMemoryFlush?: boolean };
      session.status = 'idle';
      sessionDb.update(sessionId, { status: 'idle' });
      streamConsumed = true;
      if (selectedProviderId) providerPool.reportSuccess(selectedProviderId);
      break; // Success

    } catch (err) {
      const category = categorizeError(err);
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.error({ sessionId, attempt, category, error: lastError.message }, '[claude-session] attempt failed');

      if (proc) {
        try { proc.kill('SIGKILL'); } catch {}
        agentPool.release(sessionId);
        proc = null;
      }
      runnerLogStream?.end();
      runnerLogStream = null;

      if (abortController.signal.aborted) break;

      if (hadAssistantOutput) {
        logger.info({ sessionId }, '[claude-session] assistant output already produced, skipping retry');
        break;
      }

      if (!shouldRetry(category, attempt, MAX_RETRIES)) break;

      const retryAfterMs = extractRetryAfterMs(err);
      const delayMs = calculateRetryDelay(attempt, category, retryAfterMs);
      if (onStreamEvent && attempt < MAX_RETRIES) {
        onStreamEvent({ eventType: 'status', statusText: `API 重试中 (${attempt}/${MAX_RETRIES})`, turnId: turnId || `turn-${Date.now()}` });
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (!streamConsumed) {
    session.status = 'error';
    sessionDb.update(sessionId, { status: 'error' });
    const errorMsg = lastError?.message || 'Claude query failed';
    logger.error({ sessionId, error: errorMsg }, '[claude-session] querySession exhausted retries');
    yield { type: 'error', error: errorMsg, timestamp: Date.now() };
    if (selectedProviderId) {
      providerPool.reportError(selectedProviderId);
    }
  }

  // Clean up abort controller, IPC directory and release pool slot
  session.abortController = undefined;
  if (proc && !proc.killed) {
    try { proc.kill('SIGTERM'); } catch {}
  }
  agentPool.release(sessionId);
  } finally {
    // Safety net: if the generator was abandoned (consumer broke the for-await loop)
    // or an uncaught error occurred before status was reset, don't leave the session
    // stuck in 'running' — otherwise every subsequent message gets rejected.
    if (session && session.status === 'running') {
      session.status = 'idle';
      sessionDb.update(sessionId, { status: 'idle' });
    }
    releaseLock();
  }
}

// Save user message
export function saveUserMessage(
  userId: string,
  sessionId: string,
  content: string,
  attachments?: unknown[],
  messageId?: string,
  metadata?: Record<string, unknown>
) {
  messageDb.create({
    id: messageId || uuidv4(),
    sessionId,
    userId,
    role: 'user',
    content,
    attachments: attachments as { id: string; name: string; type: string; size: number; path: string }[] | undefined,
    metadata,
  });
}

// Get session messages
export function getSessionMessages(sessionId: string, limit = 100) {
  return messageDb.findBySession(sessionId, limit);
}

// Cleanup idle sessions
export function cleanupIdleSessions(): number {
  const now = Date.now();
  const maxIdleMs = appConfig.claude.maxIdleMs;
  let cleaned = 0;

  for (const [key, session] of sessions.entries()) {
    if (session.status === 'idle' && now - session.lastActiveAt > maxIdleMs) {
      const [userId, workspace, sessionId] = key.split(':');
      destroySession(userId, workspace, sessionId);
      cleaned++;
    }
  }

  return cleaned;
}

// Load sessions from database on startup
export function loadSessionsFromDb() {
  const dbSessions = sessionDb.findByUser(''); // Get all sessions
  for (const row of dbSessions) {
    if (row.status !== 'destroyed') {
      const key = sessionKey(row.userId as string, row.workspace as string, row.id as string);
      const group = groupDb.findById(row.workspace as string);
      const expectedWorkDir = group?.folder || (row.workspace as string);
      const workDir = (row.workDir as string) === expectedWorkDir ? (row.workDir as string) : expectedWorkDir;
      const normalizedStatus = row.status === 'running' || row.status === 'error' ? 'idle' : (row.status as ISessionInfo['status']);
      if (normalizedStatus !== row.status) {
        sessionDb.update(row.id as string, { status: normalizedStatus });
      }
      sessions.set(key, {
        sessionId: row.id as string,
        userId: row.userId as string,
        workspace: row.workspace as string,
        agentId: (row.agentId as string | undefined) || undefined,
        sdkSessionId: row.sdkSessionId as string | undefined,
        lastAssistantUuid: row.lastAssistantUuid as string | undefined,
        configDir: row.configDir as string,
        workDir,
        tmpDir: row.tmpDir as string,
        createdAt: row.createdAt as number,
        lastActiveAt: row.lastActiveAt as number,
        status: normalizedStatus,
      });
    }
  }
}
