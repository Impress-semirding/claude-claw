import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { agentDb, groupDb } from '../db.js';
import { randomUUID } from 'crypto';

const agents = new Hono();

// GET /api/groups/:jid/agents - 获取群组的 Agent 列表
agents.get('/:jid/agents', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid');
    const group = groupDb.findById(jid);
    if (!group) return c.json({ error: 'Group not found' }, 404);

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const agentsList = agentDb.findByGroup(jid).map((a) => ({
      id: a.id,
      name: a.name,
      prompt: a.prompt,
      status: a.status || 'idle',
      kind: a.kind || 'conversation',
      created_at: new Date(a.createdAt).toISOString(),
      updated_at: new Date(a.updatedAt).toISOString(),
    }));

    return c.json({ agents: agentsList });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load agents' }, 500);
  }
});

// POST /api/groups/:jid/agents - 创建 Agent
agents.post('/:jid/agents', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid');
    const group = groupDb.findById(jid);
    if (!group) return c.json({ error: 'Group not found' }, 404);

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const body = await c.req.json();
    const agent = agentDb.create({
      id: randomUUID(),
      groupId: jid,
      name: body.name,
      prompt: body.prompt || '',
      status: 'idle',
      kind: body.kind || 'conversation',
    });

    return c.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        prompt: agent.prompt,
        status: agent.status,
        kind: agent.kind,
        created_at: new Date(agent.createdAt).toISOString(),
      },
    }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create agent' }, 500);
  }
});

// PATCH /api/groups/:jid/agents/:agentId - 更新 Agent
agents.patch('/:jid/agents/:agentId', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid');
    const agentId = c.req.param('agentId');
    const group = groupDb.findById(jid);
    if (!group) return c.json({ error: 'Group not found' }, 404);

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const existing = agentDb.findById(agentId);
    if (!existing || existing.groupId !== jid) {
      return c.json({ error: 'Agent not found' }, 404);
    }

    const body = await c.req.json();
    agentDb.update(agentId, {
      name: body.name,
      prompt: body.prompt,
      status: body.status,
      kind: body.kind,
    });

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update agent' }, 500);
  }
});

// DELETE /api/groups/:jid/agents/:agentId - 删除 Agent
agents.delete('/:jid/agents/:agentId', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid');
    const agentId = c.req.param('agentId');
    const group = groupDb.findById(jid);
    if (!group) return c.json({ error: 'Group not found' }, 404);

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const existing = agentDb.findById(agentId);
    if (!existing || existing.groupId !== jid) {
      return c.json({ error: 'Agent not found' }, 404);
    }

    agentDb.delete(agentId);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete agent' }, 500);
  }
});

// GET /api/groups/:jid/im-groups - 获取 IM 群组列表 (stub)
agents.get('/:jid/im-groups', authMiddleware, async (c) => {
  try {
    return c.json({ groups: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load IM groups' }, 500);
  }
});

// PUT /api/groups/:jid/agents/:agentId/im-binding - 绑定 Agent 到 IM (stub)
agents.put('/:jid/agents/:agentId/im-binding', authMiddleware, async (c) => {
  try {
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to bind agent' }, 500);
  }
});

// DELETE /api/groups/:jid/agents/:agentId/im-binding - 解绑 Agent IM (stub)
agents.delete('/:jid/agents/:agentId/im-binding', authMiddleware, async (c) => {
  try {
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to unbind agent' }, 500);
  }
});

// PUT /api/groups/:jid/im-binding - 绑定群组到 IM (stub)
agents.put('/:jid/im-binding', authMiddleware, async (c) => {
  try {
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to bind group' }, 500);
  }
});

// DELETE /api/groups/:jid/im-binding/:imJid - 解绑群组 IM (stub)
agents.delete('/:jid/im-binding/:imJid', authMiddleware, async (c) => {
  try {
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to unbind group' }, 500);
  }
});

export default agents;
