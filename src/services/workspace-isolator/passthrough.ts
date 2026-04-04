import { spawn, type ChildProcess } from 'child_process';
import type { WorkspaceIsolator, SpawnOptions } from './index.js';

export class PassthroughIsolator implements WorkspaceIsolator {
  async prepareWorkspace(): Promise<void> {
    // No preparation needed for passthrough
  }

  spawn(options: SpawnOptions): ChildProcess {
    const proc = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (options.signal) {
      const abortHandler = () => {
        if (!proc.killed) {
          proc.kill('SIGTERM');
        }
      };
      options.signal.addEventListener('abort', abortHandler);
      proc.on('exit', () => {
        options.signal.removeEventListener('abort', abortHandler);
      });
    }

    return proc;
  }

  async destroyWorkspace(): Promise<void> {
    // No cleanup needed
  }
}
