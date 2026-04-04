import type { FastifyInstance } from 'fastify';
import { authMiddleware, adminMiddleware } from './auth.js';
import { randomUUID } from 'crypto';
import { taskDb, taskLogDb } from '../db.js';

// Track running tasks in memory (running logs are ephemeral until completion)
const runningTasks = new Set<string>();

export default async function tasksRoutes(fastify: FastifyInstance) {
  // GET /api/tasks - 获取所有任务
  fastify.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const tasksList = taskDb.findAll().map((t) => ({
        ...t,
        status: runningTasks.has(t.id) ? 'running' : 'idle',
      }));
      const runningTaskIds = tasksList
        .filter((t: any) => t.status === 'running')
        .map((t) => t.id);
      return reply.send({ tasks: tasksList, runningTaskIds });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load tasks' });
    }
  });

  // POST /api/tasks - 创建任务
  fastify.post('/', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const body = request.body as any;
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
      return reply.status(201).send({ success: true, task });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to create task' });
    }
  });

  // PATCH /api/tasks/:id - 更新任务
  fastify.patch('/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const task = taskDb.findById(id);
      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }
      const body = request.body as any;
      taskDb.update(id, {
        name: body.name,
        description: body.description,
        cron: body.schedule ?? body.cron,
        prompt: body.command ?? body.prompt,
        groupId: body.group_id,
        enabled: body.enabled,
      });
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update task' });
    }
  });

  // DELETE /api/tasks/:id - 删除任务
  fastify.delete('/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      if (!taskDb.findById(id)) {
        return reply.status(404).send({ error: 'Task not found' });
      }
      taskDb.delete(id);
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to delete task' });
    }
  });

  // GET /api/tasks/:id/logs - 获取任务日志
  fastify.get('/:id/logs', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      if (!taskDb.findById(id)) {
        return reply.status(404).send({ error: 'Task not found' });
      }
      const logs = taskLogDb.findByTask(id, 100);
      return reply.send({ logs });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load task logs' });
    }
  });

  // POST /api/tasks/:id/run - 运行任务
  fastify.post('/:id/run', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const task = taskDb.findById(id);
      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
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

      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to run task' });
    }
  });

  // POST /api/tasks/ai - AI 创建任务
  fastify.post('/ai', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const body = request.body as any;
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
      return reply.send({ success: true, task });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to create task' });
    }
  });

  // POST /api/tasks/parse - 解析任务
  fastify.post('/parse', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const body = request.body as any;
      return reply.send({
        success: true,
        parsed: {
          name: body.text?.slice(0, 20) || 'Parsed Task',
          cron: '',
          prompt: body.text || '',
        },
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to parse task' });
    }
  });
}
