// Type declarations for @anthropic-ai/claude-agent-sdk

import type { ChildProcess } from 'child_process';

declare module '@anthropic-ai/claude-agent-sdk' {
  export interface SpawnClaudeCodeProcessOptions {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    signal: AbortSignal;
  }

  export interface ClaudeQueryOptions {
    cwd: string;
    env: Record<string, string>;
    mcpServers?: unknown[];
    model: string;
    maxTurns: number;
    maxBudgetUsd: number;
    permissionMode: string;
    allowDangerouslySkipPermissions: boolean;
    sandbox?: {
      enabled: boolean;
      autoAllowBashIfSandboxed: boolean;
    };
    resume?: string;
    spawnClaudeCodeProcess?: (options: SpawnClaudeCodeProcessOptions) => ChildProcess;
  }

  export interface ClaudeQueryMessage {
    type: string;
    subtype?: string;
    content?: string;
    tool_name?: string;
    tool_input?: unknown;
    tool_output?: unknown;
    error?: string;
    session_id?: string;
  }

  export function query(params: {
    prompt: string;
    options: ClaudeQueryOptions;
  }): AsyncGenerator<ClaudeQueryMessage>;

  export default {
    query,
  };
}
