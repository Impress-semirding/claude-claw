import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from './auth.js';
import { skillDb } from '../db.js';

const skills = new Hono();

// GET /api/skills - 获取所有 Skills
skills.get('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user') as { userId: string; role: string };
    const allSkills = skillDb.findAll();
    const userSkills = allSkills.filter(
      (s) => s.userId === user.userId || s.userId === 'system' || user.role === 'admin'
    );
    return c.json({ skills: userSkills });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load skills' }, 500);
  }
});

// GET /api/skills/:id - 获取 Skill 详情
skills.get('/:id', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const skill = skillDb.findById(id);
    if (!skill) {
      return c.json({ error: 'Skill not found' }, 404);
    }
    return c.json({ skill });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load skill' }, 500);
  }
});

// POST /api/skills - 创建 Skill
skills.post('/', authMiddleware, adminMiddleware, async (c) => {
  try {
    const user = c.get('user') as { userId: string };
    const body = await c.req.json();
    const id = body.id || crypto.randomUUID();
    const skill = skillDb.create({
      id,
      userId: user.userId,
      name: body.name,
      description: body.description || '',
      source: body.source || 'user',
      enabled: body.enabled ?? true,
      content: body.content || null,
      config: body.config || {},
    });
    return c.json({ success: true, skill }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create skill' }, 500);
  }
});

// PATCH /api/skills/:id - 更新 Skill
skills.patch('/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const skill = skillDb.findById(id);
    if (!skill) {
      return c.json({ error: 'Skill not found' }, 404);
    }
    const body = await c.req.json();
    skillDb.update(id, {
      name: body.name,
      description: body.description,
      enabled: body.enabled,
      content: body.content,
      config: body.config,
    });
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update skill' }, 500);
  }
});

// DELETE /api/skills/:id - 删除 Skill
skills.delete('/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    if (!skillDb.findById(id)) {
      return c.json({ error: 'Skill not found' }, 404);
    }
    skillDb.delete(id);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete skill' }, 500);
  }
});

// POST /api/skills/install - 安装 Skill
skills.post('/install', authMiddleware, adminMiddleware, async (c) => {
  try {
    await c.req.json();
    return c.json({ success: true, message: 'Skill installed' });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to install skill' }, 500);
  }
});

// POST /api/skills/:id/reinstall - 重新安装 Skill
skills.post('/:id/reinstall', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    if (!skillDb.findById(id)) {
      return c.json({ error: 'Skill not found' }, 404);
    }
    return c.json({ success: true, message: 'Skill reinstalled' });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to reinstall skill' }, 500);
  }
});

// POST /api/skills/sync-host - 同步 Host Skills
skills.post('/sync-host', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ success: true, message: 'Skills synced' });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to sync skills' }, 500);
  }
});

// GET /api/skills/sync-status - 获取同步状态
skills.get('/sync-status', authMiddleware, async (c) => {
  try {
    return c.json({
      lastSyncAt: new Date().toISOString(),
      status: 'idle',
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to get sync status' }, 500);
  }
});

// PUT /api/skills/sync-settings - 更新同步设置
skills.put('/sync-settings', authMiddleware, adminMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    return c.json({
      autoSyncEnabled: body.autoSyncEnabled ?? false,
      autoSyncIntervalMinutes: body.autoSyncIntervalMinutes ?? 60,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update sync settings' }, 500);
  }
});

// GET /api/skills/search - 搜索 Skills
skills.get('/search', authMiddleware, async (c) => {
  try {
    const query = c.req.query('q') || '';
    const user = c.get('user') as { userId: string };
    const results = skillDb
      .findByUser(user.userId)
      .filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
      .map((s) => ({ id: s.id, name: s.name, description: s.description }));
    return c.json({ results });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to search skills' }, 500);
  }
});

// GET /api/skills/search/detail - 获取搜索结果详情
skills.get('/search/detail', authMiddleware, async (c) => {
  try {
    const id = c.req.query('id');
    if (!id) {
      return c.json({ error: 'ID is required' }, 400);
    }
    const skill = skillDb.findById(id);
    return c.json({ detail: skill || null });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to get skill detail' }, 500);
  }
});

export default skills;
