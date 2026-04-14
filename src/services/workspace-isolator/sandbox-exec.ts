import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, renameSync } from 'fs';
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

function generateSandboxProfile(dirs: { workspaceGroup?: string; workspaceGlobal?: string; workspaceMemory?: string; workspaceIpc?: string; configDir?: string; tmpDir?: string }): string {
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
  ];

  const writePaths = [
    dirs.workspaceGroup,
    dirs.workspaceGlobal,
    dirs.workspaceMemory,
    dirs.workspaceIpc,
    dirs.configDir,
    dirs.tmpDir,
    sysTmpDir,
  ].filter((d): d is string => typeof d === 'string' && d.length > 0);

  for (const p of writePaths) {
    lines.push(`(allow file-write* (subpath "${p}"))`);
  }

  lines.push(
    '',
    '; Allow writing to common devices',
    '(allow file-write-data (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/urandom") (literal "/dev/random"))',
  );

  return lines.join('\n');
}

export class SandboxExecIsolator implements WorkspaceIsolator {
  async prepareWorkspace(workspaceId: string, userId: string): Promise<void> {
    const workspaceDir = getWorkspaceDir(workspaceId, userId);
    mkdirSync(workspaceDir, { recursive: true });

    const profilePath = getProfilePath(workspaceId);
    mkdirSync(dirname(profilePath), { recursive: true });

    if (!existsSync(profilePath)) {
      const profile = generateSandboxProfile({ workspaceGroup: workspaceDir });
      writeFileSync(profilePath, profile, 'utf-8');
    }
  }

  spawn(options: SpawnOptions): ChildProcess {
    const workspaceId = options.workspaceId || options.cwd;
    const profilePath = getProfilePath(workspaceId);

    // Build a precise profile from the exact env vars used by the runner
    const profile = generateSandboxProfile({
      workspaceGroup: options.env.HAPPYCLAW_WORKSPACE_GROUP,
      workspaceGlobal: options.env.HAPPYCLAW_WORKSPACE_GLOBAL,
      workspaceMemory: options.env.HAPPYCLAW_WORKSPACE_MEMORY,
      workspaceIpc: options.env.HAPPYCLAW_WORKSPACE_IPC,
      configDir: options.env.CLAUDE_CONFIG_DIR,
      tmpDir: options.env.CLAUDE_CODE_TMPDIR,
    });
    mkdirSync(dirname(profilePath), { recursive: true });
    const tmpProfilePath = profilePath + '.tmp';
    writeFileSync(tmpProfilePath, profile, 'utf-8');
    renameSync(tmpProfilePath, profilePath);

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
