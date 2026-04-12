import { hash, compare } from 'bcryptjs';
import { SignJWT, jwtVerify as joseJwtVerify } from 'jose';
import { v4 as uuidv4 } from 'uuid';
import { appConfig } from '../config.js';
import { userDb, authAuditLogDb, userSessionDb } from '../db.js';
import type { IUser } from '../types.js';

const JWT_SECRET = new TextEncoder().encode(appConfig.jwtSecret);
const TOKEN_EXPIRY = '7d';

export interface IAuthToken {
  userId: string;
  email: string;
  role: string;
}

// Hash password
export async function hashPassword(password: string): Promise<string> {
  return hash(password, 10);
}

// Verify password
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return compare(password, hash);
}

// Generate JWT token
export async function generateToken(user: IUser): Promise<string> {
  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET);

  return token;
}

// Verify JWT token (also checks revocation and user status)
export async function verifyToken(token: string): Promise<IAuthToken | null> {
  try {
    const { payload } = await joseJwtVerify(token, JWT_SECRET);
    const userId = payload.userId as string;

    // Check session is active and not expired
    const session = userSessionDb.findByToken(token);
    if (!session || session.status !== 'active' || session.expiresAt < Date.now()) {
      return null;
    }

    // Check user status
    const user = userDb.findById(userId);
    if (!user || user.status === 'deleted' || user.status === 'disabled') {
      return null;
    }

    return {
      userId,
      email: payload.email as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

// Alias for middleware compatibility
export { verifyToken as jwtVerify };

// Audit log helper
export function logAuthEvent(
  eventType: string,
  userId?: string,
  details?: string,
  ipAddress?: string,
  userAgent?: string
) {
  authAuditLogDb.create({
    id: uuidv4(),
    userId,
    eventType,
    ipAddress,
    userAgent,
    details,
  });
}

// Create user session record
export function createUserSession(
  userId: string,
  token: string,
  ipAddress?: string,
  userAgent?: string
) {
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 days
  userSessionDb.create({
    id: uuidv4(),
    userId,
    token,
    expiresAt,
    lastActiveAt: now,
    ipAddress,
    userAgent,
    status: 'active',
  });
}

// Register user
export async function registerUser(
  email: string,
  password: string,
  name: string,
  role: 'admin' | 'user' = 'user'
): Promise<IUser> {
  const existing = userDb.findByEmail(email);
  if (existing) {
    throw new Error('User already exists');
  }

  const passwordHash = await hashPassword(password);

  const user = userDb.create({
    id: uuidv4(),
    email,
    name,
    role,
    passwordHash,
  });

  return user;
}

// Login user
export async function loginUser(
  email: string,
  password: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ user: IUser; token: string }> {
  const { db } = await import('../db.js');
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
    | (IUser & { password_hash?: string })
    | undefined;

  if (!row) {
    throw new Error('Invalid credentials');
  }

  const { password_hash, ...user } = row;
  if (!password_hash) {
    throw new Error('Invalid credentials');
  }

  const valid = await verifyPassword(password, password_hash);
  if (!valid) {
    throw new Error('Invalid credentials');
  }

  const token = await generateToken(user as IUser);
  createUserSession(user.id, token, ipAddress, userAgent);

  // Update last login
  userDb.update(user.id, { lastLoginAt: Date.now(), lastActiveAt: Date.now() });

  return { user: user as IUser, token };
}

// Logout user (revoke session)
export function logoutUser(token: string): void {
  const session = userSessionDb.findByToken(token);
  if (session) {
    userSessionDb.revoke(session.id);
  }
}

// Get user by ID
export function getUserById(id: string): IUser | undefined {
  return userDb.findById(id);
}

// Get user by email
export function getUserByEmail(email: string): IUser | undefined {
  return userDb.findByEmail(email);
}

// List all users
export function listUsers(): IUser[] {
  return userDb.findActive();
}

// Update user
export function updateUser(id: string, data: Partial<IUser>): void {
  userDb.update(id, data);
}

// Delete user (soft delete)
export function deleteUser(id: string): void {
  userDb.update(id, { status: 'deleted', deletedAt: Date.now() });
}

// Restore user
export function restoreUser(id: string): void {
  userDb.update(id, { status: 'active', deletedAt: undefined });
}

const WEAK_PASSWORDS = new Set(['admin123', 'password', '123456', 'qwerty', 'admin']);

function isWeakPassword(password: string): boolean {
  if (WEAK_PASSWORDS.has(password.toLowerCase())) return true;
  if (password.length < 8) return true;
  return false;
}

// Initialize admin user
export async function initAdminUser(): Promise<void> {
  if (isWeakPassword(appConfig.adminPassword) && process.env.NODE_ENV === 'production') {
    console.error('\n\n╔════════════════════════════════════════════════════════════════╗');
    console.error('║ SECURITY ALERT: Default/weak admin password detected.         ║');
    console.error('║ Please set a strong ADMIN_PASSWORD in your environment.       ║');
    console.error('╚════════════════════════════════════════════════════════════════╝\n');
    process.exit(1);
  }

  const existing = userDb.findByEmail(appConfig.adminEmail);
  if (!existing) {
    const passwordHash = await hashPassword(appConfig.adminPassword);
    userDb.create({
      id: uuidv4(),
      email: appConfig.adminEmail,
      name: 'Admin',
      role: 'admin',
      passwordHash,
    });
    console.log(`Admin user created: ${appConfig.adminEmail}`);
  }

  if (isWeakPassword(appConfig.adminPassword)) {
    console.warn('\n[SECURITY WARNING] Admin password is weak. Please change it in production.\n');
  }
}

// Get client IP from request headers (Fastify or Hono compat)
export function getClientIp(c: any): string {
  // Fastify request has headers object directly
  const headers = c.headers || (c.req && c.req.headers) || {};
  const forwarded = headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return headers['x-real-ip'] || '127.0.0.1';
}
