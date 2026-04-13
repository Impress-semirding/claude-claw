/**
 * RunnerPool — persistent runner process pool
 *
 * Maintains N always-on runner processes (launched with --persistent flag).
 * Each runner stays alive across queries; the host sends queries via stdin
 * framing and reads streamed JSON lines from stdout.
 *
 * Env strategy:
 *   The persistent runner is a shared process, so it cannot hold session-specific
 *   env vars (API keys, configDir, etc.) in process.env at startup time.
 *   Instead, those are embedded in each query's options.env JSON field and
 *   temporarily applied inside runPersistentQuery() on the runner side.
 *   The pool only injects generic system env (PATH, NODE_OPTIONS, NODE_ENV).
 *
 * Lifecycle:
 *   warmup()       — spawn POOL_SIZE runners at startup
 *   acquire()      — borrow an idle runner (waits up to timeoutMs)
 *   release()      — return runner to idle pool
 *   sendQuery()    — write QUERY_START...QUERY_END block to runner stdin
 *   readUntilEnd() — async-iterate stdout lines until CLAW_QUERY_END
 *   shutdown()     — send QUERY_CLOSE to all runners and wait for exit
 */

import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { resolve } from 'path';
import { existsSync } from 'fs';
import os from 'os';
import { logger } from '../logger.js';
import { appConfig } from '../config.js';

// ── Protocol constants (must match agent-runner-v2/index.ts) ────────────────
export const PERSISTENT_READY    = '__PERSISTENT_READY__';
export const PERSISTENT_INIT_END = '__PERSISTENT_INIT_END__';
export const QUERY_START         = '__QUERY_START__';
export const QUERY_END           = '__QUERY_END__';
export const QUERY_CLOSE         = '__QUERY_CLOSE__';
export const CLAW_QUERY_END      = '__CLAW_QUERY_END__';

// ── Pool sizing ──────────────────────────────────────────────────────────────
const POOL_SIZE = Number(process.env.CLAW_RUNNER_POOL_SIZE) ||
  Number(process.env.CLAW_AGENT_POOL_SIZE) ||
  Math.min(os.availableParallelism(), 5);

const READY_TIMEOUT_MS   = 30_000;   // max wait for PERSISTENT_READY
const ACQUIRE_TIMEOUT_MS = 30_000;   // max wait for an idle slot
const REPLACE_INTERVAL_MS = 5_000;   // delay before replacing a dead runner

// ── Types ────────────────────────────────────────────────────────────────────
export interface RunnerEntry {
  proc: ChildProcess;
  /** Long-lived readline interface for this runner's stdout */
  rl: ReturnType<typeof createInterface>;
  busy: boolean;
}

interface QueueItem {
  resolve: (entry: RunnerEntry) => void;
  reject:  (err: Error) => void;
  timeoutId: NodeJS.Timeout;
}

// ── Pool implementation ──────────────────────────────────────────────────────
class RunnerPool {
  private runners: RunnerEntry[] = [];
  private queue: QueueItem[] = [];
  private warmedUp = false;
  private replaceTimer: NodeJS.Timeout | null = null;

  get poolSize(): number  { return POOL_SIZE; }
  get idleCount(): number { return this.runners.filter(r => !r.busy).length; }
  get activeCount(): number { return this.runners.filter(r => r.busy).length; }
  get totalCount(): number  { return this.runners.length; }

  // ── Warmup ─────────────────────────────────────────────────────────────────

