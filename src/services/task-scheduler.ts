import { CronExpressionParser } from 'cron-parser';
import { randomUUID } from 'crypto';
import { resolve } from 'path';
import { appConfig } from '../config.js';
import { taskDb, taskLogDb, groupDb, userDb, mcpServerDb } from '../db.js';
import type { ITask } from '../types.js';
import { runScript, hasScriptCapacity } from './script-runner.js';
import { querySession, getOrCreateSession, saveUserMessage } from './claude-session.service.js';
import { broadcastNewMessage } from './ws.service.js';
import { runAgentQuery } from '../routes/messages.js';
import { resolveAgent } from './agent-presets.js';

const SCHEDULER_POLL_INTERVAL = 60_000; // 60s
const runningTaskIds = new Set<string>();

export function getRunningTaskIds(): string[] {
  return [...runningTaskIds];
}

export function computeNextRun(task: ITask): number | undefined {
  if (!task.cron || task.cron.trim() === '') return undefined;

  const trimmed = task.cron.trim();
  // Simple numeric interval (ms)
  if (/^\d+$/.test(trimmed)) {
    const ms = parseInt(trimmed, 10);
    if (!Number.isFinite(ms) || ms <= 0) return undefined;
    const anchor = task.nextRunAt || Date.now();
    return anchor + ms;
  }

  try {
    const interval = CronExpressionParser.parse(trimmed);
    return interval.next().toDate().getTime();
  } catch (err) {
    console.error('[task-scheduler] failed to parse cron:', trimmed, err);
    return undefined;
  }
}

function isTaskStillActive(taskId: string): boolean {
  const task = taskDb.findById(taskId);
  return !!task && task.enabled;
}

async function runScriptTask(task: ITask): Promise<void> {
  if (!hasScriptCapacity()) {
    console.log('[task-scheduler] script concurrency limit reached, skipping task', task.id);
    return;
  }

  const startTime = Date.now();
  runningTaskIds.add(task.id);
  const logId = randomUUID();
  taskLogDb.create({
    id: logId,
    taskId: task.id,
    status: 'running',
    startedAt: startTime,
  });

  const group = task.groupId ? groupDb.findById(task.groupId) : undefined;
  const cwd = group ? resolve(appConfig.claude.baseDir, group.folder || group.id) : process.cwd();

  try {
    const result = await runScript(task.scriptCommand || '', cwd);

    let logResult: string;
    let logStatus: 'success' | 'error';
    if (result.timedOut) {
      logStatus = 'error';
      logResult = `脚本执行超时 (${Math.round(result.durationMs / 1000)}s)`;
    } else if (result.exitCode !== 0) {
      logStatus = 'error';
      logResult = result.stderr.trim() || `退出码: ${result.exitCode}`;
    } else {
      logStatus = 'success';
      logResult = result.stdout.trim() || 'Completed';
    }

    taskLogDb.create({
      id: randomUUID(),
      taskId: task.id,
      status: logStatus,
      result: logResult,
      startedAt: startTime,
      endedAt: Date.now(),
    });

    const nextRun = computeNextRun(task);
    taskDb.update(task.id, { lastRunAt: startTime, nextRunAt: nextRun });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    taskLogDb.create({
      id: randomUUID(),
      taskId: task.id,
      status: 'error',
      result: errorMsg,
      startedAt: startTime,
      endedAt: Date.now(),
    });
  } finally {
    runningTaskIds.delete(task.id);
  }
}

async function runAgentTask(task: ITask): Promise<void> {
  const startTime = Date.now();
  runningTaskIds.add(task.id);
  const logId = randomUUID();
  taskLogDb.create({
    id: logId,
    taskId: task.id,
    status: 'running',
    startedAt: startTime,
  });

  const group = task.groupId ? groupDb.findById(task.groupId) : undefined;
  const ownerId = task.createdBy || group?.ownerId || 'system';
  const workspaceFolder = task.workspaceFolder || `task-${task.id.slice(0, 8)}`;
  const workspaceJid = task.workspaceJid || `web:${randomUUID()}`;

  if (!task.workspaceFolder || !task.workspaceJid) {
    taskDb.update(task.id, { workspaceFolder, workspaceJid });
  }

  let resultText = '';
  let errorText = '';

  try {
    const session = await getOrCreateSession(ownerId, workspaceJid, undefined, undefined);

    const enabledMcpServers: Record<string, any> = {};
    for (const s of mcpServerDb.findEnabled()) {
      if (s.type === 'sse' || s.url) {
        enabledMcpServers[s.name] = { type: 'sse', url: s.url, headers: s.headers || {} };
      } else {
        enabledMcpServers[s.name] = { type: 'stdio', command: s.command, args: s.args || [], env: s.env || {} };
      }
    }

    const stream = querySession({
      userId: ownerId,
      workspace: workspaceJid,
      sessionId: session.sessionId,
      prompt: task.prompt,
      mcpServers: enabledMcpServers,
    });

    for await (const event of stream) {
      if (event.type === 'assistant' && event.content) {
        resultText = event.content;
      } else if (event.type === 'error') {
        errorText = event.error || 'Unknown error';
      }
    }

    if (errorText) {
      taskLogDb.create({
        id: randomUUID(),
        taskId: task.id,
        status: 'error',
        result: errorText,
        startedAt: startTime,
        endedAt: Date.now(),
      });
    } else {
      taskLogDb.create({
        id: randomUUID(),
        taskId: task.id,
        status: 'success',
        result: resultText || 'Completed',
        startedAt: startTime,
        endedAt: Date.now(),
      });
    }

    const nextRun = computeNextRun(task);
    taskDb.update(task.id, { lastRunAt: startTime, nextRunAt: nextRun });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    taskLogDb.create({
      id: randomUUID(),
      taskId: task.id,
      status: 'error',
      result: errorMsg,
      startedAt: startTime,
      endedAt: Date.now(),
    });
  } finally {
    runningTaskIds.delete(task.id);
  }
}

