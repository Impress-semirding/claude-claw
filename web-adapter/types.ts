/*
 * @Date: 2026-03-31 23:18:11
 * @Author: dingxue
 * @Description: 
 * @LastEditTime: 2026-03-31 23:18:31
 */
/**
 * 共享类型定义
 */

export interface StreamEvent {
  eventType: string;
  turnId?: string;
  sessionId?: string;
  text?: string;
  toolName?: string;
  toolUseId?: string;
  parentToolUseId?: string | null;
  isNested?: boolean;
  skillName?: string;
  toolInputSummary?: string;
  toolInput?: Record<string, unknown>;
  elapsedSeconds?: number;
  hookName?: string;
  hookEvent?: string;
  hookOutcome?: string;
  todos?: Array<{ id: string; content: string; status: string }>;
  statusText?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    costUSD?: number;
    durationMs?: number;
    numTurns?: number;
    modelUsage?: Record<string, unknown>;
  };
  taskId?: string;
  taskStatus?: 'completed' | 'error';
  taskSummary?: string;
  taskDescription?: string;
  isTeammate?: boolean;
  isBackground?: boolean;
  error?: string;
}

export interface Session {
  id: string;
  userId: string;
  name: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  status: 'active' | 'inactive';
  createdAt: string;
}
