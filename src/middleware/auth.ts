import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { jwtVerify } from '../services/auth.service.js';

// Extend Fastify request type
declare module 'fastify' {
  interface FastifyRequest {
    user: { userId: string; email: string; role: string };
    sessionId?: string;
  }
}

// JWT authentication middleware - supports Bearer token and cookie
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done?: HookHandlerDoneFunction
): Promise<void> {
  let token: string | null = null;

  // Try Authorization header first
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  // Fallback to cookie
  if (!token) {
    const cookie = request.headers.cookie || '';
    const sessionMatch = cookie.match(/session=([^;]+)/);
    if (sessionMatch) {
      token = sessionMatch[1];
    }
  }

  if (!token) {
    reply.status(401).send({ success: false, error: 'Unauthorized' });
    return;
  }

  try {
    const payload = await jwtVerify(token);
    if (!payload) {
      reply.status(401).send({ success: false, error: 'Invalid token' });
      return;
    }
    request.user = payload;
    request.sessionId = token;
    if (done) done();
  } catch {
    reply.status(401).send({ success: false, error: 'Invalid token' });
  }
}

// Admin role middleware
export async function adminMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done?: HookHandlerDoneFunction
): Promise<void> {
  const user = request.user;

  if (user.role !== 'admin') {
    reply.status(403).send({ success: false, error: 'Forbidden: Admin access required' });
    return;
  }

  if (done) done();
}
