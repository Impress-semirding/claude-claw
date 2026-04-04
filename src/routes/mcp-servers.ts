import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from './auth.js';
import { mcpServerDb } from '../db.js';
import { randomUUID } from 'crypto';

const mcpServers = new Hono();

// GET /api/mcp-servers - 获取所有 MCP 服务器
mcpServers.get('/', authMiddleware, async (c) => {
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
    return c.json({ servers });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load MCP servers' }, 500);
  }
});

// POST /api/mcp-servers - 添加 MCP 服务器
mcpServers.post('/', authMiddleware, adminMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const server = mcpServerDb.create({
      id: randomUUID(),
      name: body.name,
      command: body.command,
      args: body.args || [],
      env: body.env || {},
      enabled: body.enabled ?? true,
    });
    return c.json({ success: true, id: server.id }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to add MCP server' }, 400);
  }
});

// PATCH /api/mcp-servers/:id - 更新 MCP 服务器
mcpServers.patch('/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const server = mcpServerDb.findById(id);
    if (!server) {
      return c.json({ error: 'MCP server not found' }, 404);
    }
    const body = await c.req.json();
    mcpServerDb.update(id, {
      name: body.name,
      command: body.command,
      args: body.args,
      env: body.env,
      enabled: body.enabled,
    });
    return c.json({ success: true, id });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update MCP server' }, 400);
  }
});

// DELETE /api/mcp-servers/:id - 删除 MCP 服务器
mcpServers.delete('/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    if (!mcpServerDb.findById(id)) {
      return c.json({ error: 'MCP server not found' }, 404);
    }
    mcpServerDb.delete(id);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete MCP server' }, 500);
  }
});

// POST /api/mcp-servers/sync-host - 同步主机 MCP 服务器
mcpServers.post('/sync-host', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ added: 0, updated: 0, deleted: 0, skipped: 0 });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to sync MCP servers' }, 500);
  }
});

export default mcpServers;
