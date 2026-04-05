// Core types for Claw - Claude Code Multi-User Platform

export type SessionStatus = 'idle' | 'running' | 'error' | 'destroyed';

export interface ISessionInfo {
  sessionId: string;
  userId: string;
  workspace: string;
  sdkSessionId?: string;
  configDir: string;
  workDir: string;
  tmpDir: string;
  createdAt: number;
  lastActiveAt: number;
  status: SessionStatus;
}

export interface IUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  status?: 'active' | 'disabled' | 'deleted';
  avatarEmoji?: string | null;
  avatarColor?: string | null;
  avatarUrl?: string | null;
  aiName?: string | null;
  aiAvatarEmoji?: string | null;
  aiAvatarColor?: string | null;
  aiAvatarUrl?: string | null;
  permissions?: string[];
  lastLoginAt?: number | null;
  lastActiveAt?: number | null;
  deletedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface IGroup {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  members: string[];
  config: IGroupConfig;
  folder?: string;
  isHome?: boolean;
  pinnedAt?: number | null;
  executionMode?: 'host' | 'container';
  createdAt: number;
  updatedAt: number;
}

export interface IGroupConfig {
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: string[];
  systemPrompt?: string;
  env?: Record<string, string>;
}

export interface IMessage {
  id: string;
  sessionId: string;
  userId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: IAttachment[];
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface IAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  path: string;
  url?: string;
}

export interface IMcpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  type?: string;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface IStreamEvent {
  type: 'system' | 'assistant' | 'tool' | 'error' | 'complete';
  subtype?: string;
  content?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  error?: string;
  session_id?: string;
  timestamp: number;
}

export interface IClaudeQueryOptions {
  cwd: string;
  env: Record<string, string>;
  mcpServers?: unknown[];
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  permissionMode?: 'default' | 'bypassPermissions';
  allowDangerouslySkipPermissions?: boolean;
  sandbox?: {
    enabled: boolean;
    autoAllowBashIfSandboxed: boolean;
  };
  resume?: string;
}

export interface IImChannel {
  id: string;
  type: 'feishu' | 'telegram' | 'qq' | 'dingtalk' | 'wechat';
  config: Record<string, string>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface IImMessage {
  id: string;
  channelId: string;
  channelType: string;
  senderId: string;
  senderName: string;
  content: string;
  attachments?: IAttachment[];
  raw: unknown;
  createdAt: number;
}

export interface ITask {
  id: string;
  name: string;
  description?: string;
  cron: string;
  prompt: string;
  groupId?: string;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ITaskLog {
  id: string;
  taskId: string;
  status: 'success' | 'error' | 'running';
  result?: string;
  startedAt: number;
  endedAt?: number;
  createdAt: number;
}

export interface IBillingRecord {
  id: string;
  userId: string;
  sessionId: string;
  type: 'input' | 'output' | 'tool';
  tokens: number;
  cost: number;
  model: string;
  createdAt: number;
}

export interface IInviteCode {
  code: string;
  maxUses: number;
  usedCount: number;
  expiresAt?: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface IAuthAuditLog {
  id: string;
  userId?: string;
  eventType: string;
  ipAddress?: string;
  userAgent?: string;
  details?: string;
  createdAt: number;
}

export interface IUserSession {
  id: string;
  userId: string;
  token: string;
  expiresAt: number;
  lastActiveAt: number;
  ipAddress?: string;
  userAgent?: string;
  status: 'active' | 'revoked';
  createdAt: number;
}

export interface ISkill {
  id: string;
  userId: string;
  name: string;
  description?: string;
  source: 'user' | 'project' | 'host';
  enabled: boolean;
  content?: string;
  config?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface IAgent {
  id: string;
  groupId: string;
  name: string;
  prompt: string;
  status?: 'idle' | 'running' | 'completed' | 'error';
  kind?: 'task' | 'conversation' | 'spawn';
  resultSummary?: string;
  createdAt: number;
  updatedAt: number;
}

// WebSocket message types (outgoing)
export interface WsMessageOut {
  type:
    | 'new_message'
    | 'agent_reply'
    | 'typing'
    | 'stream_event'
    | 'stream_snapshot'
    | 'runner_state'
    | 'agent_status'
    | 'terminal_output'
    | 'terminal_started'
    | 'terminal_stopped'
    | 'terminal_error'
    | 'status_update'
    | 'docker_build_log'
    | 'docker_build_complete'
    | 'group_created'
    | 'billing_update'
    | 'ws_error';
  chatJid?: string;
  message?: IMessage & { is_from_me?: boolean };
  text?: string;
  timestamp?: string;
  isTyping?: boolean;
  event?: StreamEvent;
  agentId?: string;
  state?: 'idle' | 'running';
  error?: string;
}

// WebSocket message types (incoming)
export interface WsMessageIn {
  type: 'send_message' | 'terminal_start' | 'terminal_input' | 'terminal_resize' | 'terminal_stop';
  chatJid?: string;
  content?: string;
  attachments?: Array<{ type: 'image'; data: string; mimeType?: string }>;
  agentId?: string;
  cols?: number;
  rows?: number;
  data?: string;
}

// StreamEvent (aligned with HappyClaw)
export type StreamEvent =
  | { eventType: 'text_delta'; text: string; turnId?: string }
  | { eventType: 'thinking_delta'; text: string; turnId?: string }
  | {
      eventType: 'tool_use_start';
      toolName: string;
      toolUseId: string;
      toolInputSummary?: string;
      parentToolUseId?: string | null;
      isNested?: boolean;
      skillName?: string;
      turnId?: string;
    }
  | { eventType: 'tool_use_end'; toolUseId: string; turnId?: string }
  | { eventType: 'tool_progress'; toolUseId: string; toolInputSummary?: string; turnId?: string }
  | { eventType: 'status'; statusText: string; turnId?: string }
  | { eventType: 'hook_started'; hookName: string; hookEvent?: string; turnId?: string }
  | { eventType: 'hook_progress'; hookName: string; text: string; turnId?: string }
  | { eventType: 'hook_response'; hookName: string; text: string; turnId?: string }
  | { eventType: 'task_start'; taskId: string; taskName: string; turnId?: string }
  | { eventType: 'task_notification'; taskId: string; message: string; turnId?: string }
  | { eventType: 'todo_update'; todos: Array<{ id: string; content: string; status: string }>; turnId?: string }
  | { eventType: 'init'; session_id: string; turnId?: string }
  | { eventType: 'complete'; turnId?: string }
  | { eventType: 'error'; error: string; turnId?: string };
