// Type declarations for @anthropic-ai/claude-agent-sdk
// Expanded to expose full SDK surface used by Claw Phase 3

import type { ChildProcess } from 'child_process';

declare module '@anthropic-ai/claude-agent-sdk' {
  export interface SpawnClaudeCodeProcessOptions {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    signal: AbortSignal;
  }

  export type SpawnOptions = SpawnClaudeCodeProcessOptions;
  export type SpawnedProcess = ChildProcess;

  export type PermissionResult =
    | { behavior: 'allow'; updatedInput: Record<string, unknown>; updatedPermissions?: PermissionUpdate[]; toolUseID?: string }
    | { behavior: 'deny'; message: string; interrupt?: boolean; toolUseID?: string };

  export interface PermissionUpdate {
    tool: string;
    allow?: boolean;
    path?: string;
  }

  export type CanUseTool = (
    toolName: string,
    input: Record<string, unknown>,
    options: {
      signal: AbortSignal;
      suggestions?: PermissionUpdate[];
      blockedPath?: string;
      decisionReason?: string;
      toolUseID: string;
      agentID?: string;
    }
  ) => Promise<PermissionResult>;

  export interface ClaudeQueryOptions {
    cwd?: string;
    env?: Record<string, string>;
    model?: string;
    maxTurns?: number;
    maxBudgetUsd?: number;
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk';
    allowDangerouslySkipPermissions?: boolean;
    sandbox?: {
      enabled: boolean;
      autoAllowBashIfSandboxed?: boolean;
      network?: {
        allowLocalBinding?: boolean;
        allowUnixSockets?: string[];
      };
    };
    resume?: string;
    resumeSessionAt?: string;
    continue?: boolean;
    forkSession?: boolean;
    spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess;
    abortController?: AbortController;

    // Tool control
    tools?: string[] | { type: 'preset'; preset: 'claude_code' };
    allowedTools?: string[];
    disallowedTools?: string[];
    canUseTool?: CanUseTool;

    // MCP
    mcpServers?: Record<string, any>;
    strictMcpConfig?: boolean;

    // Prompt / context
    systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };
    settingSources?: ('user' | 'project' | 'local')[];
    additionalDirectories?: string[];

    // Session behavior
    persistSession?: boolean;
    enableFileCheckpointing?: boolean;

    // Model features
    fallbackModel?: string;
    maxThinkingTokens?: number;
    betas?: string[];
    outputFormat?: any;

    // Hooks / agents
    hooks?: Partial<Record<string, any>>;
    agents?: Record<string, any>;
    plugins?: any[];

    // Process / debug
    executable?: 'bun' | 'deno' | 'node';
    executableArgs?: string[];
    pathToClaudeCodeExecutable?: string;
    extraArgs?: Record<string, string | null>;
    stderr?: (data: string) => void;
    includePartialMessages?: boolean;
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

  export interface Query extends AsyncGenerator<ClaudeQueryMessage, void> {
    interrupt(): Promise<void>;
    setPermissionMode(mode: ClaudeQueryOptions['permissionMode']): Promise<void>;
    setModel(model?: string): Promise<void>;
    setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
    supportedCommands(): Promise<any[]>;
    supportedModels(): Promise<any[]>;
    mcpServerStatus(): Promise<any[]>;
    accountInfo(): Promise<any>;
    rewindFiles(userMessageId: string, options?: { dryRun?: boolean }): Promise<any>;
    setMcpServers(servers: Record<string, any>): Promise<any>;
    streamInput(stream: AsyncIterable<any>): Promise<void>;
  }

  export function query(params: {
    prompt: string;
    options?: ClaudeQueryOptions;
  }): Query;

  // In-process custom tool definition
  export interface SdkMcpToolDefinition<Schema = any> {
    name: string;
    description: string;
    inputSchema: Schema;
    handler: (args: any, extra: unknown) => Promise<any>;
  }

  export function tool<Schema = any>(
    name: string,
    description: string,
    inputSchema: Schema,
    handler: (args: any, extra: unknown) => Promise<any>
  ): SdkMcpToolDefinition<Schema>;

  export function createSdkMcpServer(options: {
    name: string;
    version?: string;
    tools?: Array<SdkMcpToolDefinition<any>>;
  }): any;

  export class AbortError extends Error {}

  // V2 unstable session API
  export function unstable_v2_createSession(options: any): any;
  export function unstable_v2_resumeSession(sessionId: string, options: any): any;
  export function unstable_v2_prompt(message: string, options: any): Promise<any>;

  export default {
    query,
    tool,
    createSdkMcpServer,
    AbortError,
    unstable_v2_createSession,
    unstable_v2_resumeSession,
    unstable_v2_prompt,
  };
}
