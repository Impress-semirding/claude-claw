import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  registerUser,
  loginUser,
  verifyToken,
  logoutUser,
  logAuthEvent,
  getClientIp,
  createUserSession,
} from '../services/auth.service.js';
import { userDb, inviteCodeDb, userSessionDb, groupDb } from '../db.js';
import type { IAuthToken } from '../services/auth.service.js';
import { resolve } from 'path';
import { writeFileSync, mkdirSync, createReadStream, existsSync, readFileSync } from 'fs';
import { appConfig } from '../config.js';

function readSystemConfig(): any {
  const p = resolve(appConfig.dataDir, 'config', 'system.json');
  if (existsSync(p)) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

// Register schema
const registerSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(6),
  display_name: z.string().optional(),
  invite_code: z.string().optional(),
});

// Login schema
const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

// Setup schema
const setupSchema = z.object({
  username: z.string(),
  password: z.string().min(6),
});

// Profile update schema
const profileUpdateSchema = z.object({
  username: z.string().optional(),
  display_name: z.string().nullable().optional(),
  avatar_emoji: z.string().nullable().optional(),
  avatar_color: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  ai_name: z.string().nullable().optional(),
  ai_avatar_emoji: z.string().nullable().optional(),
  ai_avatar_color: z.string().nullable().optional(),
  ai_avatar_url: z.string().nullable().optional(),
});

// Change password schema
const changePasswordSchema = z.object({
  current_password: z.string(),
  new_password: z.string().min(6),
});

// Convert user to HappyClaw UserPublic format
function toUserPublic(user: any) {
  return {
    id: user.id,
    username: user.email,
    display_name: user.name,
    role: user.role === 'admin' ? 'admin' : 'member',
    status: user.status || 'active',
    permissions: user.permissions || (user.role === 'admin'
      ? ['manage_system_config', 'manage_users', 'manage_group_env', 'manage_invites', 'view_audit_log', 'manage_billing']
      : []),
    must_change_password: false,
    disable_reason: null,
    notes: null,
    avatar_emoji: user.avatarEmoji || null,
    avatar_color: user.avatarColor || null,
    avatar_url: user.avatarUrl || null,
    ai_name: user.aiName || null,
    ai_avatar_emoji: user.aiAvatarEmoji || null,
    ai_avatar_color: user.aiAvatarColor || null,
    ai_avatar_url: user.aiAvatarUrl || null,
    created_at: new Date(user.createdAt || Date.now()).toISOString(),
    last_login_at: user.lastLoginAt ? new Date(user.lastLoginAt).toISOString() : null,
    last_active_at: user.lastActiveAt ? new Date(user.lastActiveAt).toISOString() : null,
    deleted_at: user.deletedAt ? new Date(user.deletedAt).toISOString() : null,
  };
}

function buildSetupStatus() {
  return {
    needsSetup: false,
    claudeConfigured: true,
    feishuConfigured: false,
  };
}

function setSessionCookie(_c: any, token: string): string {
  return `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}`;
}

