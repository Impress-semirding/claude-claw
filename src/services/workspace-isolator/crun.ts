import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, renameSync } from 'fs';
import { resolve, dirname } from 'path';
import { appConfig } from '../../config.js';
import type { WorkspaceIsolator, SpawnOptions } from './index.js';

const CRUN_BASE_DIR = process.env.CRUN_BASE_DIR || '/var/lib/claw';

function getCrunWorkspaceDir(workspaceId: string, userId: string): string {
  return resolve(CRUN_BASE_DIR, 'workspaces', userId, workspaceId);
}

export class CrunIsolator implements WorkspaceIsolator {
  private ensureBaseRootfs(): void {
    const baseRootfs = resolve(CRUN_BASE_DIR, 'base-rootfs');
    if (existsSync(baseRootfs)) {
      return;
    }
    // On first run, administrators should populate base-rootfs, e.g.:
    // docker export $(docker create node:22-slim) | tar -x -C /var/lib/claw/base-rootfs
    // For MVP we will proceed and rely on bind mounts in the OCI config.
  }

  async prepareWorkspace(workspaceId: string, userId: string): Promise<void> {
    this.ensureBaseRootfs();
    const wsDir = getCrunWorkspaceDir(workspaceId, userId);
    const dirs = [
      resolve(wsDir, 'rootfs'),
      resolve(wsDir, 'upper'),
      resolve(wsDir, 'work'),
      resolve(wsDir, 'merged'),
      resolve(wsDir, 'cgroup'),
    ];
    for (const d of dirs) {
      mkdirSync(d, { recursive: true });
    }

    // Generate OCI bundle config
    this.generateOciConfig(wsDir, workspaceId, userId);
  }

