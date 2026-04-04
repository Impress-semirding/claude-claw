import type { FastifyInstance } from 'fastify';
import { authMiddleware, adminMiddleware } from './auth.js';
import { randomUUID } from 'crypto';
import { agentDb } from '../db.js';

export default async function agentDefinitionsRoutes(fastify: FastifyInstance) {
  // GET /api/agent-definitions - 获取所有 Agent 定义
  fastify.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const agentsList = agentDb.findAll ? agentDb.findAll() : [];
      return reply.send({ agents: agentsList });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load agents' });
    }
  });

  // GET /api/agent-definitions/:id - 获取 Agent 定义详情
  fastify.get('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const agent = agentDb.findById(id);
      if (!agent) {
        return reply.status(404).send({ error: 'Agent not found' });
      }
      return reply.send({ agent });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load agent' });
    }
  });

  // POST /api/agent-definitions - 创建 Agent 定义
  fastify.post('/', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const body = request.body as any;
      const id = randomUUID();
      const agent = agentDb.create({
        id,
        groupId: body.group_id || '',
        name: body.name,
        prompt: body.content || body.prompt || '',
        status: 'idle',
        kind: body.kind || 'conversation',
      });
      return reply.status(201).send({ success: true, id: agent.id });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to create agent' });
    }
  });

  // PUT /api/agent-definitions/:id - 更新 Agent 定义
  fastify.put('/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const agent = agentDb.findById(id);
      if (!agent) {
        return reply.status(404).send({ error: 'Agent not found' });
      }
      const body = request.body as any;
      agentDb.update(id, {
        name: body.name,
        prompt: body.content ?? body.prompt,
        kind: body.kind,
      });
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update agent' });
    }
  });

  // DELETE /api/agent-definitions/:id - 删除 Agent 定义
  fastify.delete('/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      if (!agentDb.findById(id)) {
        return reply.status(404).send({ error: 'Agent not found' });
      }
      agentDb.delete(id);
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to delete agent' });
    }
  });
}
