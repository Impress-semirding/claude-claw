import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
  cwd: string,
  timeoutMs = 60000,
): Promise<ScriptResult> {
  if (!hasScriptCapacity()) {
    throw new Error('Script concurrency limit reached');
  }

  activeScripts++;
  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024, // 1MB
      env: { ...process.env, PATH: process.env.PATH },
    });

    const durationMs = Date.now() - startTime;
    return {
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: 0,
      durationMs,
      timedOut: false,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const timedOut = err.killed === true && err.signal === 'SIGTERM';
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.code ?? (timedOut ? -1 : 1),
      durationMs,
      timedOut,
    };
  } finally {
    activeScripts--;
  }
}
