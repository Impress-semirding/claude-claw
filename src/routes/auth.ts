import { Hono } from 'hono';
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
import { userDb, inviteCodeDb, userSessionDb } from '../db.js';
import type { IAuthToken } from '../services/auth.service.js';
import { resolve } from 'path';
import { writeFileSync, mkdirSync, createReadStream, existsSync } from 'fs';
import { appConfig } from '../config.js';

const auth = new Hono();

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
  return `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 60 * 60}`;
}

function clearSessionCookie(_c: any): string {
  return `session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

// Auth middleware - cookie or Bearer
export async function authMiddleware(c: any, next: any) {
  let token: string | null = null;

  const cookie = c.req.header('Cookie') || '';
  const sessionMatch = cookie.match(/session=([^;]+)/);
  if (sessionMatch) {
    token = sessionMatch[1];
  }

  if (!token) {
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  c.set('user', payload);
  c.set('sessionId', token);
  await next();
}

// Admin middleware
export async function adminMiddleware(c: any, next: any) {
  const user = c.get('user') as IAuthToken;
  if (!user || user.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
}

// Status endpoint
auth.get('/status', async (c) => {
  try {
    const users = userDb.findAll();
    return c.json({ initialized: users.length > 0 });
  } catch {
    return c.json({ initialized: true });
  }
});

// Setup endpoint
auth.post('/setup', async (c) => {
  try {
    const body = await c.req.json();
    const data = setupSchema.parse(body);

    const existingUsers = userDb.findAll();
    if (existingUsers.length > 0) {
      return c.json({ error: 'System already initialized' }, 403);
    }

    const user = await registerUser(data.username, data.password, 'Admin', 'admin');
    const { generateToken } = await import('../services/auth.service.js');
    const token = await generateToken(user);

    return new Response(
      JSON.stringify({
        success: true,
        user: toUserPublic(user),
        setupStatus: buildSetupStatus(),
      }),
      {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': setSessionCookie(c, token),
        },
      }
    );
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Setup failed' },
      400
    );
  }
});

// Register status endpoint
auth.get('/register/status', async (c) => {
  try {
    const users = userDb.findAll();
    if (users.length === 0) {
      return c.json({ allowRegistration: false, requireInviteCode: true });
    }
    return c.json({ allowRegistration: true, requireInviteCode: false });
  } catch {
    return c.json({ allowRegistration: true, requireInviteCode: false });
  }
});

// Register endpoint
auth.post('/register', async (c) => {
  try {
    const body = await c.req.json();
    const data = registerSchema.parse(body);

    // Validate invite code if required
    const users = userDb.findAll();
    if (users.length > 0 && data.invite_code) {
      const invite = inviteCodeDb.findByCode(data.invite_code);
      if (!invite || invite.usedCount >= invite.maxUses || (invite.expiresAt && invite.expiresAt < Date.now())) {
        return c.json({ error: 'Invalid or expired invite code' }, 400);
      }
      inviteCodeDb.use(data.invite_code);
    }

    const user = await registerUser(data.username, data.password, data.display_name || data.username);

    const { generateToken } = await import('../services/auth.service.js');
    const token = await generateToken(user);

    logAuthEvent('register_success', user.id, `Registered as ${user.role}`, getClientIp(c), c.req.header('user-agent'));

    return new Response(
      JSON.stringify({ success: true, user: toUserPublic(user), token }),
      {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': setSessionCookie(c, token),
        },
      }
    );
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Registration failed' },
      400
    );
  }
});

// Login endpoint
auth.post('/login', async (c) => {
  try {
    const body = await c.req.json();
    const data = loginSchema.parse(body);

    const { user, token } = await loginUser(
      data.username,
      data.password,
      getClientIp(c),
      c.req.header('user-agent')
    );

    logAuthEvent('login_success', user.id, undefined, getClientIp(c), c.req.header('user-agent'));

    const userPublic = toUserPublic(user);
    const setupStatus = user.role === 'admin' ? buildSetupStatus() : undefined;

    return new Response(
      JSON.stringify({
        success: true,
        user: userPublic,
        token,
        setupStatus,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': setSessionCookie(c, token),
        },
      }
    );
  } catch (error) {
    logAuthEvent('login_failed', undefined, error instanceof Error ? error.message : 'Invalid credentials', getClientIp(c), c.req.header('user-agent'));
    return c.json(
      { error: error instanceof Error ? error.message : 'Invalid credentials' },
      401
    );
  }
});

// Logout endpoint
auth.post('/logout', authMiddleware, async (c) => {
  const token = (c as any).get('sessionId') as string;
  const user = c.get('user') as IAuthToken;
  logoutUser(token);
  if (user) {
    logAuthEvent('logout', user.userId, undefined, getClientIp(c), c.req.header('user-agent'));
  }
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookie(c),
    },
  });
});

// Me endpoint
auth.get('/me', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user') as IAuthToken;
    const fullUser = userDb.findById(authUser.userId);

    if (!fullUser) {
      return c.json({ error: 'User not found' }, 404);
    }

    const userPublic = toUserPublic(fullUser);
    const appearance = {
      appName: 'HappyClaw',
      aiName: fullUser.aiName || 'Claude',
      aiAvatarEmoji: fullUser.aiAvatarEmoji || '🤖',
      aiAvatarColor: fullUser.aiAvatarColor || '#0d9488',
    };

    if (fullUser.role === 'admin') {
      return c.json({
        user: userPublic,
        appearance,
        setupStatus: buildSetupStatus(),
      });
    }

    return c.json({ user: userPublic, appearance });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to get user' },
      500
    );
  }
});

// Profile update endpoint
auth.put('/profile', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const data = profileUpdateSchema.parse(body);

    const user = c.get('user') as IAuthToken;

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

    logAuthEvent('profile_updated', user.userId, undefined, getClientIp(c), c.req.header('user-agent'));

    const updated = userDb.findById(user.userId)!;
    return c.json({ success: true, user: toUserPublic(updated) });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Update failed' },
      400
    );
  }
});

// Change password endpoint
auth.put('/password', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const data = changePasswordSchema.parse(body);

    const user = c.get('user') as IAuthToken;
    const fullUser = userDb.findById(user.userId);

    if (!fullUser) {
      return c.json({ error: 'User not found' }, 404);
    }

    const { verifyPassword, hashPassword, generateToken } = await import('../services/auth.service.js');
    const { db } = await import('../db.js');
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.userId) as { password_hash: string } | undefined;

    if (!row || !row.password_hash) {
      return c.json({ error: 'User not found' }, 404);
    }

    const match = await verifyPassword(data.current_password, row.password_hash);
    if (!match) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }

    const newHash = await hashPassword(data.new_password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.userId);

    // Revoke other sessions
    const currentToken = (c as any).get('sessionId') as string;
    userSessionDb.revokeByUser(user.userId, currentToken);

    const newToken = await generateToken(fullUser);
    createUserSession(user.userId, newToken, getClientIp(c), c.req.header('user-agent'));

    logAuthEvent('password_changed', user.userId, undefined, getClientIp(c), c.req.header('user-agent'));

    const updated = userDb.findById(user.userId)!;
    return new Response(
      JSON.stringify({ success: true, user: toUserPublic(updated) }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': setSessionCookie(c, newToken),
        },
      }
    );
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Password change failed' },
      400
    );
  }
});

// Sessions endpoint
auth.get('/sessions', authMiddleware, (c) => {
  const user = c.get('user') as IAuthToken;
  const sessions = userSessionDb.findByUser(user.userId);

  return c.json({
    sessions: sessions.map((s) => ({
      shortId: s.token.slice(0, 8),
      ip_address: s.ipAddress || '127.0.0.1',
      user_agent: s.userAgent || null,
      created_at: new Date(s.createdAt).toISOString(),
      last_active_at: new Date(s.lastActiveAt).toISOString(),
      is_current: s.token === ((c as any).get('sessionId') as string),
    })),
  });
});

// Delete session endpoint
auth.delete('/sessions/:id', authMiddleware, (c) => {
  const user = c.get('user') as IAuthToken;
  const sessions = userSessionDb.findByUser(user.userId);
  const target = sessions.find((s) => s.token.slice(0, 8) === c.req.param('id'));
  if (target) {
    userSessionDb.revoke(target.id);
  }
  return c.json({ success: true });
});

// Avatar upload endpoint
auth.post('/avatar', authMiddleware, async (c) => {
  try {
    const user = c.get('user') as IAuthToken;
    const body = await c.req.parseBody();
    const file = body.avatar as File;
    const target = (c.req.query('target') as 'user' | 'ai') || 'ai';

    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const avatarDir = resolve(appConfig.dataDir, 'avatars');
    mkdirSync(avatarDir, { recursive: true });

    const ext = file.name.split('.').pop() || 'png';
    const fileName = `${user.userId}_${target}_${Date.now()}.${ext}`;
    const filePath = resolve(avatarDir, fileName);

    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(filePath, buffer);

    const avatarUrl = `/api/auth/avatars/${fileName}`;
    const updates: any = {};
    if (target === 'user') {
      updates.avatarUrl = avatarUrl;
    } else {
      updates.aiAvatarUrl = avatarUrl;
    }
    userDb.update(user.userId, updates);

    const updated = userDb.findById(user.userId)!;
    return c.json({ success: true, avatarUrl, user: toUserPublic(updated) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Upload failed' }, 500);
  }
});

// Serve avatar files
auth.get('/avatars/:filename', async (c) => {
  try {
    const filename = c.req.param('filename');
    const filePath = resolve(appConfig.dataDir, 'avatars', filename);

    if (!existsSync(filePath)) {
      return c.json({ error: 'Avatar not found' }, 404);
    }

    const ext = filename.split('.').pop() || 'png';
    const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : 'image/png';

    const stream = createReadStream(filePath);
    return new Response(stream as any, {
      headers: { 'Content-Type': mimeType },
    });
  } catch {
    return c.json({ error: 'Avatar not found' }, 404);
  }
});

export default auth;