  private generateOciConfig(wsDir: string, workspaceId: string, userId: string): void {
    const mergedDir = resolve(wsDir, 'merged');
    const baseRootfs = resolve(CRUN_BASE_DIR, 'base-rootfs');
    const useBaseRootfs = existsSync(baseRootfs) && existsSync(resolve(baseRootfs, 'bin'));

    // If we have a base rootfs, overlay it with writable upper layer
    // Otherwise, use bind mounts of host paths
    const rootPath = useBaseRootfs ? mergedDir : resolve(wsDir, 'rootfs');

    if (useBaseRootfs) {
      // Overlay mount would normally be done here or by an external setup script
      // since Node.js cannot mount filesystems without privileges.
      // For a privileged setup, administrators can run:
      // mount -t overlay overlay -o lowerdir=/var/lib/claw/base-rootfs,upperdir=...,workdir=... merged
    } else {
      mkdirSync(rootPath, { recursive: true });
    }

    const nodeBinary = process.execPath;
    const nodeDir = dirname(nodeBinary);
    const projectDir = resolve(process.cwd());
    const workspaceHostDir = resolve(appConfig.claude.baseDir, userId, workspaceId);

    const mounts: Array<{ destination: string; source: string; type: string; options: string[] }> = [
      { type: 'proc', source: 'proc', destination: '/proc', options: ['nosuid', 'noexec', 'nodev'] },
      { type: 'tmpfs', source: 'tmpfs', destination: '/tmp', options: ['nosuid', 'strictatime', 'mode=1777', 'size=100m'] },
      { type: 'bind', source: '/dev', destination: '/dev', options: ['rbind', 'nosuid', 'noexec'] },
      { type: 'bind', source: '/dev/null', destination: '/dev/null', options: ['bind', 'nosuid', 'noexec'] },
      { type: 'bind', source: '/dev/zero', destination: '/dev/zero', options: ['bind', 'nosuid', 'noexec'] },
      { type: 'bind', source: '/dev/random', destination: '/dev/random', options: ['bind', 'nosuid', 'noexec'] },
      { type: 'bind', source: '/dev/urandom', destination: '/dev/urandom', options: ['bind', 'nosuid', 'noexec'] },
      { type: 'bind', source: '/etc', destination: '/etc', options: ['rbind', 'ro', 'nosuid', 'noexec', 'nodev'] },
      { type: 'bind', source: '/usr', destination: '/usr', options: ['rbind', 'ro', 'nosuid', 'noexec', 'nodev'] },
      { type: 'bind', source: '/bin', destination: '/bin', options: ['rbind', 'ro', 'nosuid', 'noexec', 'nodev'] },
      { type: 'bind', source: '/lib', destination: '/lib', options: ['rbind', 'ro', 'nosuid', 'noexec', 'nodev'] },
      { type: 'bind', source: '/lib64', destination: '/lib64', options: ['rbind', 'ro', 'nosuid', 'noexec', 'nodev'] },
      { type: 'bind', source: nodeDir, destination: nodeDir, options: ['rbind', 'ro', 'nosuid', 'noexec', 'nodev'] },
      { type: 'bind', source: projectDir, destination: projectDir, options: ['rbind', 'ro', 'nosuid', 'noexec', 'nodev'] },
      { type: 'bind', source: workspaceHostDir, destination: '/workspace', options: ['rbind', 'rw', 'nosuid', 'noexec', 'nodev'] },
    ];

    // If base rootfs exists, mount it as the root and bind mount workspace on top
    if (useBaseRootfs) {
      mounts.push(
        { type: 'bind', source: baseRootfs, destination: '/', options: ['rbind', 'ro'] },
        { type: 'bind', source: workspaceHostDir, destination: '/workspace', options: ['rbind', 'rw'] }
      );
    }

    const ociConfig = {
      ociVersion: '1.0.2',
      root: {
        path: rootPath,
        readonly: false,
      },
      process: {
        terminal: false,
        user: {
          uid: 65534,
          gid: 65534,
        },
        args: [nodeBinary],
        env: [
          'PATH=/usr/local/bin:/usr/bin:/bin',
          'HOME=/workspace',
          'NODE_ENV=production',
        ],
        cwd: '/workspace',
        capabilities: {
          bounding: [],
          effective: [],
          inheritable: [],
          permitted: [],
          ambient: [],
        },
        rlimits: [
          { type: 'RLIMIT_NOFILE', hard: 1024, soft: 1024 },
        ],
        noNewPrivileges: true,
      },
      hostname: `claw-${workspaceId.slice(0, 8)}`,
      linux: {
        namespaces: [
          { type: 'pid' },
          { type: 'mount' },
          { type: 'ipc' },
          { type: 'uts' },
          { type: 'user' },
        ],
        uidMappings: [{ containerID: 0, hostID: 1000, size: 65536 }],
        gidMappings: [{ containerID: 0, hostID: 1000, size: 65536 }],
        cgroupsPath: `/claw/${userId}/${workspaceId}`,
        resources: {
          memory: {
            limit: 536870912, // 512MB
            swap: 0,
          },
          cpu: {
            shares: 512,
            quota: 50000,
            period: 100000,
          },
          pids: {
            limit: 50,
          },
        },
        seccomp: {
          defaultAction: 'SCMP_ACT_ERRNO',
          architectures: ['SCMP_ARCH_X86_64', 'SCMP_ARCH_AARCH64'],
          syscalls: [
            {
              names: [
                'accept',
                'accept4',
                'access',
                'adjtimex',
                'alarm',
                'bind',
                'brk',
                'capget',
                'capset',
                'chdir',
                'chmod',
                'chown',
                'chown32',
                'clock_adjtime',
                'clock_adjtime64',
                'clock_getres',
                'clock_getres_time64',
                'clock_gettime',
                'clock_gettime64',
                'clock_nanosleep',
                'clock_nanosleep_time64',
                'clone',
                'clone3',
                'close',
                'close_range',
                'connect',
                'copy_file_range',
                'creat',
                'dup',
                'dup2',
                'dup3',
                'epoll_create',
                'epoll_create1',
                'epoll_ctl',
                'epoll_ctl_old',
                'epoll_pwait',
                'epoll_pwait2',
                'epoll_wait',
                'epoll_wait_old',
                'eventfd',
                'eventfd2',
                'execve',
                'execveat',
                'exit',
                'exit_group',
                'faccessat',
                'faccessat2',
                'fadvise64',
                'fadvise64_64',
                'fallocate',
                'fanotify_mark',
                'fchdir',
                'fchmod',
                'fchmodat',
                'fchown',
                'fchown32',
                'fchownat',
                'fcntl',
                'fcntl64',
                'fdatasync',
                'fgetxattr',
                'flistxattr',
                'flock',
                'fork',
                'fremovexattr',
                'fsetxattr',
                'fstat',
                'fstat64',
                'fstatat64',
                'fstatfs',
                'fstatfs64',
                'fsync',
                'ftruncate',
                'ftruncate64',
                'futex',
                'futex_time64',
                'getcpu',
                'getcwd',
                'getdents',
                'getdents64',
                'getegid',
                'getegid32',
                'geteuid',
                'geteuid32',
                'getgid',
                'getgid32',
                'getgroups',
                'getgroups32',
                'getitimer',
                'getpeername',
                'getpgid',
                'getpgrp',
                'getpid',
                'getppid',
                'getpriority',
                'getrandom',
                'getresgid',
                'getresgid32',
                'getresuid',
                'getresuid32',
                'getrlimit',
                'get_robust_list',
                'getrusage',
                'getsid',
                'getsockname',
                'getsockopt',
                'getthreadid',
                'gettid',
                'gettimeofday',
                'getuid',
                'getuid32',
                'getxattr',
                'inotify_add_watch',
                'inotify_init',
                'inotify_init1',
                'inotify_rm_watch',
                'ioctl',
                'io_cancel',
                'io_destroy',
                'io_getevents',
                'io_pgetevents',
                'io_pgetevents_time64',
                'io_setup',
                'io_submit',
                'io_uring_enter',
                'io_uring_register',
                'io_uring_setup',
                'ipc',
                'kill',
                'lchown',
                'lchown32',
                'lgetxattr',
                'link',
                'linkat',
                'listen',
                'listxattr',
                'llistxattr',
                'lremovexattr',
                'lseek',
                'lsetxattr',
                'lstat',
                'lstat64',
                'madvise',
                'membarrier',
                'memfd_create',
                'mincore',
                'mkdir',
                'mkdirat',
                'mknod',
                'mknodat',
                'mlock',
                'mlock2',
                'mlockall',
                'mmap',
                'mmap2',
                'mprotect',
                'mq_getsetattr',
                'mq_notify',
                'mq_open',
                'mq_timedreceive',
                'mq_timedreceive_time64',
                'mq_timedsend',
                'mq_timedsend_time64',
                'mq_unlink',
                'mremap',
                'msgctl',
                'msgget',
                'msgrcv',
                'msgsnd',
                'msync',
                'munlock',
                'munlockall',
                'munmap',
                'nanosleep',
                'newfstatat',
                'open',
                'openat',
                'openat2',
                'pause',
                'pidfd_getfd',
                'pidfd_open',
                'pidfd_send_signal',
                'pipe',
                'pipe2',
                'pivot_root',
                'poll',
                'ppoll',
                'ppoll_time64',
                'prctl',
                'pread64',
                'preadv',
                'preadv2',
                'prlimit64',
                'pselect6',
                'pselect6_time64',
                'pwrite64',
                'pwritev',
                'pwritev2',
                'read',
                'readahead',
                'readdir',
                'readlink',
                'readlinkat',
                'readv',
                'recv',
                'recvfrom',
                'recvmmsg',
                'recvmmsg_time64',
                'recvmsg',
                'remap_file_pages',
                'removexattr',
                'rename',
                'renameat',
                'renameat2',
                'restart_syscall',
                'rmdir',
                'rseq',
                'rt_sigaction',
                'rt_sigpending',
                'rt_sigprocmask',
                'rt_sigqueueinfo',
                'rt_sigreturn',
                'rt_sigsuspend',
                'rt_sigtimedwait',
                'rt_sigtimedwait_time64',
                'rt_tgsigqueueinfo',
                'sched_getaffinity',
                'sched_getattr',
                'sched_getparam',
                'sched_get_priority_max',
                'sched_get_priority_min',
                'sched_getscheduler',
                'sched_rr_get_interval',
                'sched_rr_get_interval_time64',
                'sched_setaffinity',
                'sched_setattr',
                'sched_setparam',
                'sched_setscheduler',
                'sched_yield',
                'seccomp',
                'select',
                'semctl',
                'semget',
                'semop',
                'semtimedop',
                'semtimedop_time64',
                'send',
                'sendfile',
                'sendfile64',
                'sendmmsg',
                'sendmsg',
                'sendto',
                'setfsgid',
                'setfsgid32',
                'setfsuid',
                'setfsuid32',
                'setgid',
                'setgid32',
                'setgroups',
                'setgroups32',
                'setitimer',
                'setpgid',
                'setpriority',
                'setregid',
                'setregid32',
                'setresgid',
                'setresgid32',
                'setresuid',
                'setresuid32',
                'setreuid',
                'setreuid32',
                'setrlimit',
                'set_robust_list',
                'setsid',
                'setsockopt',
                'set_thread_area',
                'set_tid_address',
                'setuid',
                'setuid32',
                'setxattr',
                'shmat',
                'shmctl',
                'shmdt',
                'shmget',
                'shutdown',
                'sigaltstack',
                'signalfd',
                'signalfd4',
                'sigpending',
                'sigprocmask',
                'sigreturn',
                'socket',
                'socketcall',
                'socketpair',
                'splice',
                'stat',
                'stat64',
                'statfs',
                'statfs64',
                'statx',
                'symlink',
                'symlinkat',
                'sync',
                'sync_file_range',
                'syncfs',
                'sysinfo',
                'tee',
                'tgkill',
                'time',
                'timer_create',
                'timer_delete',
                'timer_getoverrun',
                'timer_gettime',
                'timer_gettime64',
                'timer_settime',
                'timer_settime64',
                'timerfd_create',
                'timerfd_gettime',
                'timerfd_gettime64',
                'timerfd_settime',
                'timerfd_settime_time64',
                'times',
                'tkill',
                'truncate',
                'truncate64',
                'ugetrlimit',
                'umask',
                'uname',
                'unlink',
                'unlinkat',
                'utime',
                'utimensat',
                'utimensat_time64',
                'utimes',
                'vfork',
                'wait4',
                'waitid',
                'waitpid',
                'write',
                'writev',
              ],
              action: 'SCMP_ACT_ALLOW',
            },
          ],
        },
        maskedPaths: [
          '/proc/acpi',
          '/proc/asound',
          '/proc/kcore',
          '/proc/keys',
          '/proc/latency_stats',
          '/proc/timer_list',
          '/proc/timer_stats',
          '/proc/sched_debug',
          '/proc/scsi',
          '/sys/firmware',
          '/sys/dev/block',
        ],
        readonlyPaths: ['/proc/bus', '/proc/fs', '/proc/irq', '/proc/sys', '/proc/sysrq-trigger'],
      },
      mounts,
    };

    const bundleDir = resolve(wsDir, 'bundle');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(resolve(bundleDir, 'config.json'), JSON.stringify(ociConfig, null, 2), 'utf-8');

    // Create rootfs symlink inside bundle if using bind mounts
    if (!useBaseRootfs) {
      const rootfsLink = resolve(bundleDir, 'rootfs');
      if (!existsSync(rootfsLink)) {
        // On Linux we could symlink; on some environments a bind mount is needed.
        // For simplicity, just reuse the same directory.
        try {
          // Use hardlink-like approach: if rootfs is empty we can just use it directly
          // No symlink needed if config.json root.path is absolute
        } catch {
          // ignore
        }
      }
    }
  }

