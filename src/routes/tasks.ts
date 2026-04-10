import type { FastifyInstance } from 'fastify';
import { authMiddleware, adminMiddleware } from './auth.js';
import { randomUUID } from 'crypto';
import { taskDb, taskLogDb } from '../db.js';
import { triggerTaskNow, getRunningTaskIds } from '../services/task-scheduler.js';

export default async function tasksRoutes(fastify: FastifyInstance) {
  // GET /api/tasks - 获取所有任务
  fastify.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const runningIds = new Set(getRunningTaskIds());
      const tasksList = taskDb.findAll().map((t) => ({
        ...t,
        status: runningIds.has(t.id) ? 'running' : t.enabled ? 'active' : 'paused',
      }));
      return reply.send({ tasks: tasksList, runningTaskIds: [...runningIds] });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load tasks' });
    }
  });

  // POST /api/tasks - 创建任务
  fastify.post('/', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const body = request.body as any;
      const user = request.user as { userId: string };
      const id = randomUUID();

      const executionType = body.execution_type || body.executionType || 'agent';
      const contextMode = body.context_mode || body.contextMode || (executionType === 'script' ? 'isolated' : 'isolated');

      const task = taskDb.create({
        id,
        name: body.name,
        description: body.description || '',
        cron: body.schedule || body.cron || '',
        prompt: body.command || body.prompt || '',
        groupId: body.group_id || body.groupId || null,
        enabled: body.enabled ?? true,
        executionType,
        contextMode,
        scriptCommand: body.script_command || body.scriptCommand || '',
        createdBy: user.userId,
      });

      // Compute initial nextRunAt if cron is provided
      if (task.cron) {
        const { computeNextRun } = await import('../services/task-scheduler.js');
        const nextRun = (computeNextRun as any)(task);
        if (nextRun) {
          taskDb.update(task.id, { nextRunAt: nextRun });
        }
      }

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
        groupId: body.group_id ?? body.groupId,
        enabled: body.enabled,
        executionType: body.execution_type ?? body.executionType,
        contextMode: body.context_mode ?? body.contextMode,
        scriptCommand: body.script_command ?? body.scriptCommand,
      });

      // Recompute nextRunAt if cron changed
      const updated = taskDb.findById(id);
      if (updated && updated.cron) {
        const { computeNextRun } = await import('../services/task-scheduler.js');
        const nextRun = (computeNextRun as any)(updated);
        if (nextRun) {
          taskDb.update(id, { nextRunAt: nextRun });
        }
      }

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

  // GET /api/tasks/:id - 获取单个任务
  fastify.get('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const task = taskDb.findById(id);
      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }
      return reply.send({ task });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load task' });
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

  // POST /api/tasks/:id/run - 运行任务（手动触发）
  fastify.post('/:id/run', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const task = taskDb.findById(id);
      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      const result = triggerTaskNow(id);
      if (!result.success) {
        return reply.status(400).send({ error: result.error });
      }

      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to run task' });
    }
  });

  // POST /api/tasks/ai - AI 创建任务
  fastify.post('/ai', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const body = request.body as any;
      const user = request.user as { userId: string };
      const id = randomUUID();
      const task = taskDb.create({
        id,
        name: body.name || 'AI Task',
        description: body.description || '',
        cron: body.cron || '',
        prompt: body.prompt || '',
        groupId: body.group_id || body.groupId || null,
        enabled: true,
        executionType: body.execution_type || body.executionType || 'agent',
        contextMode: body.context_mode || body.contextMode || 'isolated',
        scriptCommand: body.script_command || body.scriptCommand || '',
        createdBy: user.userId,
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
