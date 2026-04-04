import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { appConfig } from '../../config.js';
import type { WorkspaceIsolator, SpawnOptions } from './index.js';

const ISOLATION_BASE_DIR = resolve(appConfig.dataDir, 'isolation');

function getWorkspaceDir(workspaceId: string, userId: string): string {
  return resolve(appConfig.claude.baseDir, userId, workspaceId);
}

function getProfilePath(workspaceId: string): string {
  return resolve(ISOLATION_BASE_DIR, 'profiles', `${workspaceId}.sb`);
}

function generateSandboxProfile(workspaceDir: string): string {
  const homeDir = process.env.HOME || '/tmp';
  const sysTmpDir = tmpdir();

  const lines: string[] = [
    '(version 1)',
    '',
    '; Allow most operations by default (read, exec, network)',
    '(allow default)',
    '',
    '; Deny all writes by default to enforce directory isolation',
    '(deny file-write*)',
    '',
    '; Allow writes to workspace',
    `(allow file-write* (subpath "${workspaceDir}"))`,
    '',
    '; Allow writes to system tmp',
    `(allow file-write* (subpath "${sysTmpDir}"))`,
    '',
    '; Allow writes to home (for npm cache, claude config, etc.)',
    `(allow file-write* (subpath "${homeDir}"))`,
    '',
    '; Allow writing to common devices',
    '(allow file-write-data (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/urandom") (literal "/dev/random"))',
  ];

  return lines.join('\n');
}

export class SandboxExecIsolator implements WorkspaceIsolator {
  async prepareWorkspace(workspaceId: string, userId: string): Promise<void> {
    const workspaceDir = getWorkspaceDir(workspaceId, userId);
    mkdirSync(workspaceDir, { recursive: true });

    const profilePath = getProfilePath(workspaceId);
    mkdirSync(dirname(profilePath), { recursive: true });

    if (!existsSync(profilePath)) {
      const profile = generateSandboxProfile(workspaceDir);
      writeFileSync(profilePath, profile, 'utf-8');
    }
  }

  spawn(options: SpawnOptions): ChildProcess {
    const workspaceId = options.workspaceId || options.cwd;
    const profilePath = getProfilePath(workspaceId);

    // Ensure profile exists; if not, generate a fallback based on cwd
    if (!existsSync(profilePath)) {
      const profile = generateSandboxProfile(options.cwd);
      mkdirSync(dirname(profilePath), { recursive: true });
      writeFileSync(profilePath, profile, 'utf-8');
    }

    const args = ['-f', profilePath, options.command, ...options.args];
    const proc = spawn('sandbox-exec', args, {
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
    // Profiles are left for caching; could be cleaned up here if desired
  }
}
