import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { groupDb } from '../db.js';

const workspaceConfig = new Hono();

// GET /api/groups/:jid/workspace-config/skills - 获取工作区 Skills
workspaceConfig.get('/:jid/workspace-config/skills', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid');
    const group = groupDb.findById(jid);
    if (!group) return c.json({ error: 'Group not found' }, 404);

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    return c.json({ skills: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load skills' }, 500);
  }
});

// POST /api/groups/:jid/workspace-config/skills/install - 安装 Skill
workspaceConfig.post('/:jid/workspace-config/skills/install', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid');
    const group = groupDb.findById(jid);
    if (!group) return c.json({ error: 'Group not found' }, 404);

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to install skill' }, 500);
  }
});

// PATCH /api/groups/:jid/workspace-config/skills/:id - 更新 Skill
workspaceConfig.patch('/:jid/workspace-config/skills/:id', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid');
    const group = groupDb.findById(jid);
    if (!group) return c.json({ error: 'Group not found' }, 404);

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update skill' }, 500);
  }
});

// DELETE /api/groups/:jid/workspace-config/skills/:id - 删除 Skill
workspaceConfig.delete('/:jid/workspace-config/skills/:id', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid');
    const group = groupDb.findById(jid);
    if (!group) return c.json({ error: 'Group not found' }, 404);

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete skill' }, 500);
  }
});

// GET /api/groups/:jid/workspace-config/mcp-servers - 获取工作区 MCP 服务器
workspaceConfig.get('/:jid/workspace-config/mcp-servers', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid');
    const group = groupDb.findById(jid);
    if (!group) return c.json({ error: 'Group not found' }, 404);

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    return c.json({ servers: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load MCP servers' }, 500);
  }
});

// POST /api/groups/:jid/workspace-config/mcp-servers - 添加 MCP 服务器
workspaceConfig.post('/:jid/workspace-config/mcp-servers', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid');
    const group = groupDb.findById(jid);
    if (!group) return c.json({ error: 'Group not found' }, 404);

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to add MCP server' }, 500);
  }
});

// PATCH /api/groups/:jid/workspace-config/mcp-servers/:id - 更新 MCP 服务器
workspaceConfig.patch('/:jid/workspace-config/mcp-servers/:id', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid');
    const group = groupDb.findById(jid);
    if (!group) return c.json({ error: 'Group not found' }, 404);

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update MCP server' }, 500);
  }
});

// DELETE /api/groups/:jid/workspace-config/mcp-servers/:id - 删除 MCP 服务器
workspaceConfig.delete('/:jid/workspace-config/mcp-servers/:id', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid');
    const group = groupDb.findById(jid);
    if (!group) return c.json({ error: 'Group not found' }, 404);

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete MCP server' }, 500);
  }
});

export default workspaceConfig;
