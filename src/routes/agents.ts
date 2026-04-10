import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth.js';
import { subAgentDb, groupDb } from '../db.js';
import { randomUUID } from 'crypto';

export default async function agentsRoutes(fastify: FastifyInstance) {
  // GET /api/groups/:jid/agents - 获取群组的 Agent 列表
  fastify.get('/:jid/agents', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const group = groupDb.findById(jid);
      if (!group) return reply.status(404).send({ error: 'Group not found' });

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const agentsList = subAgentDb.findByGroup(jid).map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description || '',
        prompt: a.prompt,
        model: a.model || null,
        tools: a.tools || [],
        is_enabled: a.isEnabled ?? true,
        status: a.status || 'idle',
        kind: 'conversation',
        created_at: new Date(a.createdAt).toISOString(),
        updated_at: new Date(a.updatedAt).toISOString(),
      }));

      return reply.send({ agents: agentsList });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load agents' });
    }
  });

  // POST /api/groups/:jid/agents - 创建 Agent
  fastify.post('/:jid/agents', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const group = groupDb.findById(jid);
      if (!group) return reply.status(404).send({ error: 'Group not found' });

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const body = request.body as any;
      const agent = subAgentDb.create({
        id: randomUUID(),
        groupId: jid,
        name: body.name,
        description: body.description || '',
        prompt: body.prompt || '',
        model: body.model || null,
        tools: body.tools || [],
        isEnabled: body.is_enabled !== undefined ? !!body.is_enabled : true,
        status: 'idle',
      });

      return reply.status(201).send({
        success: true,
        agent: {
          id: agent.id,
          name: agent.name,
          description: agent.description || '',
          prompt: agent.prompt,
          model: agent.model || null,
          tools: agent.tools || [],
          is_enabled: agent.isEnabled ?? true,
          status: agent.status,
          kind: 'conversation',
          created_at: new Date(agent.createdAt).toISOString(),
        },
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to create agent' });
    }
  });

  // PATCH /api/groups/:jid/agents/:agentId - 更新 Agent
  fastify.patch('/:jid/agents/:agentId', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const agentId = (request.params as any).agentId as string;
      const group = groupDb.findById(jid);
      if (!group) return reply.status(404).send({ error: 'Group not found' });

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const existing = subAgentDb.findById(agentId);
      if (!existing || existing.groupId !== jid) {
        return reply.status(404).send({ error: 'Agent not found' });
      }

      const body = request.body as any;
      subAgentDb.update(agentId, {
        name: body.name,
        description: body.description,
        prompt: body.prompt,
        model: body.model,
        tools: body.tools,
        isEnabled: body.is_enabled,
        status: body.status,
      });

      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update agent' });
    }
  });

  // DELETE /api/groups/:jid/agents/:agentId - 删除 Agent
  fastify.delete('/:jid/agents/:agentId', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const agentId = (request.params as any).agentId as string;
      const group = groupDb.findById(jid);
      if (!group) return reply.status(404).send({ error: 'Group not found' });

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const existing = subAgentDb.findById(agentId);
      if (!existing || existing.groupId !== jid) {
        return reply.status(404).send({ error: 'Agent not found' });
      }

      subAgentDb.delete(agentId);
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to delete agent' });
    }
  });

  // GET /api/groups/:jid/im-groups - 获取 IM 群组列表 (stub)
  fastify.get('/:jid/im-groups', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({ groups: [] });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load IM groups' });
    }
  });

  // PUT /api/groups/:jid/agents/:agentId/im-binding - 绑定 Agent 到 IM (stub)
  fastify.put('/:jid/agents/:agentId/im-binding', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to bind agent' });
    }
  });

  // DELETE /api/groups/:jid/agents/:agentId/im-binding - 解绑 Agent IM (stub)
  fastify.delete('/:jid/agents/:agentId/im-binding', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to unbind agent' });
    }
  });

  // PUT /api/groups/:jid/im-binding - 绑定群组到 IM (stub)
  fastify.put('/:jid/im-binding', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to bind group' });
    }
  });

  // DELETE /api/groups/:jid/im-binding/:imJid - 解绑群组 IM (stub)
  fastify.delete('/:jid/im-binding/:imJid', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to unbind group' });
    }
  });
}
