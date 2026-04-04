import type { MiddlewareHandler } from 'hono';
import { jwtVerify } from '../services/auth.service.js';

// Extend Hono context type
declare module 'hono' {
  interface ContextVariableMap {
    user: { userId: string; email: string; role: string };
    sessionId?: string;
  }
}

// JWT authentication middleware - supports Bearer token and cookie
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  let token: string | null = null;

  // Try Authorization header first
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  // Fallback to cookie
  if (!token) {
    const cookie = c.req.header('Cookie') || '';
    const sessionMatch = cookie.match(/session=([^;]+)/);
    if (sessionMatch) {
      token = sessionMatch[1];
    }
  }

  if (!token) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    const payload = await jwtVerify(token);
    if (!payload) {
      return c.json({ success: false, error: 'Invalid token' }, 401);
    }
    c.set('user', payload);
    c.set('sessionId', token);
    await next();
    return;
  } catch {
    return c.json({ success: false, error: 'Invalid token' }, 401);
  }
};

// Admin role middleware
export const adminMiddleware: MiddlewareHandler = async (c, next) => {
  const user = c.get('user');

  if (user.role !== 'admin') {
    return c.json({ success: false, error: 'Forbidden: Admin access required' }, 403);
  }

  await next();
  return;
};
