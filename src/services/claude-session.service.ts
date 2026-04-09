import { mkdirSync, rmSync, existsSync, copyFileSync, readdirSync, readFileSync, cpSync, watch, unlinkSync } from 'fs';
import { resolve, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { appConfig } from '../config.js';
import { sessionDb, messageDb, groupDb } from '../db.js';
import type { ISessionInfo, IStreamEvent, StreamEvent } from '../types.js';
import { getIsolator } from './workspace-isolator/factory.js';
import * as processRegistry from './process-registry.js';
import { ClawStreamProcessor } from './stream-processor.js';
import { readFileCached, setCachedFile } from '../utils/file-cache.js';
import {
  categorizeError,
  calculateRetryDelay,
  shouldRetry,
  extractRetryAfterMs,
} from './retry.js';
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';

interface ProviderRecord {
  id: string;
  enabled: boolean;
  anthropicBaseUrl: string;
  anthropicModel: string;
}

interface ProviderSecretRecord {
  anthropicAuthToken?: string | null;
  anthropicApiKey?: string | null;
}

function readProviders(): ProviderRecord[] {
  const p = resolve(appConfig.dataDir, 'config', 'claude-providers.json');
  if (!existsSync(p)) return [];
  const cached = readFileCached(p, 5000);
  if (cached !== null) {
    try {
      return JSON.parse(cached) as ProviderRecord[];
    } catch {
      return [];
    }
  }
  try {
    const content = readFileSync(p, 'utf-8');
    setCachedFile(p, content);
    return JSON.parse(content) as ProviderRecord[];
  } catch {
    return [];
  }
}

function readSecrets(): Record<string, ProviderSecretRecord> {
  const p = resolve(appConfig.dataDir, 'config', 'claude-secrets.json');
  if (!existsSync(p)) return {};
  const cached = readFileCached(p, 5000);
  if (cached !== null) {
    try {
      return JSON.parse(cached) as Record<string, ProviderSecretRecord>;
    } catch {
      return {};
    }
  }
  try {
    const content = readFileSync(p, 'utf-8');
    setCachedFile(p, content);
    return JSON.parse(content) as Record<string, ProviderSecretRecord>;
  } catch {
    return {};
  }
}

function getActiveProvider(): { provider?: ProviderRecord; secret?: ProviderSecretRecord } {
  const providers = readProviders();
  const active = providers.find((p) => p.enabled) || providers[0];
  if (!active) return {};
  const secrets = readSecrets();
  return { provider: active, secret: secrets[active.id] };
}

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
    console.log('[canUseTool] checking', toolName, 'allowed=', allowedTools, 'disallowed=', disallowedTools);
    if (disallowedTools && disallowedTools.length > 0 && disallowedTools.includes(toolName)) {
      console.log('[canUseTool] DENY', toolName);
      return { behavior: 'deny', message: `Tool ${toolName} is disallowed by group policy` };
    }
    if (allowedTools && allowedTools.length > 0 && !allowedTools.includes(toolName)) {
      console.log('[canUseTool] DENY', toolName);
      return { behavior: 'deny', message: `Tool ${toolName} is not in the allowed tools list` };
    }
    console.log('[canUseTool] ALLOW', toolName);
    return { behavior: 'allow', updatedInput: {} };
  };
}

// Session registry for runtime tracking
const sessions = new Map<string, ISessionInfo & { abortController?: AbortController }>();

// Lazy load Claude SDK
let claudeQueryModule: typeof import('@anthropic-ai/claude-agent-sdk') | null = null;