  async warmup(): Promise<void> {
    if (this.warmedUp) return;
    this.warmedUp = true;
    logger.info({ poolSize: POOL_SIZE }, '[runner-pool] warming up persistent runners');

    const tasks: Promise<void>[] = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      tasks.push(this._spawnOne().then(() => {}, err => {
        logger.error({ err: err.message }, '[runner-pool] warmup spawn failed');
      }));
    }
    await Promise.allSettled(tasks);
    logger.info({ ready: this.runners.length }, '[runner-pool] warmup complete');
  }

  // ── Acquire / Release ──────────────────────────────────────────────────────

  acquire(timeoutMs = ACQUIRE_TIMEOUT_MS): Promise<RunnerEntry> {
    const idle = this.runners.find(r => !r.busy);
    if (idle) {
      idle.busy = true;
      return Promise.resolve(idle);
    }
    return new Promise<RunnerEntry>((resolve, reject) => {
      const item: QueueItem = {
        resolve,
        reject,
        timeoutId: setTimeout(() => {
          const idx = this.queue.indexOf(item);
          if (idx !== -1) this.queue.splice(idx, 1);
          reject(new Error(`[runner-pool] acquire timeout after ${timeoutMs}ms`));
        }, timeoutMs),
      };
      this.queue.push(item);
    });
  }

  release(entry: RunnerEntry): void {
    if (entry.proc.killed || entry.proc.exitCode !== null) {
      this._evict(entry);
      this._scheduleReplace();
      return;
    }
    entry.busy = false;
    const next = this.queue.shift();
    if (next) {
      clearTimeout(next.timeoutId);
      entry.busy = true;
      next.resolve(entry);
    }
  }

  // ── Query I/O ──────────────────────────────────────────────────────────────

  /** Write QUERY_START...QUERY_END framed block to runner stdin */
  sendQuery(entry: RunnerEntry, queryJson: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!entry.proc.stdin) {
        reject(new Error('[runner-pool] runner stdin not available'));
        return;
      }
      const block = `${QUERY_START}\n${queryJson}\n${QUERY_END}\n`;
      entry.proc.stdin.write(block, err => { if (err) reject(err); else resolve(); });
    });
  }

  /** Async-iterate stdout lines until CLAW_QUERY_END (or stdout closes) */
  async *readUntilEnd(entry: RunnerEntry): AsyncGenerator<string> {
    for await (const line of entry.rl) {
      if (line === CLAW_QUERY_END) return;
      yield line;
    }
    // stdout closed before marker — runner probably died; caller handles via release()
  }

  // ── Shutdown ───────────────────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    logger.info('[runner-pool] shutting down');
    for (const entry of this.runners) {
      try { entry.proc.stdin?.write(`${QUERY_CLOSE}\n`); } catch { /* ignore */ }
    }
    await new Promise<void>(r => setTimeout(r, 1000));
    for (const entry of this.runners) {
      if (!entry.proc.killed) try { entry.proc.kill('SIGTERM'); } catch { /* ignore */ }
    }
    this.runners = [];
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private async _spawnOne(): Promise<RunnerEntry> {
    const { runnerPath, command } = this._resolveRunner();

    // Generic env: only system-level vars. Session-specific vars (API keys,
    // CLAUDE_CONFIG_DIR, etc.) are sent per-query inside options.env JSON.
    const baseEnv: Record<string, string> = {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=4096',
      ...(process.env.NODE_ENV ? { NODE_ENV: process.env.NODE_ENV } : {}),
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      // Workspace dirs so MCP tools resolve correctly (same for all sessions)
      ...(process.env.HAPPYCLAW_WORKSPACE_GROUP  ? { HAPPYCLAW_WORKSPACE_GROUP:  process.env.HAPPYCLAW_WORKSPACE_GROUP  } : {}),
      ...(process.env.HAPPYCLAW_WORKSPACE_GLOBAL ? { HAPPYCLAW_WORKSPACE_GLOBAL: process.env.HAPPYCLAW_WORKSPACE_GLOBAL } : {}),
      ...(process.env.HAPPYCLAW_WORKSPACE_MEMORY ? { HAPPYCLAW_WORKSPACE_MEMORY: process.env.HAPPYCLAW_WORKSPACE_MEMORY } : {}),
      ...(process.env.HAPPYCLAW_WORKSPACE_IPC    ? { HAPPYCLAW_WORKSPACE_IPC:    process.env.HAPPYCLAW_WORKSPACE_IPC    } : {}),
    };

    const proc = spawn(command, [runnerPath, '--persistent'], {
      cwd: process.cwd(),
      env: baseEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Forward stderr to our structured logger
    proc.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString('utf-8').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        if (t.startsWith('{')) {
          try {
            const msg = JSON.parse(t);
            if (msg.source === 'agent-runner') {
              const lvl = ['trace','debug','info','warn','error'].includes(msg.level) ? msg.level : 'info';
              (logger as any)[lvl]({ pid: proc.pid, ...msg }, '[runner-pool][runner]');
              continue;
            }
          } catch { /* fall through */ }
        }
        logger.debug({ pid: proc.pid, line: t }, '[runner-pool][runner] stderr');
      }
    });

    // Send empty init block (env is injected per-query, not at init time)
    await new Promise<void>((resolve, reject) => {
      if (!proc.stdin) { reject(new Error('runner stdin unavailable')); return; }
      proc.stdin.write(`{}\n${PERSISTENT_INIT_END}\n`, err => { if (err) reject(err); else resolve(); });
    });

    // Create the single long-lived readline interface FIRST, then wait for PERSISTENT_READY.
    // This avoids the "two readline on same stream" problem: creating a temporary rl,
    // closing it, and then creating a second rl would cause the second rl to miss buffered
    // data that was consumed by the first. We use one rl throughout the runner's lifetime.
    const rl = createInterface({ input: proc.stdout! });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`[runner-pool] no ${PERSISTENT_READY} within ${READY_TIMEOUT_MS}ms`));
      }, READY_TIMEOUT_MS);

      const onLine = (line: string) => {
        if (line.trim() === PERSISTENT_READY) {
          clearTimeout(timer);
          rl.removeListener('line', onLine);
          rl.removeListener('close', onClose);
          resolve();
        }
        // Any other line before PERSISTENT_READY is unexpected — log but keep waiting
      };
      const onClose = () => {
        clearTimeout(timer);
        reject(new Error('[runner-pool] runner stdout closed before PERSISTENT_READY'));
      };
      rl.on('line', onLine);
      rl.once('close', onClose);
    });

    const entry: RunnerEntry = { proc, rl, busy: false };

    proc.once('exit', (code, signal) => {
      logger.warn({ pid: proc.pid, code, signal }, '[runner-pool] runner exited unexpectedly');
      this._evict(entry);
      this._scheduleReplace();
    });

    this.runners.push(entry);
    logger.info({ pid: proc.pid, total: this.runners.length }, '[runner-pool] runner ready');
    return entry;
  }

  private _resolveRunner(): { runnerPath: string; command: string } {
    const distPath = resolve(process.cwd(), 'dist/agent-runner-v2/index.js');
    const devPath  = resolve(process.cwd(), 'src/agent-runner-v2/index.ts');

    if (appConfig.nodeEnv === 'production') {
      if (!existsSync(distPath)) {
        throw new Error('[runner-pool] dist/agent-runner-v2/index.js not found — run npm run build');
      }
      return { runnerPath: distPath, command: 'node' };
    }

    if (existsSync(distPath)) {
      return { runnerPath: distPath, command: 'node' };
    }
    // Dev: use tsx
    const tsx = resolve(process.cwd(), 'node_modules/.bin/tsx');
    return { runnerPath: devPath, command: tsx };
  }

  private _evict(entry: RunnerEntry): void {
    const idx = this.runners.indexOf(entry);
    if (idx !== -1) this.runners.splice(idx, 1);
    try { entry.rl.close(); } catch { /* ignore */ }
  }

  private _scheduleReplace(): void {
    if (this.replaceTimer) return;
    this.replaceTimer = setTimeout(async () => {
      this.replaceTimer = null;
      const deficit = POOL_SIZE - this.runners.length;
      for (let i = 0; i < deficit; i++) {
        try { await this._spawnOne(); } catch (err: any) {
          logger.error({ err: err.message }, '[runner-pool] replace spawn failed');
        }
      }
    }, REPLACE_INTERVAL_MS);
  }
}

export const runnerPool = new RunnerPool();
