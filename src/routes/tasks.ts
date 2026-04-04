import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from './auth.js';
import { randomUUID } from 'crypto';
import { taskDb, taskLogDb } from '../db.js';

const tasks = new Hono();

// Track running tasks in memory (running logs are ephemeral until completion)
const runningTasks = new Set<string>();

// GET /api/tasks - 获取所有任务
tasks.get('/', authMiddleware, async (c) => {
  try {
    const tasksList = taskDb.findAll().map((t) => ({
      ...t,
      status: runningTasks.has(t.id) ? 'running' : 'idle',
    }));
    const runningTaskIds = tasksList
      .filter((t: any) => t.status === 'running')
      .map((t) => t.id);
    return c.json({ tasks: tasksList, runningTaskIds });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load tasks' }, 500);
  }
});

// POST /api/tasks - 创建任务
tasks.post('/', authMiddleware, adminMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const id = randomUUID();
    const task = taskDb.create({
      id,
      name: body.name,
      description: body.description || '',
      cron: body.schedule || body.cron || '',
      prompt: body.command || body.prompt || '',
      groupId: body.group_id || null,
      enabled: body.enabled ?? true,
      lastRunAt: undefined,
      nextRunAt: undefined,
    });
    return c.json({ success: true, task }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create task' }, 500);
  }
});

// PATCH /api/tasks/:id - 更新任务
tasks.patch('/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const task = taskDb.findById(id);
    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }
    const body = await c.req.json();
    taskDb.update(id, {
      name: body.name,
      description: body.description,
      cron: body.schedule ?? body.cron,
      prompt: body.command ?? body.prompt,
      groupId: body.group_id,
      enabled: body.enabled,
    });
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update task' }, 500);
  }
});

// DELETE /api/tasks/:id - 删除任务
tasks.delete('/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    if (!taskDb.findById(id)) {
      return c.json({ error: 'Task not found' }, 404);
    }
    taskDb.delete(id);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete task' }, 500);
  }
});

// GET /api/tasks/:id/logs - 获取任务日志
tasks.get('/:id/logs', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    if (!taskDb.findById(id)) {
      return c.json({ error: 'Task not found' }, 404);
    }
    const logs = taskLogDb.findByTask(id, 100);
    return c.json({ logs });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load task logs' }, 500);
  }
});

// POST /api/tasks/:id/run - 运行任务
tasks.post('/:id/run', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const task = taskDb.findById(id);
    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }

    const now = Date.now();
    runningTasks.add(id);
    taskDb.update(id, { lastRunAt: now });

    const logId = randomUUID();
    taskLogDb.create({
      id: logId,
      taskId: id,
      status: 'running',
      startedAt: now,
    });

    // Simulate completion after a delay
    setTimeout(() => {
      runningTasks.delete(id);
      taskLogDb.create({
        id: randomUUID(),
        taskId: id,
        status: 'success',
        result: 'Task completed',
        startedAt: now,
        endedAt: Date.now(),
      });
    }, 2000);

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to run task' }, 500);
  }
});

// POST /api/tasks/ai - AI 创建任务
tasks.post('/ai', authMiddleware, adminMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const id = randomUUID();
    const task = taskDb.create({
      id,
      name: body.name || 'AI Task',
      description: body.description || '',
      cron: body.cron || '',
      prompt: body.prompt || '',
      groupId: body.group_id || null,
      enabled: true,
    });
    return c.json({ success: true, task });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create task' }, 500);
  }
});

// POST /api/tasks/parse - 解析任务
tasks.post('/parse', authMiddleware, adminMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    return c.json({
      success: true,
      parsed: {
        name: body.text?.slice(0, 20) || 'Parsed Task',
        cron: '',
        prompt: body.text || '',
      },
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to parse task' }, 500);
  }
});

export default tasks;