function clearSessionCookie(_c: any): string {
  return `session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

// Auth middleware - cookie or Bearer
export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  let token: string | null = null;

  const cookie = request.headers.cookie || '';
  const sessionMatch = cookie.match(/session=([^;]+)/);
  if (sessionMatch) {
    token = sessionMatch[1];
  }

  if (!token) {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    reply.status(401).send({ error: 'Unauthorized' });
    return;
  }

  const payload = await verifyToken(token);
  if (!payload) {
    reply.status(401).send({ error: 'Invalid token' });
    return;
  }

  request.user = payload;
  request.sessionId = token;
}

// Admin middleware
export async function adminMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as IAuthToken;
  if (!user || user.role !== 'admin') {
    reply.status(403).send({ error: 'Forbidden' });
    return;
  }
}

function resolveGroupJid(jid: string): string {
  const match = jid.match(/^(.+)#agent:(.+)$/);
  return match ? match[1] : jid;
}

// Group access middleware - validates the user is a member/owner of the group in :jid
export async function groupAccessMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as IAuthToken;
  const jid = (request.params as any).jid as string | undefined;

  if (!jid) {
    reply.status(400).send({ success: false, error: 'Missing group jid' });
    return;
  }

  const groupJid = resolveGroupJid(jid);
  const group = groupDb.findById(groupJid);
  if (!group) {
    reply.status(404).send({ success: false, error: 'Group not found' });
    return;
  }

  const members = group.members || [];
  if (group.ownerId !== user.userId && !members.includes(user.userId)) {
    reply.status(403).send({ success: false, error: 'Forbidden' });
    return;
  }

  (request as any).group = {
    id: group.id,
    ownerId: group.ownerId,
    members,
    folder: group.folder,
  };
}

// Group owner middleware - validates the user is the owner of the group in :jid
export async function groupOwnerMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as IAuthToken;
  const jid = (request.params as any).jid as string | undefined;

  if (!jid) {
    reply.status(400).send({ success: false, error: 'Missing group jid' });
    return;
  }

  const groupJid = resolveGroupJid(jid);
  const group = groupDb.findById(groupJid);
  if (!group) {
    reply.status(404).send({ success: false, error: 'Group not found' });
    return;
  }

  if (group.ownerId !== user.userId && user.role !== 'admin') {
    reply.status(403).send({ success: false, error: 'Forbidden: Owner access required' });
    return;
  }

  (request as any).group = {
    id: group.id,
    ownerId: group.ownerId,
    members: group.members || [],
    folder: group.folder,
  };
}

export default async function authRoutes(fastify: FastifyInstance) {
  // Status endpoint
  fastify.get('/status', async (_request, reply) => {
    try {
      const users = userDb.findAll();
      return reply.send({ initialized: users.length > 0 });
    } catch {
      return reply.send({ initialized: true });
    }
  });

  // Setup endpoint
  fastify.post('/setup', async (request, reply) => {
    try {
      const body = request.body as any;
      const data = setupSchema.parse(body);

      const existingUsers = userDb.findAll();
      if (existingUsers.length > 0) {
        return reply.status(403).send({ error: 'System already initialized' });
      }

      const user = await registerUser(data.username, data.password, 'Admin', 'admin');
      const { generateToken } = await import('../services/auth.service.js');
      const token = await generateToken(user);

      reply.header('Set-Cookie', setSessionCookie(null, token));
      return reply.status(201).send({
        success: true,
        user: toUserPublic(user),
        setupStatus: buildSetupStatus(),
      });
    } catch (error) {
      return reply.status(400).send(
        { error: error instanceof Error ? error.message : 'Setup failed' }
      );
    }
  });

  // Register status endpoint
  fastify.get('/register/status', async (_request, reply) => {
    try {
      const users = userDb.findAll();
      if (users.length === 0) {
        return reply.send({ allowRegistration: false, requireInviteCode: true });
      }
      const system = readSystemConfig();
      return reply.send({
        allowRegistration: system.allowRegistration ?? true,
        requireInviteCode: system.requireInviteCode ?? false,
      });
    } catch {
      return reply.send({ allowRegistration: true, requireInviteCode: false });
    }
  });

  // Register endpoint
  fastify.post('/register', async (request, reply) => {
    try {
      const body = request.body as any;
      const data = registerSchema.parse(body);

      // Validate invite code if required
      const users = userDb.findAll();
      if (users.length > 0 && data.invite_code) {
        const invite = inviteCodeDb.findByCode(data.invite_code);
        if (!invite || invite.usedCount >= invite.maxUses || (invite.expiresAt && invite.expiresAt < Date.now())) {
          return reply.status(400).send({ error: 'Invalid or expired invite code' });
        }
        inviteCodeDb.use(data.invite_code);
      }

      const user = await registerUser(data.username, data.password, data.display_name || data.username);

      const { generateToken } = await import('../services/auth.service.js');
      const token = await generateToken(user);

      logAuthEvent('register_success', user.id, `Registered as ${user.role}`, getClientIp(request as any), request.headers['user-agent'] as string);

      reply.header('Set-Cookie', setSessionCookie(null, token));
      return reply.status(201).send({ success: true, user: toUserPublic(user), token });
    } catch (error) {
      return reply.status(400).send(
        { error: error instanceof Error ? error.message : 'Registration failed' }
      );
    }
  });

  // Login endpoint
  fastify.post('/login', async (request, reply) => {
    try {
      const body = request.body as any;
      const data = loginSchema.parse(body);

      const { user, token } = await loginUser(
        data.username,
        data.password,
        getClientIp(request as any),
        request.headers['user-agent'] as string
      );

      logAuthEvent('login_success', user.id, undefined, getClientIp(request as any), request.headers['user-agent'] as string);

      const userPublic = toUserPublic(user);
      const setupStatus = user.role === 'admin' ? buildSetupStatus() : undefined;

      reply.header('Set-Cookie', setSessionCookie(null, token));
      return reply.send({
        success: true,
        user: userPublic,
        token,
        setupStatus,
      });
    } catch (error) {
      logAuthEvent('login_failed', undefined, error instanceof Error ? error.message : 'Invalid credentials', getClientIp(request as any), request.headers['user-agent'] as string);
      return reply.status(401).send(
        { error: error instanceof Error ? error.message : 'Invalid credentials' }
      );
    }
  });

  // Logout endpoint
  fastify.post('/logout', { preHandler: authMiddleware }, async (request, reply) => {
    const token = (request as any).sessionId as string;
    const user = request.user as IAuthToken;
    logoutUser(token);
    if (user) {
      logAuthEvent('logout', user.userId, undefined, getClientIp(request as any), request.headers['user-agent'] as string);
    }
    reply.header('Set-Cookie', clearSessionCookie(null));
    return reply.send({ success: true });
  });

  // Me endpoint
  fastify.get('/me', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const authUser = request.user as IAuthToken;
      const fullUser = userDb.findById(authUser.userId);

      if (!fullUser) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const userPublic = toUserPublic(fullUser);
      const appearance = {
        appName: 'HappyClaw',
        aiName: fullUser.aiName || 'Claude',
        aiAvatarEmoji: fullUser.aiAvatarEmoji || '🤖',
        aiAvatarColor: fullUser.aiAvatarColor || '#0d9488',
      };

      if (fullUser.role === 'admin') {
        return reply.send({
          user: userPublic,
          appearance,
          setupStatus: buildSetupStatus(),
        });
      }

      return reply.send({ user: userPublic, appearance });
    } catch (error) {
      return reply.status(500).send(
        { error: error instanceof Error ? error.message : 'Failed to get user' }
      );
    }
  });

  // Profile update endpoint
  fastify.put('/profile', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const body = request.body as any;
      const data = profileUpdateSchema.parse(body);

      const user = request.user as IAuthToken;

      const updates: any = {};
      if (data.display_name !== undefined) updates.name = data.display_name;
      if (data.avatar_emoji !== undefined) updates.avatarEmoji = data.avatar_emoji;
      if (data.avatar_color !== undefined) updates.avatarColor = data.avatar_color;
      if (data.avatar_url !== undefined) updates.avatarUrl = data.avatar_url;
      if (data.ai_name !== undefined) updates.aiName = data.ai_name;
      if (data.ai_avatar_emoji !== undefined) updates.aiAvatarEmoji = data.ai_avatar_emoji;
      if (data.ai_avatar_color !== undefined) updates.aiAvatarColor = data.ai_avatar_color;
      if (data.ai_avatar_url !== undefined) updates.aiAvatarUrl = data.ai_avatar_url;

      if (Object.keys(updates).length > 0) {
        userDb.update(user.userId, updates);
      }

      logAuthEvent('profile_updated', user.userId, undefined, getClientIp(request as any), request.headers['user-agent'] as string);

      const updated = userDb.findById(user.userId)!;
      return reply.send({ success: true, user: toUserPublic(updated) });
    } catch (error) {
      return reply.status(400).send(
        { error: error instanceof Error ? error.message : 'Update failed' }
      );
    }
  });

  // Change password endpoint
  fastify.put('/password', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const body = request.body as any;
      const data = changePasswordSchema.parse(body);

      const user = request.user as IAuthToken;
      const fullUser = userDb.findById(user.userId);

      if (!fullUser) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const { verifyPassword, hashPassword, generateToken } = await import('../services/auth.service.js');
      const { db } = await import('../db.js');
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.userId) as { password_hash: string } | undefined;

      if (!row || !row.password_hash) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const match = await verifyPassword(data.current_password, row.password_hash);
      if (!match) {
        return reply.status(401).send({ error: 'Current password is incorrect' });
      }

      const newHash = await hashPassword(data.new_password);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.userId);

      // Revoke other sessions
      const currentToken = (request as any).sessionId as string;
      userSessionDb.revokeByUser(user.userId, currentToken);

      const newToken = await generateToken(fullUser);
      createUserSession(user.userId, newToken, getClientIp(request as any), request.headers['user-agent'] as string);

      logAuthEvent('password_changed', user.userId, undefined, getClientIp(request as any), request.headers['user-agent'] as string);

      const updated = userDb.findById(user.userId)!;
      reply.header('Set-Cookie', setSessionCookie(null, newToken));
      return reply.send({ success: true, user: toUserPublic(updated) });
    } catch (error) {
      return reply.status(400).send(
        { error: error instanceof Error ? error.message : 'Password change failed' }
      );
    }
  });

  // Sessions endpoint
  fastify.get('/sessions', { preHandler: authMiddleware }, (request, reply) => {
    const user = request.user as IAuthToken;
    const sessions = userSessionDb.findByUser(user.userId);

    return reply.send({
      sessions: sessions.map((s) => ({
        id: s.id,
        shortId: s.token.slice(0, 8),
        ip_address: s.ipAddress || '127.0.0.1',
        user_agent: s.userAgent || null,
        created_at: new Date(s.createdAt).toISOString(),
        last_active_at: new Date(s.lastActiveAt).toISOString(),
        is_current: s.token === ((request as any).sessionId as string),
      })),
    });
  });

  // Delete session endpoint
  fastify.delete('/sessions/:id', { preHandler: authMiddleware }, (request, reply) => {
    const user = request.user as IAuthToken;
    const sessions = userSessionDb.findByUser(user.userId);
    const target = sessions.find((s) => s.id === (request.params as any).id);
    if (target) {
      userSessionDb.revoke(target.id);
    }
    return reply.send({ success: true });
  });

  // Avatar upload endpoint
  fastify.post('/avatar', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const user = request.user as IAuthToken;
      const data = await request.file();
      const target = ((request.query as any).target as 'user' | 'ai') || 'ai';

      if (!data) {
        return reply.status(400).send({ error: 'No file provided' });
      }

      const avatarDir = resolve(appConfig.dataDir, 'avatars');
      mkdirSync(avatarDir, { recursive: true });

      const fileName = data.filename;
      const ext = fileName.split('.').pop() || 'png';
      const outFileName = `${user.userId}_${target}_${Date.now()}.${ext}`;
      const filePath = resolve(avatarDir, outFileName);

      const buffer = await data.toBuffer();
      writeFileSync(filePath, buffer);

      const avatarUrl = `/api/auth/avatars/${outFileName}`;
      const updates: any = {};
      if (target === 'user') {
        updates.avatarUrl = avatarUrl;
      } else {
        updates.aiAvatarUrl = avatarUrl;
      }
      userDb.update(user.userId, updates);

      const updated = userDb.findById(user.userId)!;
      return reply.send({ success: true, avatarUrl, user: toUserPublic(updated) });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Upload failed' });
    }
  });

  // Serve avatar files
  fastify.get('/avatars/:filename', async (request, reply) => {
    try {
      const filename = (request.params as any).filename as string;
      const filePath = resolve(appConfig.dataDir, 'avatars', filename);

      if (!existsSync(filePath)) {
        return reply.status(404).send({ error: 'Avatar not found' });
      }

      const ext = filename.split('.').pop() || 'png';
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : 'image/png';

      reply.header('Content-Type', mimeType);
      return reply.send(createReadStream(filePath));
    } catch {
      return reply.status(404).send({ error: 'Avatar not found' });
    }
  });
}
