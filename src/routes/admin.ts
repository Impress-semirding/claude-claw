import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from './auth.js';
import { userDb, inviteCodeDb, authAuditLogDb, userSessionDb } from '../db.js';
import { randomUUID } from 'crypto';
import { restoreUser } from '../services/auth.service.js';

const admin = new Hono();

// GET /api/admin/users - 获取用户列表
admin.get('/users', authMiddleware, adminMiddleware, async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1', 10);
    const pageSize = parseInt(c.req.query('pageSize') || '20', 10);
    const allUsers = userDb.findAll();
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const users = allUsers.slice(start, end).map((u: any) => ({
      id: u.id,
      username: u.email,
      display_name: u.name,
      role: u.role,
      status: u.status || 'active',
      created_at: new Date(u.createdAt).toISOString(),
      avatar_emoji: u.avatarEmoji || null,
      avatar_color: u.avatarColor || null,
      avatar_url: u.avatarUrl || null,
    }));
    return c.json({ users, total: allUsers.length, page, pageSize });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load users' }, 500);
  }
});

// POST /api/admin/users - 创建用户
admin.post('/users', authMiddleware, adminMiddleware, async (c) => {
  try {
    const { registerUser } = await import('../services/auth.service.js');
    const body = await c.req.json();
    const user = await registerUser(
      body.username || body.email,
      body.password,
      body.display_name || body.name || body.username || body.email,
      body.role || 'user'
    );
    return c.json({ success: true, id: user.id }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create user' }, 500);
  }
});

// PATCH /api/admin/users/:id - 更新用户
admin.patch('/users/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id')!;
    const body = await c.req.json();
    const updates: any = {};
    if (body.display_name !== undefined) updates.name = body.display_name;
    if (body.role !== undefined) updates.role = body.role;
    if (body.status !== undefined) updates.status = body.status;
    if (body.avatar_emoji !== undefined) updates.avatarEmoji = body.avatar_emoji;
    if (body.avatar_color !== undefined) updates.avatarColor = body.avatar_color;
    if (body.avatar_url !== undefined) updates.avatarUrl = body.avatar_url;
    userDb.update(id, updates);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update user' }, 500);
  }
});

// POST /api/admin/users/:id/restore - 恢复用户
admin.post('/users/:id/restore', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id')!;
    restoreUser(id);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to restore user' }, 500);
  }
});

// DELETE /api/admin/users/:id - 删除用户
admin.delete('/users/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id')!;
    userDb.update(id, { status: 'deleted', deletedAt: Date.now() });
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete user' }, 500);
  }
});

// DELETE /api/admin/users/:id/sessions - 撤销用户会话
admin.delete('/users/:id/sessions', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id')!;
    userSessionDb.revokeByUser(id);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to revoke sessions' }, 500);
  }
});

// GET /api/admin/invites - 获取邀请码列表
admin.get('/invites', authMiddleware, adminMiddleware, async (c) => {
  try {
    const invitesList = inviteCodeDb.findAll().map((i) => ({
      code: i.code,
      max_uses: i.maxUses,
      used_count: i.usedCount,
      expires_at: i.expiresAt ? new Date(i.expiresAt).toISOString() : null,
      created_at: new Date(i.createdAt).toISOString(),
    }));
    return c.json({ invites: invitesList });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load invites' }, 500);
  }
});

// POST /api/admin/invites - 创建邀请码
admin.post('/invites', authMiddleware, adminMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const code = body.code || randomUUID().slice(0, 8).toUpperCase();
    const user = c.get('user') as { userId: string };
    inviteCodeDb.create({
      code,
      maxUses: body.max_uses || body.maxUses || null,
      usedCount: 0,
      expiresAt: body.expires_at || body.expiresAt || null,
      createdBy: user.userId,
    });
    return c.json({ code });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create invite' }, 500);
  }
});

// DELETE /api/admin/invites/:code - 删除邀请码
admin.delete('/invites/:code', authMiddleware, adminMiddleware, async (c) => {
  try {
    const code = c.req.param('code')!;
    inviteCodeDb.delete(code);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete invite' }, 500);
  }
});

// GET /api/admin/audit-log - 获取审计日志
admin.get('/audit-log', authMiddleware, adminMiddleware, async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const logs = authAuditLogDb.findAll(limit + offset);
    const paginated = logs.slice(offset, offset + limit).map((l) => ({
      id: l.id,
      user_id: l.userId,
      event_type: l.eventType,
      ip_address: l.ipAddress,
      user_agent: l.userAgent,
      details: l.details,
      created_at: new Date(l.createdAt).toISOString(),
    }));
    return c.json({ logs: paginated, total: logs.length, limit, offset });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load audit logs' }, 500);
  }
});

// GET /api/admin/permission-templates - 获取权限模板
admin.get('/permission-templates', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({
      permissions: [
        { key: 'manage_system_config', label: 'Manage System Config' },
        { key: 'manage_users', label: 'Manage Users' },
        { key: 'manage_group_env', label: 'Manage Group Env' },
        { key: 'manage_invites', label: 'Manage Invites' },
        { key: 'view_audit_log', label: 'View Audit Log' },
        { key: 'manage_billing', label: 'Manage Billing' },
      ],
      templates: [],
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load templates' }, 500);
  }
});

export default admin;
