import type { ChildProcess } from 'child_process';

interface TrackedProcess {
  proc: ChildProcess;
  workspaceId: string;
  userId: string;
  startedAt: number;
  killed: boolean;
}

const registry = new Map<string, TrackedProcess>();

export function registerProcess(
  processId: string,
  proc: ChildProcess,
  workspaceId: string,
  userId: string
): void {
  registry.set(processId, {
    proc,
    workspaceId,
    userId,
    startedAt: Date.now(),
    killed: false,
  });

  proc.on('exit', () => {
    registry.delete(processId);
  });

  proc.on('error', () => {
    registry.delete(processId);
  });
}

export function unregisterProcess(processId: string): boolean {
  return registry.delete(processId);
}

export function getProcess(processId: string): TrackedProcess | undefined {
  return registry.get(processId);
}

export function getProcessByWorkspace(workspaceId: string): TrackedProcess | undefined {
  for (const tracked of registry.values()) {
    if (tracked.workspaceId === workspaceId) {
      return tracked;
    }
  }
  return undefined;
}

export function stopProcess(processId: string, force = false): boolean {
  const tracked = registry.get(processId);
  if (!tracked || tracked.proc.killed || tracked.killed) {
    registry.delete(processId);
    return false;
  }

  tracked.killed = true;
  tracked.proc.kill(force ? 'SIGKILL' : 'SIGTERM');
  return true;
}

export function stopWorkspace(workspaceId: string, force = false): boolean {
  const tracked = getProcessByWorkspace(workspaceId);
  if (!tracked || tracked.proc.killed || tracked.killed) {
    return false;
  }

  tracked.killed = true;
  tracked.proc.kill(force ? 'SIGKILL' : 'SIGTERM');
  return true;
}

export async function waitForWorkspaceExit(workspaceId: string, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tracked = getProcessByWorkspace(workspaceId);
    if (!tracked || tracked.proc.killed) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export function listActive(): Array<{ processId: string; workspaceId: string; userId: string; startedAt: number }> {
  const result: Array<{ processId: string; workspaceId: string; userId: string; startedAt: number }> = [];
  for (const [processId, tracked] of registry) {
    if (!tracked.proc.killed && !tracked.killed) {
      result.push({
        processId,
        workspaceId: tracked.workspaceId,
        userId: tracked.userId,
        startedAt: tracked.startedAt,
      });
    }
  }
  return result;
}

export function countActive(): number {
  let count = 0;
  for (const tracked of registry.values()) {
    if (!tracked.proc.killed && !tracked.killed) {
      count++;
    }
  }
  return count;
}

const WATCHDOG_INTERVAL_MS = 60_000; // every 60s
// Allow overriding via env for long-running tasks; default 60 minutes
const MAX_RUNNER_LIFETIME_MS = parseInt(process.env.CLAUDE_RUNNER_WATCHDOG_TIMEOUT_MS || '3600000', 10);

export function startProcessWatchdog(): void {
  setInterval(() => {
    const now = Date.now();
    for (const [processId, tracked] of registry) {
      if (tracked.proc.killed || tracked.killed) {
        registry.delete(processId);
        continue;
      }
      const elapsed = now - tracked.startedAt;
      if (elapsed > MAX_RUNNER_LIFETIME_MS) {
        console.warn(`[process-registry] watchdog killing long-running runner ${processId}, elapsed=${elapsed}ms`);
        try {
          tracked.proc.kill('SIGKILL');
        } catch (e) {
          console.error('[process-registry] failed to kill runner', processId, e);
        }
        registry.delete(processId);
      }
    }
  }, WATCHDOG_INTERVAL_MS);
}
