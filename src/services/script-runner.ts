import { spawn } from 'child_process';

const MAX_SCRIPT_CONCURRENCY = 3;
let activeScripts = 0;

export interface ScriptResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

export function hasScriptCapacity(): boolean {
  return activeScripts < MAX_SCRIPT_CONCURRENCY;
}

export async function runScript(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 60000,
): Promise<ScriptResult> {
  if (!hasScriptCapacity()) {
    throw new Error('Script concurrency limit reached');
  }

  activeScripts++;
  const startTime = Date.now();

  return new Promise((resolve) => {
    const env: Record<string, string> = {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    };
    // Only allow safe environment variables
    const allowedKeys = ['HOME', 'USER', 'SHELL', 'LANG', 'TERM', 'NODE_ENV'];
    for (const key of allowedKeys) {
      if (process.env[key]) env[key] = process.env[key]!;
    }

    const child = spawn(command, args, {
      cwd,
      timeout: timeoutMs,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => { stdout += data; });
    child.stderr?.on('data', (data) => { stderr += data; });

    child.on('error', (err) => {
      activeScripts--;
      resolve({
        stdout,
        stderr: stderr || err.message,
        exitCode: 1,
        durationMs: Date.now() - startTime,
        timedOut: false,
      });
    });

    child.on('close', (code, signal) => {
      activeScripts--;
      const durationMs = Date.now() - startTime;
      const timedOut = signal === 'SIGTERM' && code === null;
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: code ?? (timedOut ? -1 : 1),
        durationMs,
        timedOut,
      });
    });
  });
}