async function runGroupModeTask(task: ITask): Promise<void> {
  const startTime = Date.now();

  if (!task.groupId) {
    console.error('[task-scheduler] group mode task missing groupId', task.id);
    taskLogDb.create({
      id: randomUUID(),
      taskId: task.id,
      status: 'error',
      result: 'Group mode task missing groupId',
      startedAt: startTime,
      endedAt: Date.now(),
    });
    return;
  }

  const group = groupDb.findById(task.groupId);
  if (!group) {
    console.error('[task-scheduler] group not found for task', task.id);
    return;
  }

  runningTaskIds.add(task.id);

  try {
    const ownerId = task.createdBy || group.ownerId;
    const owner = userDb.findById(ownerId);
    const senderName = owner?.name || '定时任务';
    const session = await getOrCreateSession(ownerId, task.groupId, undefined, undefined);
    const messageId = randomUUID();
    const timestamp = new Date().toISOString();

    saveUserMessage(ownerId, session.sessionId, task.prompt, undefined, messageId, {
      senderName,
      sourceKind: 'scheduled_task',
      timestamp,
    });

    broadcastNewMessage(task.groupId, {
      id: messageId,
      chat_jid: task.groupId,
      sender: ownerId,
      sender_name: senderName,
      content: task.prompt,
      timestamp,
      is_from_me: false,
      source_kind: 'scheduled_task',
      session_id: session.sessionId,
    });

    const workspaceDir = resolve(appConfig.claude.baseDir, group.folder || '');
    const userGlobalPath = resolve(appConfig.dataDir, 'groups', 'user-global', ownerId, 'CLAUDE.md');
    const env = {
      userId: ownerId,
      email: senderName,
      chatJid: task.groupId,
      workspaceDir,
      userGlobalPath,
      groupConfig: group.config || {},
    };

    const agent = resolveAgent(task.groupId, undefined);
    const enabledMcpServers: Record<string, any> = {};
    for (const s of mcpServerDb.findEnabled()) {
      if (s.type === 'sse' || s.url) {
        enabledMcpServers[s.name] = { type: 'sse', url: s.url, headers: s.headers || {} };
      } else {
        enabledMcpServers[s.name] = { type: 'stdio', command: s.command, args: s.args || [], env: s.env || {} };
      }
    }

    await runAgentQuery(agent, env, session.sessionId, task.prompt, enabledMcpServers, task.groupId, undefined);

    taskLogDb.create({
      id: randomUUID(),
      taskId: task.id,
      status: 'success',
      result: '已注入到源工作区',
      startedAt: startTime,
      endedAt: Date.now(),
    });

    const nextRun = computeNextRun(task);
    taskDb.update(task.id, { lastRunAt: startTime, nextRunAt: nextRun });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    taskLogDb.create({
      id: randomUUID(),
      taskId: task.id,
      status: 'error',
      result: errorMsg,
      startedAt: startTime,
      endedAt: Date.now(),
    });
  } finally {
    runningTaskIds.delete(task.id);
  }
}

async function runTask(task: ITask, options?: { manualRun?: boolean }): Promise<void> {
  if (!options?.manualRun && !isTaskStillActive(task.id)) {
    console.log('[task-scheduler] task no longer active, skipping', task.id);
    return;
  }

  const freshTask = taskDb.findById(task.id);
  if (!freshTask) return;

  if (freshTask.executionType === 'script') {
    await runScriptTask(freshTask);
  } else if (freshTask.contextMode === 'group') {
    await runGroupModeTask(freshTask);
  } else {
    await runAgentTask(freshTask);
  }
}

export function startSchedulerLoop(): void {
  console.log('[task-scheduler] scheduler loop started');

  const loop = async () => {
    try {
      const now = Date.now();
      const enabledTasks = taskDb.findEnabled();
      const dueTasks = enabledTasks.filter((t) => {
        if (!t.nextRunAt) return false;
        return t.nextRunAt <= now;
      });

      if (dueTasks.length > 0) {
        console.log('[task-scheduler] found due tasks:', dueTasks.length);
      }

      for (const task of dueTasks) {
        if (runningTaskIds.has(task.id)) continue;

        console.log('[task-scheduler] running due task', task.id, task.name);
        runTask(task).catch((err) => {
          console.error('[task-scheduler] unhandled error in runTask', task.id, err);
        });
      }
    } catch (err) {
      console.error('[task-scheduler] error in scheduler loop', err);
    }

    setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  loop();
}

export function triggerTaskNow(taskId: string): { success: boolean; error?: string } {
  const task = taskDb.findById(taskId);
  if (!task) return { success: false, error: 'Task not found' };
  if (!task.enabled) return { success: false, error: 'Task is disabled' };
  if (runningTaskIds.has(taskId)) return { success: false, error: 'Task is already running' };

  runTask(task, { manualRun: true }).catch((err) => {
    console.error('[task-scheduler] manual run error', taskId, err);
  });

  return { success: true };
}

export function initializeTaskSchedules(): void {
  const tasks = taskDb.findEnabled();
  let initialized = 0;
  for (const task of tasks) {
    if (!task.nextRunAt && task.cron) {
      const nextRun = computeNextRun(task);
      if (nextRun) {
        taskDb.update(task.id, { nextRunAt: nextRun });
        initialized++;
      }
    }
  }
  if (initialized > 0) {
    console.log('[task-scheduler] initialized nextRunAt for', initialized, 'tasks');
  }
}
