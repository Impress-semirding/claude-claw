import { ChildProcess } from 'child_process';
import os from 'os';

const POOL_SIZE = Number(process.env.CLAW_AGENT_POOL_SIZE) || Math.min(os.availableParallelism(), 5);

interface QueuedItem {
  sessionId: string;
  resolve: () => void;
  reject: (reason: Error) => void;
}

class AgentPool {
  private slots = POOL_SIZE;
  private active = new Map<string, ChildProcess | undefined>();
  private queue: QueuedItem[] = [];

  get size(): number {
    return this.slots;
  }

  get activeCount(): number {
    return this.active.size;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  async acquire(sessionId: string, timeoutMs = 30000): Promise<void> {
    if (this.active.has(sessionId)) {
      return;
    }
    if (this.active.size < this.slots) {
      this.active.set(sessionId, undefined);
      return;
    }
    return new Promise((resolve, reject) => {
      const item: QueuedItem = { sessionId, resolve, reject };
      this.queue.push(item);
      if (timeoutMs > 0) {
        setTimeout(() => {
          const idx = this.queue.indexOf(item);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            reject(new Error(`Agent pool acquire timeout after ${timeoutMs}ms`));
          }
        }, timeoutMs);
      }
    });
  }

  bind(sessionId: string, proc: ChildProcess): void {
    this.active.set(sessionId, proc);
    proc.once('exit', () => {
      // Ensure release is called even if querySession forgets
      if (this.active.has(sessionId)) {
        this.release(sessionId);
      }
    });
  }

  release(sessionId: string): void {
    if (!this.active.has(sessionId)) return;
    this.active.delete(sessionId);
    const next = this.queue.shift();
    if (next) {
      this.active.set(next.sessionId, undefined);
      next.resolve();
    }
  }

  getProcess(sessionId: string): ChildProcess | undefined {
    return this.active.get(sessionId);
  }

  kill(sessionId: string, signal: NodeJS.Signals = 'SIGTERM'): boolean {
    const proc = this.active.get(sessionId);
    if (!proc || proc.killed) {
      return false;
    }
    proc.kill(signal);
    return true;
  }

  listActive(): Array<{ sessionId: string; pid?: number }> {
    const result: Array<{ sessionId: string; pid?: number }> = [];
    for (const [sessionId, proc] of this.active.entries()) {
      result.push({ sessionId, pid: proc?.pid });
    }
    return result;
  }
}

export const agentPool = new AgentPool();
