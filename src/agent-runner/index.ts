/**
 * Claw Agent Runner
 * Light-weight child process that wraps the Claude SDK query().
 * Communicates via stdin (JSON config) and stdout (NDJSON + sentinel).
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'fs';
import path from 'path';

interface RunnerInput {
  prompt: string;
  options: Record<string, unknown>;
  ipcDir?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  return new Promise((resolve, reject) => {
    process.stdin.once('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.once('error', reject);
  });
}

async function* singleTextMessage(text: string) {
  yield {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: '',
  };
}

async function main() {
  const rawInput = await readStdin();
  let input: RunnerInput;
  try {
    input = JSON.parse(rawInput) as RunnerInput;
  } catch (err) {
    console.error('[runner] Failed to parse stdin JSON:', err);
    process.exit(1);
  }

  const sessionId = String((input.options as any)?.resume || 'unknown');
  const logError = (...args: any[]) => console.error(`[runner:${sessionId}]`, ...args);

  // Rebuild canUseTool in the child process so allowed/disallowed tools still work
  if (input.allowedTools?.length || input.disallowedTools?.length) {
    const allowed = input.allowedTools || [];
    const disallowed = input.disallowedTools || [];
    (input.options as any).canUseTool = async (toolName: string) => {
      if (disallowed.includes(toolName)) {
        return { behavior: 'deny', message: `Tool ${toolName} is disallowed by group policy` };
      }
      if (allowed.length > 0 && !allowed.includes(toolName)) {
        return { behavior: 'deny', message: `Tool ${toolName} is not in the allowed tools list` };
      }
      return { behavior: 'allow', updatedInput: {} };
    };
    if (input.allowedTools?.length) {
      (input.options as any).allowedTools = input.allowedTools;
    }
    if (input.disallowedTools?.length) {
      (input.options as any).disallowedTools = input.disallowedTools;
    }
    (input.options as any).permissionMode = 'default';
    (input.options as any).allowDangerouslySkipPermissions = false;
  }

  const stream = query({ prompt: input.prompt, options: input.options });

  // IPC mid-query injection
  let ipcWatcher: ReturnType<typeof fs.watch> | null = null;
  let ipcFallback: ReturnType<typeof setTimeout> | null = null;
  let ipcWatcherClosed = false;
  let ipcFallbackDelay = 1000;
  const MAX_IPC_DELAY = 5000;
  const ipcDir = input.ipcDir;

  function closeIpcWatcher() {
    ipcWatcherClosed = true;
    try { ipcWatcher?.close(); } catch { /* ignore */ }
    if (ipcFallback) { clearTimeout(ipcFallback); ipcFallback = null; }
  }

  function drainIpcInput() {
    if (!ipcDir) return;
    let entries: string[] = [];
    try { entries = fs.readdirSync(ipcDir); } catch { return; }
    let found = 0;
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const filePath = path.join(ipcDir, name);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        let parsed: { text?: string } = {};
        try { parsed = JSON.parse(raw); } catch { /* ignore */ }
        const text = parsed.text?.trim();
        if (text) {
          (stream as any).streamInput(singleTextMessage(text)).catch((e: unknown) => {
            logError('streamInput error:', e);
          });
        }
        try { fs.unlinkSync(filePath); found++; } catch { /* ignore */ }
      } catch { /* ignore */ }
    }
    return found;
  }

  function scheduleIpcDrain() {
    if (ipcFallback) clearTimeout(ipcFallback);
    ipcFallback = setTimeout(() => {
      if (!ipcWatcherClosed) {
        const found = drainIpcInput();
        if (found && found > 0) {
          ipcFallbackDelay = 1000;
        } else {
          ipcFallbackDelay = Math.min(ipcFallbackDelay * 2, MAX_IPC_DELAY);
        }
        scheduleIpcDrain();
      }
    }, ipcFallbackDelay);
  }

  if (ipcDir) {
    fs.mkdirSync(ipcDir, { recursive: true });
    // Clean up stale IPC files on startup to avoid injecting old messages
    try {
      for (const name of fs.readdirSync(ipcDir)) {
        if (name.endsWith('.json')) {
          fs.unlinkSync(path.join(ipcDir, name));
        }
      }
    } catch { /* ignore */ }
    try {
      ipcWatcher = fs.watch(ipcDir, () => {
        if (!ipcWatcherClosed) {
          drainIpcInput();
          ipcFallbackDelay = 1000;
        }
      });
      ipcWatcher.on('error', () => { /* degrade to fallback */ });
    } catch { /* fs.watch unavailable, rely on fallback */ }
    scheduleIpcDrain();
    drainIpcInput();
  }

  // Graceful shutdown on SIGTERM
  process.on('SIGTERM', () => {
    closeIpcWatcher();
    process.exit(0);
  });

  try {
    for await (const msg of stream) {
      console.log(JSON.stringify(msg));
    }
  } catch (err) {
    // Emit error as a special line so parent can distinguish
    console.log(JSON.stringify({ type: 'error', error: String(err), __runner_error__: true }));
  } finally {
    closeIpcWatcher();
  }

  console.log('__CLAW_END__');
}

main().catch((err) => {
  console.error('[runner] fatal error:', err);
  process.exit(1);
});
