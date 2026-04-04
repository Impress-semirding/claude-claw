import type { FastifyInstance } from 'fastify';
import { authMiddleware, adminMiddleware } from './auth.js';
import { userDb, inviteCodeDb, authAuditLogDb, userSessionDb } from '../db.js';
import { randomUUID } from 'crypto';
import { restoreUser } from '../services/auth.service.js';

export default async function adminRoutes(fastify: FastifyInstance) {
  // GET /api/admin/users - 获取用户列表
  fastify.get('/users', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const page = parseInt((request.query as any).page || '1', 10);
      const pageSize = parseInt((request.query as any).pageSize || '20', 10);
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
      return reply.send({ users, total: allUsers.length, page, pageSize });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load users' });
    }
  });

  // POST /api/admin/users - 创建用户
  fastify.post('/users', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const { registerUser } = await import('../services/auth.service.js');
      const body = request.body as any;
      const user = await registerUser(
        body.username || body.email,
        body.password,
        body.display_name || body.name || body.username || body.email,
        body.role || 'user'
      );
      return reply.status(201).send({ success: true, id: user.id });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to create user' });
    }
  });

  // PATCH /api/admin/users/:id - 更新用户
  fastify.patch('/users/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const body = request.body as any;
      const updates: any = {};
      if (body.display_name !== undefined) updates.name = body.display_name;
      if (body.role !== undefined) updates.role = body.role;
      if (body.status !== undefined) updates.status = body.status;
      if (body.avatar_emoji !== undefined) updates.avatarEmoji = body.avatar_emoji;
      if (body.avatar_color !== undefined) updates.avatarColor = body.avatar_color;
      if (body.avatar_url !== undefined) updates.avatarUrl = body.avatar_url;
      userDb.update(id, updates);
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update user' });
    }
  });

  // POST /api/admin/users/:id/restore - 恢复用户
  fastify.post('/users/:id/restore', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      restoreUser(id);
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to restore user' });
    }
  });

  // DELETE /api/admin/users/:id - 删除用户
  fastify.delete('/users/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      userDb.update(id, { status: 'deleted', deletedAt: Date.now() });
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to delete user' });
    }
  });

  // DELETE /api/admin/users/:id/sessions - 撤销用户会话
  fastify.delete('/users/:id/sessions', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      userSessionDb.revokeByUser(id);
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to revoke sessions' });
    }
  });

  // GET /api/admin/invites - 获取邀请码列表
  fastify.get('/invites', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const invitesList = inviteCodeDb.findAll().map((i) => ({
        code: i.code,
        max_uses: i.maxUses,
        used_count: i.usedCount,
        expires_at: i.expiresAt ? new Date(i.expiresAt).toISOString() : null,
        created_at: new Date(i.createdAt).toISOString(),
      }));
      return reply.send({ invites: invitesList });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load invites' });
    }
  });

  // POST /api/admin/invites - 创建邀请码
  fastify.post('/invites', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const body = request.body as any;
      const code = body.code || randomUUID().slice(0, 8).toUpperCase();
      const user = request.user as { userId: string };
      inviteCodeDb.create({
        code,
        maxUses: body.max_uses || body.maxUses || null,
        usedCount: 0,
        expiresAt: body.expires_at || body.expiresAt || null,
        createdBy: user.userId,
      });
      return reply.send({ code });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to create invite' });
    }
  });

  // DELETE /api/admin/invites/:code - 删除邀请码
  fastify.delete('/invites/:code', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const code = (request.params as any).code as string;
      inviteCodeDb.delete(code);
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to delete invite' });
    }
  });

  // GET /api/admin/audit-log - 获取审计日志
  fastify.get('/audit-log', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const limit = parseInt((request.query as any).limit || '50', 10);
      const offset = parseInt((request.query as any).offset || '0', 10);
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
      return reply.send({ logs: paginated, total: logs.length, limit, offset });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load audit logs' });
    }
  });

  // GET /api/admin/permission-templates - 获取权限模板
  fastify.get('/permission-templates', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({
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
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load templates' });
    }
  });
}
