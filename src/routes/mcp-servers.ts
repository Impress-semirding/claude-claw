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
        enabled: s.enabled,
        created_at: new Date(s.createdAt).toISOString(),
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
      const server = mcpServerDb.create({
        id: randomUUID(),
        name: body.name,
        command: body.command,
        args: body.args || [],
        env: body.env || {},
        enabled: body.enabled ?? true,
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
      mcpServerDb.update(id, {
        name: body.name,
        command: body.command,
        args: body.args,
        env: body.env,
        enabled: body.enabled,
      });
      return reply.send({ success: true, id });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update MCP server' });
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
