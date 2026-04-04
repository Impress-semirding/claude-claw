import type { ChildProcess } from 'child_process';

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  signal: AbortSignal;
  workspaceId?: string;
  userId?: string;
}

export interface WorkspaceIsolator {
  prepareWorkspace(workspaceId: string, userId: string): Promise<void>;
  spawn(options: SpawnOptions): ChildProcess;
  destroyWorkspace?(workspaceId: string): Promise<void>;
}
