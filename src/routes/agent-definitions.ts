import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from './auth.js';
import { randomUUID } from 'crypto';
import { agentDb } from '../db.js';

const agentDefinitions = new Hono();

// GET /api/agent-definitions - 获取所有 Agent 定义
agentDefinitions.get('/', authMiddleware, async (c) => {
  try {
    const agentsList = agentDb.findAll ? agentDb.findAll() : [];
    return c.json({ agents: agentsList });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load agents' }, 500);
  }
});

// GET /api/agent-definitions/:id - 获取 Agent 定义详情
agentDefinitions.get('/:id', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const agent = agentDb.findById(id);
    if (!agent) {
      return c.json({ error: 'Agent not found' }, 404);
    }
    return c.json({ agent });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load agent' }, 500);
  }
});

// POST /api/agent-definitions - 创建 Agent 定义
agentDefinitions.post('/', authMiddleware, adminMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const id = randomUUID();
    const agent = agentDb.create({
      id,
      groupId: body.group_id || '',
      name: body.name,
      prompt: body.content || body.prompt || '',
      status: 'idle',
      kind: body.kind || 'conversation',
    });
    return c.json({ success: true, id: agent.id }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create agent' }, 500);
  }
});

// PUT /api/agent-definitions/:id - 更新 Agent 定义
agentDefinitions.put('/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const agent = agentDb.findById(id);
    if (!agent) {
      return c.json({ error: 'Agent not found' }, 404);
    }
    const body = await c.req.json();
    agentDb.update(id, {
      name: body.name,
      prompt: body.content ?? body.prompt,
      kind: body.kind,
    });
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update agent' }, 500);
  }
});

// DELETE /api/agent-definitions/:id - 删除 Agent 定义
agentDefinitions.delete('/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    if (!agentDb.findById(id)) {
      return c.json({ error: 'Agent not found' }, 404);
    }
    agentDb.delete(id);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete agent' }, 500);
  }
});

export default agentDefinitions;
