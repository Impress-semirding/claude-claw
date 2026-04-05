import type { FastifyInstance } from 'fastify';
import { authMiddleware, adminMiddleware } from './auth.js';
import { mcpServerDb } from '../db.js';
import { randomUUID } from 'crypto';

export default async function mcpServersRoutes(fastify: FastifyInstance) {
  // GET /api/mcp-servers - 获取所有 MCP 服务器
  fastify.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const servers = mcpServerDb.findAll().map((s) => ({
        id: s.id,
        name: s.name,
        command: s.command,
        args: s.args || [],
        env: s.env || {},
        type: s.type || 'stdio',
        url: s.url,
        headers: s.headers,
        enabled: s.enabled,
        addedAt: new Date(s.createdAt).toISOString(),
        updated_at: new Date(s.updatedAt).toISOString(),
      }));
      return reply.send({ servers });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load MCP servers' });
    }
  });

  // POST /api/mcp-servers - 添加 MCP 服务器
  fastify.post('/', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const body = request.body as any;
      const enabled =
        body.status !== undefined ? body.status === 'active' : body.enabled ?? true;
      // Frontend may send id, type, url, headers for SSE servers
      const serverId = body.id || randomUUID();
      const server = mcpServerDb.create({
        id: serverId,
        name: body.name || body.id || 'unnamed',
        command: body.command || '',
        args: body.args || [],
        env: body.env || {},
        type: body.type || 'stdio',
        url: body.url,
        headers: body.headers,
        enabled,
      });
      return reply.status(201).send({ success: true, id: server.id });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to add MCP server' });
    }
  });

  // PATCH /api/mcp-servers/:id - 更新 MCP 服务器
  fastify.patch('/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const server = mcpServerDb.findById(id);
      if (!server) {
        return reply.status(404).send({ error: 'MCP server not found' });
      }
      const body = request.body as any;
      const updates: any = {
        name: body.name,
        command: body.command,
        args: body.args,
        env: body.env,
        type: body.type,
        url: body.url,
        headers: body.headers,
      };
      if (body.status !== undefined) {
        updates.enabled = body.status === 'active';
      } else if (body.enabled !== undefined) {
        updates.enabled = body.enabled;
      }
      mcpServerDb.update(id, updates);
      return reply.send({ success: true, id });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update MCP server' });
    }
  });

  // POST /api/mcp-servers/:id/toggle - 切换 MCP 服务器状态
  fastify.post('/:id/toggle', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const server = mcpServerDb.findById(id);
      if (!server) {
        return reply.status(404).send({ error: 'MCP server not found' });
      }
      const newEnabled = !server.enabled;
      mcpServerDb.update(id, { enabled: newEnabled });
      return reply.send({ success: true, enabled: newEnabled, status: newEnabled ? 'active' : 'inactive' });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to toggle MCP server' });
    }
  });

  // DELETE /api/mcp-servers/:id - 删除 MCP 服务器
  fastify.delete('/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      if (!mcpServerDb.findById(id)) {
        return reply.status(404).send({ error: 'MCP server not found' });
      }
      mcpServerDb.delete(id);
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to delete MCP server' });
    }
  });

  // POST /api/mcp-servers/sync-host - 同步主机 MCP 服务器
  fastify.post('/sync-host', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ added: 0, updated: 0, deleted: 0, skipped: 0 });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to sync MCP servers' });
    }
  });
}