async function loadClaudeQuery() {
  if (!claudeQueryModule) {
    claudeQueryModule = await import('@anthropic-ai/claude-agent-sdk');
  }
  return claudeQueryModule.query;
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
    console.warn('Failed to copy template files:', error);
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

  // Clean up isolated session directories only; workDir is shared per group
  try {
    const absConfigDir = resolve(appConfig.claude.baseDir, session.configDir);
    const absTmpDir = resolve(appConfig.claude.baseDir, session.tmpDir);
    if (existsSync(absConfigDir)) {
      rmSync(absConfigDir, { recursive: true, force: true });
    }
    if (existsSync(absTmpDir)) {
      rmSync(absTmpDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn('Failed to cleanup session directory:', error);
  }

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
  const key = sessionKey(userId, workspace, sessionId);
  let session = sessions.get(key);

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
    console.log('[claude-session] compacting session', sessionId, 'message count exceeded threshold');
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

  // Read active provider configuration
  const { provider: activeProvider, secret: activeSecret } = getActiveProvider();
  let baseUrl = activeProvider?.anthropicBaseUrl || appConfig.claude.baseUrl;
  const model = activeProvider?.anthropicModel || appConfig.claude.model || 'claude-sonnet-4-20250514';

  // The claude-agent-sdk appends /v1 to the base URL internally.
  // If the provider baseUrl already ends with /v1 (e.g. Kimi's https://api.kimi.com/coding/v1),
  // strip it to avoid double /v1 paths like /coding/v1/v1/messages.
  if (baseUrl && baseUrl.endsWith('/v1')) {
    baseUrl = baseUrl.slice(0, -3);
  }

  console.log('[claude-session] querySession start', { sessionId, baseUrl, model, hasAuth: !!(activeSecret?.anthropicAuthToken || activeSecret?.anthropicApiKey) });

  // Prepare isolated workspace
  const isolator = getIsolator();
  await isolator.prepareWorkspace(sessionId, userId);

  // Build environment variables
  const env: Record<string, string> = {
    ...process.env,
    CLAUDE_CONFIG_DIR: absConfigDir,
    CLAUDE_CODE_TMPDIR: absTmpDir,
    CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
    HOME: absConfigDir,
    MAX_MCP_OUTPUT_TOKENS: '50000',
    ANTHROPIC_BASE_URL: baseUrl,
  };

  // Pass authentication from provider secrets
  if (activeSecret?.anthropicAuthToken) {
    env.ANTHROPIC_API_KEY = activeSecret.anthropicAuthToken;
    env.ANTHROPIC_AUTH_TOKEN = activeSecret.anthropicAuthToken;
  }
  if (activeSecret?.anthropicApiKey) {
    env.ANTHROPIC_API_KEY = activeSecret.anthropicApiKey;
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
      console.log('[claude-session] spawnClaudeCodeProcess', spawnOpts.command, spawnOpts.args?.slice(0, 5));
      const proc = isolator.spawn({
        ...spawnOpts,
        workspaceId: sessionId,
        userId,
      });
      proc.stdout?.on('data', (data: Buffer) => {
        console.log('[claude-session] spawn stdout:', data.toString().slice(0, 500));
      });
      proc.stderr?.on('data', (data: Buffer) => {
        console.error('[claude-session] spawn stderr:', data.toString().slice(0, 500));
      });
      proc.on('exit', (code, signal) => {
        console.log('[claude-session] spawn exit', { code, signal });
      });
      const processId = proc.pid?.toString() || `${userId}-${sessionId}-${Date.now()}`;
      processRegistry.registerProcess(processId, proc, workspace, userId);
      return proc;
    },
  };

  // Add user global dir as additional directory so the preset picks up CLAUDE.md from there
  const userGlobalDir = resolve(appConfig.dataDir, 'groups', 'user-global', userId);
  mkdirSync(userGlobalDir, { recursive: true });
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
    options.sandbox = {
      enabled: true,
      autoAllowBashIfSandboxed: true,
    };
  }

  // Build prompt: prepend compact summary if compacting.
  // systemPrompt is now handled via the claude_code preset (options.systemPrompt.append).
  let fullPrompt = prompt;
  if (isCompacting) {
    const compactSummary = buildCompactSummary(sessionId);
    fullPrompt = `${compactSummary}\n\n${fullPrompt}`;
  }

  // Load Claude SDK (outside retry — module loading is not retriable)
  const claudeQuery = await loadClaudeQuery();

  // Retry loop for claudeQuery invocation (stage 1: before stream consumption)
  const MAX_RETRIES = 3;
  let lastError: Error | null = null;
  let stream: ReturnType<typeof claudeQuery> | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log('[claude-session] calling claudeQuery with prompt length', fullPrompt.length, 'attempt', attempt);
      stream = claudeQuery({ prompt: fullPrompt, options });
      break;
    } catch (err) {
      const category = categorizeError(err);
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error('[claude-session] claudeQuery attempt', attempt, 'failed:', category, lastError.message);

      if (!shouldRetry(category, attempt, MAX_RETRIES)) {
        break;
      }

      const retryAfterMs = extractRetryAfterMs(err);
      const delayMs = calculateRetryDelay(attempt, category, retryAfterMs);
      if (onStreamEvent && attempt < MAX_RETRIES) {
        onStreamEvent({
          eventType: 'status',
          statusText: `API 重试中 (${attempt}/${MAX_RETRIES})`,
          turnId: turnId || `turn-${Date.now()}`,
        });
      }

      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (!stream) {
    session.status = 'error';
    sessionDb.update(sessionId, { status: 'error' });
    const errorMsg = lastError?.message || 'Claude query failed';
    console.error('[claude-session] querySession exhausted retries', errorMsg);
    yield {
      type: 'error',
      error: errorMsg,
      timestamp: Date.now(),
    };
    session.abortController = undefined;
    return;
  }

  // IPC mid-query injection setup — declared outside try so finally can clean up
  const ipcInputDir = resolve(appConfig.dataDir, 'ipc', sessionId, 'input');
  mkdirSync(ipcInputDir, { recursive: true });

  let ipcWatcher: ReturnType<typeof watch> | null = null;
  let ipcFallback: ReturnType<typeof setInterval> | null = null;
  let ipcWatcherClosed = false;

  function closeIpcWatcher() {
    ipcWatcherClosed = true;
    try { ipcWatcher?.close(); } catch { }
    if (ipcFallback) { clearInterval(ipcFallback); ipcFallback = null; }
  }

  try {
    const processor = onStreamEvent ? new ClawStreamProcessor(onStreamEvent, turnId || `turn-${Date.now()}`) : null;

    // IPC mid-query injection: watch per-session input directory for new messages.
    // Any JSON file dropped into this dir while query is running will be injected
    // into the active Claude session via stream.streamInput().
    async function* singleTextMessage(text: string) {
      yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' };
    }

    function drainIpcInput() {
      let entries: string[] = [];
      try { entries = readdirSync(ipcInputDir); } catch { return; }
      for (const name of entries) {
        if (!name.endsWith('.json')) continue;
        const filePath = join(ipcInputDir, name);
        try {
          const raw = readFileSync(filePath, 'utf-8');
          let parsed: { text?: string } = {};
          try { parsed = JSON.parse(raw); } catch { }
          const text = parsed.text?.trim();
          if (text) {
            console.log('[claude-session] IPC inject:', text.slice(0, 100));
            (stream as any).streamInput(singleTextMessage(text)).catch((e: unknown) => {
              console.error('[claude-session] streamInput error:', e);
            });
          }
          try { unlinkSync(filePath); } catch { }
        } catch { }
      }
    }

    try {
      ipcWatcher = watch(ipcInputDir, () => { if (!ipcWatcherClosed) drainIpcInput(); });
      ipcWatcher.on('error', () => { /* degrade to fallback */ });
    } catch { /* fs.watch unavailable, rely on fallback */ }

    // Fallback polling every 5s in case fs.watch misses events (Docker mounts etc.)
    ipcFallback = setInterval(() => { if (!ipcWatcherClosed) drainIpcInput(); }, 5000);

    // Drain any pre-existing files immediately
    drainIpcInput();

    for await (const rawMessage of stream) {
      const message = rawMessage as any;
      console.log('[claude-session] stream message', message.type, message.subtype || '');
      // Check if aborted
      if (abortController.signal.aborted) {
        yield {
          type: 'error',
          error: 'Query aborted by user',
          timestamp: Date.now(),
        };
        break;
      }

      // Handle result messages (e.g., API errors from SDK)
      if (message.type === 'result') {
        if (message.is_error) {
          yield {
            type: 'error',
            error: message.result || 'Claude Code error',
            timestamp: Date.now(),
          };
        }
        continue;
      }

      // Extract SDK session ID from init message
      if (message.type === 'system' && message.subtype === 'init') {
        session.sdkSessionId = message.session_id;
        sessionDb.update(sessionId, { sdk_session_id: message.session_id });
      }

      // Track lastAssistantUuid for fine-grained resume on next query
      if (message.type === 'result' && message.session_id) {
        if (message.session_id !== session.sdkSessionId) {
          session.sdkSessionId = message.session_id;
          sessionDb.update(sessionId, { sdk_session_id: message.session_id });
        }
        if (message.last_assistant_uuid) {
          session.lastAssistantUuid = message.last_assistant_uuid;
          sessionDb.update(sessionId, { last_assistant_uuid: message.last_assistant_uuid });
        }
      }

      if (processor) {
        processor.processMessage(message);
        // Only yield raw errors directly; all other events are emitted via processor callback
        if (message.type === 'error') {
          yield {
            type: 'error',
            error: message.error || 'Unknown error',
            timestamp: Date.now(),
          };
        }
        continue;
      }

      // Backwards-compatible path when no onStreamEvent provided
      // Extract content for assistant messages (SDK nests the message under .message)
      let content: string | undefined = message.content;
      if (message.type === 'assistant' && !content && message.message) {
        const msgContent = message.message.content;
        if (Array.isArray(msgContent)) {
          content = msgContent
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('');
        } else if (typeof msgContent === 'string') {
          content = msgContent;
        }
      }

      // Convert to IStreamEvent
      const event: IStreamEvent = {
        type: message.type as IStreamEvent['type'],
        subtype: message.subtype,
        content,
        tool_name: message.tool_name || message.message?.tool_name,
        tool_input: message.tool_input || message.message?.tool_input,
        tool_output: message.tool_output,
        error: message.error,
        session_id: message.session_id || session.sdkSessionId,
        timestamp: Date.now(),
      };

      yield event;
    }

    if (processor) {
      processor.cleanup();
      const fullText = processor.getFullText();
      if (fullText) {
        yield {
          type: 'assistant',
          content: fullText,
          timestamp: Date.now(),
        };
      }
    }

    // Mark as complete (include compaction flag for memory flush triggering)
    yield {
      type: 'complete',
      timestamp: Date.now(),
      hadCompaction: isCompacting,
      isMemoryFlush,
    } as IStreamEvent & { hadCompaction?: boolean; isMemoryFlush?: boolean };

    // Update status
    session.status = 'idle';
    sessionDb.update(sessionId, { status: 'idle' });
  } catch (error) {
    // Update status to error
    session.status = 'error';
    sessionDb.update(sessionId, { status: 'error' });

    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[claude-session] querySession error', errorMsg);

    yield {
      type: 'error',
      error: errorMsg,
      timestamp: Date.now(),
    };
  } finally {
    // Clean up abort controller and IPC watcher
    session.abortController = undefined;
    closeIpcWatcher();
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
        status: row.status as ISessionInfo['status'],
      });
    }
  }
}