  spawn(options: SpawnOptions): ChildProcess {
    const workspaceId = options.workspaceId || options.cwd;
    const userId = options.userId || 'unknown';
    const wsDir = getCrunWorkspaceDir(workspaceId, userId);
    const bundleDir = resolve(wsDir, 'bundle');
    const containerId = `claw-${userId.slice(0, 8)}-${workspaceId.slice(0, 8)}-${Date.now()}`;

    // Rewrite OCI config with exact env and workspace mounts for this run
    const configPath = resolve(bundleDir, 'config.json');
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const oci = JSON.parse(raw);

      // 1. Use options.env instead of leaking full host env
      oci.process.env = Object.entries(options.env || {}).map(([k, v]) => `${k}=${v}`);

      // 2. Add bind mounts for all HAPPYCLAW_WORKSPACE_* directories so runner sees same absolute paths
      const extraDirs = [
        options.env.HAPPYCLAW_WORKSPACE_GROUP,
        options.env.HAPPYCLAW_WORKSPACE_GLOBAL,
        options.env.HAPPYCLAW_WORKSPACE_MEMORY,
        options.env.HAPPYCLAW_WORKSPACE_IPC,
      ].filter((d): d is string => typeof d === 'string' && d.length > 0);

      const seen = new Set((oci.mounts as any[]).map((m) => m.destination));
      for (const dir of extraDirs) {
        if (!seen.has(dir)) {
          oci.mounts.push({
            type: 'bind',
            source: dir,
            destination: dir,
            options: ['rbind', 'rw', 'nosuid', 'noexec', 'nodev'],
          });
        }
      }

      const tmpConfigPath = configPath + '.tmp';
      writeFileSync(tmpConfigPath, JSON.stringify(oci, null, 2), 'utf-8');
      renameSync(tmpConfigPath, configPath);
    } catch (err) {
      // If rewrite fails fall back to whatever was prepared
    }

    const args = ['run', '--bundle=' + bundleDir, containerId];
    const proc = spawn('crun', args, {
      cwd: bundleDir,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (options.signal) {
      const abortHandler = () => {
        if (!proc.killed) {
          proc.kill('SIGTERM');
          // Also attempt crun kill for cleanup
          spawn('crun', ['kill', containerId, 'KILL'], { stdio: 'ignore' }).unref();
        }
      };
      options.signal.addEventListener('abort', abortHandler);
      proc.on('exit', () => {
        options.signal.removeEventListener('abort', abortHandler);
        // Cleanup container state
        spawn('crun', ['delete', containerId], { stdio: 'ignore' }).unref();
      });
    } else {
      proc.on('exit', () => {
        spawn('crun', ['delete', containerId], { stdio: 'ignore' }).unref();
      });
    }

    return proc;
  }

  async destroyWorkspace(workspaceId: string, userId?: string): Promise<void> {
    const wsDir = getCrunWorkspaceDir(workspaceId, userId || 'unknown');
    if (existsSync(wsDir)) {
      rmSync(wsDir, { recursive: true, force: true });
    }
  }
}
