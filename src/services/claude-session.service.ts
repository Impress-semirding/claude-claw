import { mkdirSync, rmSync, existsSync, copyFileSync, readdirSync, readFileSync, cpSync } from 'fs';
import { resolve, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { appConfig } from '../config.js';
import { sessionDb, messageDb, groupDb } from '../db.js';
import type { ISessionInfo, IStreamEvent } from '../types.js';
import { getIsolator } from './workspace-isolator/factory.js';
import * as processRegistry from './process-registry.js';

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
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ProviderRecord[];
  } catch {
    return [];
  }
}

function readSecrets(): Record<string, ProviderSecretRecord> {
  const p = resolve(appConfig.dataDir, 'config', 'claude-secrets.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, ProviderSecretRecord>;
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
  const relativeWorkDir = join(userId, workspace, sessionId);
  const relativeConfigDir = join(relativeWorkDir, '.claude');
  const relativeTmpDir = join(relativeWorkDir, 'tmp');
  const relativeUploadDir = join(relativeWorkDir, 'upload-files');

  const absWorkDir = resolve(appConfig.claude.baseDir, relativeWorkDir);
  const absConfigDir = resolve(appConfig.claude.baseDir, relativeConfigDir);
  const absTmpDir = resolve(appConfig.claude.baseDir, relativeTmpDir);
  const absUploadDir = resolve(appConfig.claude.baseDir, relativeUploadDir);

  // Create directories
  mkdirSync(absWorkDir, { recursive: true });
  mkdirSync(absConfigDir, { recursive: true });
  mkdirSync(absTmpDir, { recursive: true });
  mkdirSync(absUploadDir, { recursive: true });

  // Copy template if exists
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
  sessionId: string = uuidv4()
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
  sessionId?: string
): Promise<ISessionInfo> {
  // 如果显式传了 sessionId，精确匹配或新建
  if (sessionId) {
    const existing = getSession(userId, workspace, sessionId);
    if (existing) {
      return existing;
    }
    return createSession(userId, workspace, sessionId);
  }

  // 未传 sessionId 时，复用该用户在该 workspace 下最新的 active session
  const candidates = listUserSessions(userId).filter(
    (s) => s.workspace === workspace && s.status !== 'destroyed'
  );
  if (candidates.length > 0) {
    return candidates[0];
  }

  // 完全没有则新建
  const sid = uuidv4();
  return createSession(userId, workspace, sid);
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

  // Clean up directories (optional - can be done lazily)
  try {
    const absWorkDir = resolve(appConfig.claude.baseDir, session.workDir);
    if (existsSync(absWorkDir)) {
      rmSync(absWorkDir, { recursive: true, force: true });
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
    const workspaceSkillsDir = resolve(appConfig.paths.sessions, group.folder || group.id, '.claude', 'skills');
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
  mcpServers = [],
  systemPrompt,
}: {
  userId: string;
  workspace: string;
  sessionId: string;
  prompt: string;
  mcpServers?: unknown[];
  systemPrompt?: string;
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

  // Build options
  const options: any = {
    cwd: absWorkDir,
    env,
    mcpServers,
    model,
    maxTurns: appConfig.claude.maxTurns || 100,
    maxBudgetUsd: appConfig.claude.maxBudgetUsd || 10,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    resume: session.sdkSessionId,
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

  // Only pass sandbox option when explicitly enabled;
  // passing sandbox: { enabled: false } causes the SDK to hang on macOS
  if (appConfig.claude.sandboxEnabled) {
    options.sandbox = {
      enabled: true,
      autoAllowBashIfSandboxed: true,
    };
  }

  // Add system prompt if provided
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

  try {
    // Load and call Claude SDK
    const claudeQuery = await loadClaudeQuery();
    console.log('[claude-session] calling claudeQuery with prompt length', fullPrompt.length);
    const stream = claudeQuery({ prompt: fullPrompt, options });

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

      // Note: assistant message is saved by the caller (messages.ts) after
      // accumulating the full response. We intentionally do NOT save deltas
      // here to avoid duplicate/confusing entries in the message history.
    }

    // Mark as complete
    yield {
      type: 'complete',
      timestamp: Date.now(),
    };

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
    // Clean up abort controller
    session.abortController = undefined;
  }
}

// Save user message
export function saveUserMessage(
  userId: string,
  sessionId: string,
  content: string,
  attachments?: unknown[]
) {
  messageDb.create({
    id: uuidv4(),
    sessionId,
    userId,
    role: 'user',
    content,
    attachments: attachments as { id: string; name: string; type: string; size: number; path: string }[] | undefined,
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
      sessions.set(key, {
        sessionId: row.id as string,
        userId: row.userId as string,
        workspace: row.workspace as string,
        sdkSessionId: row.sdkSessionId as string | undefined,
        configDir: row.configDir as string,
        workDir: row.workDir as string,
        tmpDir: row.tmpDir as string,
        createdAt: row.createdAt as number,
        lastActiveAt: row.lastActiveAt as number,
        status: row.status as ISessionInfo['status'],
      });
    }
  }
}
