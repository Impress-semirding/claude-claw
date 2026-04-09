import Database from 'better-sqlite3';
import { resolve } from 'path';
import { appConfig } from './config.js';
import type {
  IUser,
  IGroup,
  IMessage,
  IMcpServer,
  ITask,
  ITaskLog,
  IBillingRecord,
  IInviteCode,
  IAuthAuditLog,
  IUserSession,
  ISkill,
  IAgent,
} from './types.js';

// Initialize database
const dbPath = resolve(appConfig.databaseUrl);
const db: Database.Database = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Schema version for migrations
const SCHEMA_VERSION = 5;

// Initialize schema
export function initSchema() {
  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT,
      role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'deleted')),
      avatar_emoji TEXT,
      avatar_color TEXT,
      avatar_url TEXT,
      ai_name TEXT,
      ai_avatar_emoji TEXT,
      ai_avatar_color TEXT,
      ai_avatar_url TEXT,
      permissions TEXT DEFAULT '[]',
      last_login_at INTEGER,
      last_active_at INTEGER,
      deleted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Groups table
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      owner_id TEXT NOT NULL,
      members TEXT NOT NULL DEFAULT '[]',
      config TEXT NOT NULL DEFAULT '{}',
      folder TEXT,
      is_home INTEGER DEFAULT 0,
      pinned_at INTEGER,
      execution_mode TEXT DEFAULT 'host' CHECK(execution_mode IN ('host', 'container')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace TEXT NOT NULL,
      agent_id TEXT,
      sdk_session_id TEXT,
      last_assistant_uuid TEXT,
      config_dir TEXT NOT NULL,
      work_dir TEXT NOT NULL,
      tmp_dir TEXT NOT NULL,
      status TEXT DEFAULT 'idle' CHECK(status IN ('idle', 'running', 'error', 'destroyed')),
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL
    )
  `);

  // Messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      attachments TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  // MCP servers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      args TEXT NOT NULL DEFAULT '[]',
      env TEXT,
      type TEXT DEFAULT 'stdio',
      url TEXT,
      headers TEXT,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // IM channels table
  db.exec(`
    CREATE TABLE IF NOT EXISTS im_channels (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('feishu', 'telegram', 'qq', 'dingtalk', 'wechat')),
      config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Tasks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      cron TEXT NOT NULL,
      prompt TEXT NOT NULL,
      group_id TEXT,
      enabled INTEGER DEFAULT 1,
      last_run_at INTEGER,
      next_run_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Task logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'error', 'running')),
      result TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `);

  // Billing records table
  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('input', 'output', 'tool')),
      tokens INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // Invite codes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY,
      max_uses INTEGER NOT NULL DEFAULT 1,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Auth audit log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      event_type TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      details TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  // User sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
      created_at INTEGER NOT NULL
    )
  `);

  // Skills table
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      source TEXT DEFAULT 'user' CHECK(source IN ('user', 'project', 'host')),
      enabled INTEGER DEFAULT 1,
      content TEXT,
      config TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Agents table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT DEFAULT 'idle' CHECK(status IN ('idle', 'running', 'completed', 'error')),
      kind TEXT DEFAULT 'conversation' CHECK(kind IN ('task', 'conversation', 'spawn')),
      result_summary TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Group env table
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_env (
      group_id TEXT PRIMARY KEY,
      env TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Schema version tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )
  `);

  // Create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_billing_user ON billing_records(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs(task_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_log_user ON auth_audit_log(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_group ON agents(group_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_skills_user ON skills(user_id)`);

  // Run migrations
  runMigrations();
}

function runMigrations() {
  const row = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as
    | { version: number }
    | undefined;
  const currentVersion = row?.version || 0;

  if (currentVersion < 1) {
    // Migration v1: add columns to existing tables if they were created before
    try {
      db.exec(`ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'`);
    } catch { /* may already exist */ }
    try {
      db.exec(`ALTER TABLE users ADD COLUMN avatar_emoji TEXT`);
    } catch { /* may already exist */ }
    try {
      db.exec(`ALTER TABLE users ADD COLUMN avatar_color TEXT`);
    } catch { /* may already exist */ }
    try {
      db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT`);
    } catch { /* may already exist */ }
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ai_name TEXT`);
    } catch { /* may already exist */ }
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ai_avatar_emoji TEXT`);
    } catch { /* may already exist */ }
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ai_avatar_color TEXT`);
    } catch { /* may already exist */ }
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ai_avatar_url TEXT`);
    } catch { /* may already exist */ }
    try {
      db.exec(`ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT '[]'`);
    } catch { /* may already exist */ }
    try {
      db.exec(`ALTER TABLE users ADD COLUMN last_login_at INTEGER`);
    } catch { /* may already exist */ }
    try {
      db.exec(`ALTER TABLE users ADD COLUMN last_active_at INTEGER`);
    } catch { /* may already exist */ }
    try {
      db.exec(`ALTER TABLE users ADD COLUMN deleted_at INTEGER`);
    } catch { /* may already exist */ }
    try {
      db.exec(`ALTER TABLE groups ADD COLUMN folder TEXT`);
    } catch { /* may already exist */ }
    try {
      db.exec(`ALTER TABLE groups ADD COLUMN is_home INTEGER DEFAULT 0`);
    } catch { /* may already exist */ }
    try {
      db.exec(`ALTER TABLE groups ADD COLUMN pinned_at INTEGER`);
    } catch { /* may already exist */ }
    try {
      db.exec(`ALTER TABLE groups ADD COLUMN execution_mode TEXT DEFAULT 'host'`);
    } catch { /* may already exist */ }
  }

  if (currentVersion < 2) {
    // Migration v2: nothing additional, tables created above
  }

  if (currentVersion < 3) {
    try { db.exec(`ALTER TABLE mcp_servers ADD COLUMN type TEXT DEFAULT 'stdio'`); } catch { /* may already exist */ }
    try { db.exec(`ALTER TABLE mcp_servers ADD COLUMN url TEXT`); } catch { /* may already exist */ }
    try { db.exec(`ALTER TABLE mcp_servers ADD COLUMN headers TEXT`); } catch { /* may already exist */ }
  }

  if (currentVersion < 4) {
    try { db.exec(`ALTER TABLE sessions ADD COLUMN agent_id TEXT`); } catch { /* may already exist */ }
  }

  if (currentVersion < 5) {
    try { db.exec(`ALTER TABLE sessions ADD COLUMN last_assistant_uuid TEXT`); } catch { /* may already exist */ }
  }

  db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
}

// User operations
export const userDb = {
  create(user: Omit<IUser, 'createdAt' | 'updatedAt'> & { passwordHash?: string }) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO users (id, email, name, password_hash, role, status, avatar_emoji, avatar_color, avatar_url,
        ai_name, ai_avatar_emoji, ai_avatar_color, ai_avatar_url, permissions, last_login_at, last_active_at,
        deleted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      user.id,
      user.email,
      user.name,
      user.passwordHash || null,
      user.role,
      user.status || 'active',
      user.avatarEmoji || null,
      user.avatarColor || null,
      user.avatarUrl || null,
      user.aiName || null,
      user.aiAvatarEmoji || null,
      user.aiAvatarColor || null,
      user.aiAvatarUrl || null,
      JSON.stringify(user.permissions || []),
      user.lastLoginAt || null,
      user.lastActiveAt || null,
      user.deletedAt || null,
      now,
      now
    );
    return { ...user, createdAt: now, updatedAt: now };
  },

  findByEmail(email: string): IUser | undefined {
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    const permissions = row.permissions;
    return {
      id: row.id as string,
      email: row.email as string,
      name: row.name as string,
      role: row.role as 'admin' | 'user',
      status: (row.status as IUser['status']) || 'active',
      avatarEmoji: row.avatar_emoji as string | null | undefined,
      avatarColor: row.avatar_color as string | null | undefined,
      avatarUrl: row.avatar_url as string | null | undefined,
      aiName: row.ai_name as string | null | undefined,
      aiAvatarEmoji: row.ai_avatar_emoji as string | null | undefined,
      aiAvatarColor: row.ai_avatar_color as string | null | undefined,
      aiAvatarUrl: row.ai_avatar_url as string | null | undefined,
      permissions: permissions ? JSON.parse((permissions as unknown) as string) : [],
      lastLoginAt: row.last_login_at as number | null | undefined,
      lastActiveAt: row.last_active_at as number | null | undefined,
      deletedAt: row.deleted_at as number | null | undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    } as IUser;
  },

  findById(id: string): IUser | undefined {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    const permissions = row.permissions;
    return {
      id: row.id as string,
      email: row.email as string,
      name: row.name as string,
      role: row.role as 'admin' | 'user',
      status: (row.status as IUser['status']) || 'active',
      avatarEmoji: row.avatar_emoji as string | null | undefined,
      avatarColor: row.avatar_color as string | null | undefined,
      avatarUrl: row.avatar_url as string | null | undefined,
      aiName: row.ai_name as string | null | undefined,
      aiAvatarEmoji: row.ai_avatar_emoji as string | null | undefined,
      aiAvatarColor: row.ai_avatar_color as string | null | undefined,
      aiAvatarUrl: row.ai_avatar_url as string | null | undefined,
      permissions: permissions ? JSON.parse((permissions as unknown) as string) : [],
      lastLoginAt: row.last_login_at as number | null | undefined,
      lastActiveAt: row.last_active_at as number | null | undefined,
      deletedAt: row.deleted_at as number | null | undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    } as IUser;
  },

  findAll(): IUser[] {
    const rows = db.prepare('SELECT * FROM users').all() as Record<string, unknown>[];
    return rows.map((row) => {
      const permissions = row.permissions;
      return {
        id: row.id as string,
        email: row.email as string,
        name: row.name as string,
        role: row.role as 'admin' | 'user',
        status: (row.status as IUser['status']) || 'active',
        avatarEmoji: row.avatar_emoji as string | null | undefined,
        avatarColor: row.avatar_color as string | null | undefined,
        avatarUrl: row.avatar_url as string | null | undefined,
        aiName: row.ai_name as string | null | undefined,
        aiAvatarEmoji: row.ai_avatar_emoji as string | null | undefined,
        aiAvatarColor: row.ai_avatar_color as string | null | undefined,
        aiAvatarUrl: row.ai_avatar_url as string | null | undefined,
        permissions: permissions ? JSON.parse((permissions as unknown) as string) : [],
        lastLoginAt: row.last_login_at as number | null | undefined,
        lastActiveAt: row.last_active_at as number | null | undefined,
        deletedAt: row.deleted_at as number | null | undefined,
        createdAt: row.created_at as number,
        updatedAt: row.updated_at as number,
      } as IUser;
    });
  },

  findActive(): IUser[] {
    const rows = db.prepare("SELECT * FROM users WHERE status != 'deleted'").all() as Record<string, unknown>[];
    return rows.map((row) => {
      const permissions = row.permissions;
      return {
        id: row.id as string,
        email: row.email as string,
        name: row.name as string,
        role: row.role as 'admin' | 'user',
        status: (row.status as IUser['status']) || 'active',
        avatarEmoji: row.avatar_emoji as string | null | undefined,
        avatarColor: row.avatar_color as string | null | undefined,
        avatarUrl: row.avatar_url as string | null | undefined,
        aiName: row.ai_name as string | null | undefined,
        aiAvatarEmoji: row.ai_avatar_emoji as string | null | undefined,
        aiAvatarColor: row.ai_avatar_color as string | null | undefined,
        aiAvatarUrl: row.ai_avatar_url as string | null | undefined,
        permissions: permissions ? JSON.parse((permissions as unknown) as string) : [],
        lastLoginAt: row.last_login_at as number | null | undefined,
        lastActiveAt: row.last_active_at as number | null | undefined,
        deletedAt: row.deleted_at as number | null | undefined,
        createdAt: row.created_at as number,
        updatedAt: row.updated_at as number,
      } as IUser;
    });
  },

  update(id: string, data: Partial<IUser>) {
    const fields: string[] = [];
    const values: unknown[] = [];

    const map: Record<string, string> = {
      email: 'email',
      name: 'name',
      role: 'role',
      status: 'status',
      avatarEmoji: 'avatar_emoji',
      avatarColor: 'avatar_color',
      avatarUrl: 'avatar_url',
      aiName: 'ai_name',
      aiAvatarEmoji: 'ai_avatar_emoji',
      aiAvatarColor: 'ai_avatar_color',
      aiAvatarUrl: 'ai_avatar_url',
      permissions: 'permissions',
      lastLoginAt: 'last_login_at',
      lastActiveAt: 'last_active_at',
      deletedAt: 'deleted_at',
    };

    for (const [key, col] of Object.entries(map)) {
      if (key in data) {
        fields.push(`${col} = ?`);
        const val = (data as Record<string, unknown>)[key];
        values.push(key === 'permissions' && Array.isArray(val) ? JSON.stringify(val) : val);
      }
    }

    if (fields.length === 0) return;
    const stmt = db.prepare(`UPDATE users SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`);
    stmt.run(...values, Date.now(), id);
  },

  delete(id: string) {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  },
};

// Group operations
export const groupDb = {
  create(group: Omit<IGroup, 'createdAt' | 'updatedAt'>) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO groups (id, name, description, owner_id, members, config, folder, is_home, pinned_at,
        execution_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      group.id,
      group.name,
      group.description || null,
      group.ownerId,
      JSON.stringify(group.members || []),
      JSON.stringify(group.config || {}),
      group.folder || group.id,
      group.isHome ? 1 : 0,
      group.pinnedAt || null,
      group.executionMode || 'host',
      now,
      now
    );
    return { ...group, createdAt: now, updatedAt: now };
  },

  findById(id: string): IGroup | undefined {
    const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as
      | (Omit<IGroup, 'members' | 'config' | 'ownerId' | 'isHome'> & {
          members: string;
          config: string;
          owner_id: string;
          is_home: number;
        })
      | undefined;
    if (!row) return undefined;
    return {
      ...row,
      ownerId: row.owner_id,
      members: JSON.parse(row.members),
      config: JSON.parse(row.config),
      isHome: Boolean(row.is_home),
    } as IGroup;
  },

  findByUser(userId: string): IGroup[] {
    const rows = db
      .prepare("SELECT * FROM groups WHERE owner_id = ? OR members LIKE ?")
      .all(userId, `%"${userId}"%`) as (Omit<IGroup, 'members' | 'config' | 'ownerId' | 'isHome'> & {
      members: string;
      config: string;
      owner_id: string;
      is_home: number;
    })[];
    return rows.map((row) => ({
      ...row,
      ownerId: row.owner_id,
      members: JSON.parse(row.members),
      config: JSON.parse(row.config),
      isHome: Boolean(row.is_home),
    })) as IGroup[];
  },

  findAll(): IGroup[] {
    const rows = db.prepare('SELECT * FROM groups').all() as (Omit<IGroup, 'members' | 'config' | 'ownerId' | 'isHome'> & {
      members: string;
      config: string;
      owner_id: string;
      is_home: number;
    })[];
    return rows.map((row) => ({
      ...row,
      ownerId: row.owner_id,
      members: JSON.parse(row.members),
      config: JSON.parse(row.config),
      isHome: Boolean(row.is_home),
    })) as IGroup[];
  },

  update(id: string, data: Partial<IGroup>) {
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.members !== undefined) updates.members = JSON.stringify(data.members);
    if (data.config !== undefined) updates.config = JSON.stringify(data.config);
    if (data.folder !== undefined) updates.folder = data.folder;
    if (data.isHome !== undefined) updates.is_home = data.isHome ? 1 : 0;
    if (data.pinnedAt !== undefined) updates.pinned_at = data.pinnedAt;
    if (data.executionMode !== undefined) updates.execution_mode = data.executionMode;

    const fields = Object.keys(updates);
    if (fields.length === 0) return;

    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => updates[f]);
    const stmt = db.prepare(`UPDATE groups SET ${setClause}, updated_at = ? WHERE id = ?`);
    stmt.run(...values, Date.now(), id);
  },

  delete(id: string) {
    db.prepare('DELETE FROM groups WHERE id = ?').run(id);
  },
};

// Group env operations
export const groupEnvDb = {
  findById(groupId: string): Record<string, string> | undefined {
    const row = db.prepare('SELECT env FROM group_env WHERE group_id = ?').get(groupId) as
      | { env: string }
      | undefined;
    if (!row) return undefined;
    return JSON.parse(row.env);
  },

  set(groupId: string, env: Record<string, string>) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO group_env (group_id, env, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(group_id) DO UPDATE SET env = excluded.env, updated_at = excluded.updated_at
    `);
    stmt.run(groupId, JSON.stringify(env), now, now);
  },
};

// Session operations
export const sessionDb = {
  create(session: {
    id: string;
    userId: string;
    workspace: string;
    agentId?: string | null;
    sdkSessionId?: string;
    configDir: string;
    workDir: string;
    tmpDir: string;
    status: string;
  }) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO sessions (id, user_id, workspace, agent_id, sdk_session_id, last_assistant_uuid, config_dir, work_dir, tmp_dir, status, created_at, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      session.id,
      session.userId,
      session.workspace,
      session.agentId || null,
      session.sdkSessionId || null,
      null,
      session.configDir,
      session.workDir,
      session.tmpDir,
      session.status,
      now,
      now
    );
    return {
      id: session.id,
      userId: session.userId,
      workspace: session.workspace,
      agentId: session.agentId || null,
      sdkSessionId: session.sdkSessionId,
      lastAssistantUuid: undefined,
      configDir: session.configDir,
      workDir: session.workDir,
      tmpDir: session.tmpDir,
      status: session.status,
      createdAt: now,
      lastActiveAt: now,
    };
  },

  findById(id: string) {
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      userId: row.user_id,
      workspace: row.workspace,
      agentId: row.agent_id,
      sdkSessionId: row.sdk_session_id,
      lastAssistantUuid: row.last_assistant_uuid as string | undefined,
      configDir: row.config_dir,
      workDir: row.work_dir,
      tmpDir: row.tmp_dir,
      status: row.status,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
    };
  },

  findByUser(userId: string) {
    if (!userId) {
      return this.findAll();
    }
    const rows = db.prepare('SELECT * FROM sessions WHERE user_id = ?').all(userId) as Record<
      string,
      unknown
    >[];
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      workspace: row.workspace,
      agentId: row.agent_id,
      sdkSessionId: row.sdk_session_id,
      lastAssistantUuid: row.last_assistant_uuid as string | undefined,
      configDir: row.config_dir,
      workDir: row.work_dir,
      tmpDir: row.tmp_dir,
      status: row.status,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
    }));
  },

  findAll() {
    const rows = db.prepare('SELECT * FROM sessions').all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      workspace: row.workspace,
      agentId: row.agent_id,
      sdkSessionId: row.sdk_session_id,
      lastAssistantUuid: row.last_assistant_uuid as string | undefined,
      configDir: row.config_dir,
      workDir: row.work_dir,
      tmpDir: row.tmp_dir,
      status: row.status,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
    }));
  },

  findByWorkspace(userId: string, workspace: string) {
    const rows = db
      .prepare('SELECT * FROM sessions WHERE user_id = ? AND workspace = ?')
      .all(userId, workspace) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      workspace: row.workspace,
      agentId: row.agent_id,
      sdkSessionId: row.sdk_session_id,
      lastAssistantUuid: row.last_assistant_uuid as string | undefined,
      configDir: row.config_dir,
      workDir: row.work_dir,
      tmpDir: row.tmp_dir,
      status: row.status,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
    }));
  },

  findByWorkspaceAndAgent(userId: string, workspace: string, agentId?: string | null) {
    const sql = agentId
      ? 'SELECT * FROM sessions WHERE user_id = ? AND workspace = ? AND agent_id = ?'
      : "SELECT * FROM sessions WHERE user_id = ? AND workspace = ? AND (agent_id IS NULL OR agent_id = '')";
    const rows = db
      .prepare(sql)
      .all(...(agentId ? [userId, workspace, agentId] : [userId, workspace])) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      workspace: row.workspace,
      agentId: row.agent_id,
      sdkSessionId: row.sdk_session_id,
      lastAssistantUuid: row.last_assistant_uuid as string | undefined,
      configDir: row.config_dir,
      workDir: row.work_dir,
      tmpDir: row.tmp_dir,
      status: row.status,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
    }));
  },

  update(id: string, data: Record<string, unknown>) {
    const fields = Object.keys(data);
    if (fields.length === 0) return;
    const setClause = fields.map((f) => `${f.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())} = ?`).join(', ');
    const values = fields.map((f) => data[f]);
    const stmt = db.prepare(`UPDATE sessions SET ${setClause}, last_active_at = ? WHERE id = ?`);
    stmt.run(...values, Date.now(), id);
  },

  delete(id: string) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  },

  deleteByUser(userId: string) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  },
};

// Message operations
export const messageDb = {
  create(message: Omit<IMessage, 'createdAt'>) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO messages (id, session_id, user_id, role, content, attachments, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      message.id,
      message.sessionId,
      message.userId,
      message.role,
      message.content,
      message.attachments ? JSON.stringify(message.attachments) : null,
      message.metadata ? JSON.stringify(message.metadata) : null,
      now
    );
    return { ...message, createdAt: now };
  },

  findBySession(sessionId: string, limit = 100, offset = 0): IMessage[] {
    const rows = db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(sessionId, limit, offset) as ({
      id: string;
      session_id: string;
      user_id: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      attachments: string | null;
      metadata: string | null;
      created_at: number;
    })[];
    return rows
      .map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        userId: row.user_id,
        role: row.role,
        content: row.content,
        attachments: row.attachments ? JSON.parse(row.attachments) : undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        createdAt: row.created_at,
      }))
      .reverse() as IMessage[];
  },

  findByIds(sessionIds: string[], limit = 1000): IMessage[] {
    if (sessionIds.length === 0) return [];
    const placeholders = sessionIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT * FROM messages WHERE session_id IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`
      )
      .all(...(sessionIds as unknown[]), limit) as (Omit<IMessage, 'attachments' | 'metadata'> & {
      attachments: string | null;
      metadata: string | null;
    })[];
    return rows
      .map((row) => ({
        ...row,
        attachments: row.attachments ? JSON.parse(row.attachments) : undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }))
      .reverse() as IMessage[];
  },

  deleteById(id: string) {
    db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  },

  deleteBySession(sessionId: string) {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
  },

  countBySession(sessionId: string): number {
    const row = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?').get(sessionId) as { count: number } | undefined;
    return row ? Number(row.count) : 0;
  },
};

// MCP server operations
export const mcpServerDb = {
  create(server: Omit<IMcpServer, 'createdAt' | 'updatedAt'>) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO mcp_servers (id, name, command, args, env, type, url, headers, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      server.id,
      server.name,
      server.command,
      JSON.stringify(server.args || []),
      server.env ? JSON.stringify(server.env) : null,
      server.type || 'stdio',
      server.url || null,
      server.headers ? JSON.stringify(server.headers) : null,
      server.enabled ? 1 : 0,
      now,
      now
    );
    return { ...server, createdAt: now, updatedAt: now };
  },

  findById(id: string): IMcpServer | undefined {
    const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as
      | (Omit<IMcpServer, 'args' | 'env' | 'headers' | 'createdAt' | 'updatedAt'> & { args: string; env: string | null; headers: string | null; created_at: number; updated_at: number })
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      command: row.command,
      args: JSON.parse(row.args),
      env: row.env ? JSON.parse(row.env) : undefined,
      type: row.type || 'stdio',
      url: row.url || undefined,
      headers: row.headers ? JSON.parse(row.headers) : undefined,
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as IMcpServer;
  },

  findAll(): IMcpServer[] {
    const rows = db.prepare('SELECT * FROM mcp_servers').all() as (Omit<IMcpServer, 'args' | 'env' | 'headers' | 'createdAt' | 'updatedAt'> & {
      args: string;
      env: string | null;
      headers: string | null;
      created_at: number;
      updated_at: number;
    })[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      command: row.command,
      args: JSON.parse(row.args),
      env: row.env ? JSON.parse(row.env) : undefined,
      type: row.type || 'stdio',
      url: row.url || undefined,
      headers: row.headers ? JSON.parse(row.headers) : undefined,
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) as IMcpServer[];
  },

  findEnabled(): IMcpServer[] {
    const rows = db.prepare('SELECT * FROM mcp_servers WHERE enabled = 1').all() as (Omit<
      IMcpServer,
      'args' | 'env' | 'headers' | 'createdAt' | 'updatedAt'
    > & { args: string; env: string | null; headers: string | null; created_at: number; updated_at: number })[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      command: row.command,
      args: JSON.parse(row.args),
      env: row.env ? JSON.parse(row.env) : undefined,
      type: row.type || 'stdio',
      url: row.url || undefined,
      headers: row.headers ? JSON.parse(row.headers) : undefined,
      enabled: true,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) as IMcpServer[];
  },

  update(id: string, data: Partial<IMcpServer>) {
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.command !== undefined) updates.command = data.command;
    if (data.args !== undefined) updates.args = JSON.stringify(data.args);
    if (data.env !== undefined) updates.env = data.env ? JSON.stringify(data.env) : null;
    if (data.type !== undefined) updates.type = data.type;
    if (data.url !== undefined) updates.url = data.url || null;
    if (data.headers !== undefined) updates.headers = data.headers ? JSON.stringify(data.headers) : null;
    if (data.enabled !== undefined) updates.enabled = data.enabled ? 1 : 0;

    const fields = Object.keys(updates);
    if (fields.length === 0) return;

    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => updates[f]);
    const stmt = db.prepare(`UPDATE mcp_servers SET ${setClause}, updated_at = ? WHERE id = ?`);
    stmt.run(...values, Date.now(), id);
  },

  delete(id: string) {
    db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
  },
};

// Task operations
export const taskDb = {
  create(task: Omit<ITask, 'createdAt' | 'updatedAt'>) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO tasks (id, name, description, cron, prompt, group_id, enabled, last_run_at, next_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      task.id,
      task.name,
      task.description || null,
      task.cron,
      task.prompt,
      task.groupId || null,
      task.enabled ? 1 : 0,
      task.lastRunAt || null,
      task.nextRunAt || null,
      now,
      now
    );
    return { ...task, createdAt: now, updatedAt: now };
  },

  findById(id: string): ITask | undefined {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      cron: row.cron,
      prompt: row.prompt,
      groupId: row.group_id,
      enabled: Boolean(row.enabled),
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as ITask;
  },

  findAll(): ITask[] {
    const rows = db.prepare('SELECT * FROM tasks').all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      cron: row.cron,
      prompt: row.prompt,
      groupId: row.group_id,
      enabled: Boolean(row.enabled),
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) as ITask[];
  },

  findEnabled(): ITask[] {
    const rows = db.prepare('SELECT * FROM tasks WHERE enabled = 1').all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      cron: row.cron,
      prompt: row.prompt,
      groupId: row.group_id,
      enabled: true,
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) as ITask[];
  },

  update(id: string, data: Partial<ITask>) {
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.cron !== undefined) updates.cron = data.cron;
    if (data.prompt !== undefined) updates.prompt = data.prompt;
    if (data.groupId !== undefined) updates.group_id = data.groupId;
    if (data.enabled !== undefined) updates.enabled = data.enabled ? 1 : 0;
    if (data.lastRunAt !== undefined) updates.last_run_at = data.lastRunAt;
    if (data.nextRunAt !== undefined) updates.next_run_at = data.nextRunAt;

    const fields = Object.keys(updates);
    if (fields.length === 0) return;

    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => updates[f]);
    const stmt = db.prepare(`UPDATE tasks SET ${setClause}, updated_at = ? WHERE id = ?`);
    stmt.run(...values, Date.now(), id);
  },

  delete(id: string) {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  },
};

// Task log operations
export const taskLogDb = {
  create(log: Omit<ITaskLog, 'createdAt'>) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO task_logs (id, task_id, status, result, started_at, ended_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(log.id, log.taskId, log.status, log.result || null, log.startedAt, log.endedAt || null, now);
    return { ...log, createdAt: now };
  },

  findByTask(taskId: string, limit = 100): ITaskLog[] {
    const rows = db
      .prepare('SELECT * FROM task_logs WHERE task_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(taskId, limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      status: row.status,
      result: row.result,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      createdAt: row.created_at,
    })) as ITaskLog[];
  },
};

// Billing operations
export const billingDb = {
  create(record: Omit<IBillingRecord, 'createdAt'>) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO billing_records (id, user_id, session_id, type, tokens, cost, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.userId,
      record.sessionId,
      record.type,
      record.tokens,
      record.cost,
      record.model,
      now
    );
    return { ...record, createdAt: now };
  },

  findByUser(userId: string, limit = 100): IBillingRecord[] {
    const rows = db
      .prepare('SELECT * FROM billing_records WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      type: row.type,
      tokens: row.tokens,
      cost: row.cost,
      model: row.model,
      createdAt: row.created_at,
    })) as IBillingRecord[];
  },

  getUserStats(userId: string) {
    const row = db
      .prepare(
        `
      SELECT
        COUNT(*) as total_records,
        SUM(tokens) as total_tokens,
        SUM(cost) as total_cost
      FROM billing_records
      WHERE user_id = ?
    `
      )
      .get(userId) as Record<string, unknown>;
    return {
      totalRecords: Number(row.total_records) || 0,
      totalTokens: Number(row.total_tokens) || 0,
      totalCost: Number(row.total_cost) || 0,
    };
  },

  getDailyStats(userId: string, days = 7) {
    const startAt = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = db
      .prepare(
        `
        SELECT
          date(created_at / 1000, 'unixepoch', 'localtime') as day,
          SUM(tokens) as tokens,
          SUM(cost) as cost,
          COUNT(*) as records
        FROM billing_records
        WHERE user_id = ? AND created_at >= ?
        GROUP BY day
        ORDER BY day DESC
      `
      )
      .all(userId, startAt) as Record<string, unknown>[];
    return rows.map((row) => ({
      day: row.day as string,
      tokens: Number(row.tokens) || 0,
      cost: Number(row.cost) || 0,
      records: Number(row.records) || 0,
    }));
  },

  getAdminDailyStats(days = 7) {
    const startAt = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = db
      .prepare(
        `
        SELECT
          date(created_at / 1000, 'unixepoch', 'localtime') as day,
          SUM(tokens) as tokens,
          SUM(cost) as cost,
          COUNT(*) as records
        FROM billing_records
        WHERE created_at >= ?
        GROUP BY day
        ORDER BY day DESC
      `
      )
      .all(startAt) as Record<string, unknown>[];
    return rows.map((row) => ({
      day: row.day as string,
      tokens: Number(row.tokens) || 0,
      cost: Number(row.cost) || 0,
      records: Number(row.records) || 0,
    }));
  },
};

// Invite code operations
export const inviteCodeDb = {
  create(code: Omit<IInviteCode, 'createdAt' | 'updatedAt'>) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO invite_codes (code, max_uses, used_count, expires_at, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(code.code, code.maxUses, code.usedCount, code.expiresAt || null, code.createdBy, now, now);
    return { ...code, createdAt: now, updatedAt: now };
  },

  findByCode(code: string): IInviteCode | undefined {
    const row = db.prepare('SELECT * FROM invite_codes WHERE code = ?').get(code) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      code: row.code,
      maxUses: row.max_uses,
      usedCount: row.used_count,
      expiresAt: row.expires_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as IInviteCode;
  },

  findAll(): IInviteCode[] {
    const rows = db.prepare('SELECT * FROM invite_codes').all() as Record<string, unknown>[];
    return rows.map((row) => ({
      code: row.code,
      maxUses: row.max_uses,
      usedCount: row.used_count,
      expiresAt: row.expires_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) as IInviteCode[];
  },

  use(code: string) {
    db.prepare('UPDATE invite_codes SET used_count = used_count + 1, updated_at = ? WHERE code = ?').run(
      Date.now(),
      code
    );
  },

  delete(code: string) {
    db.prepare('DELETE FROM invite_codes WHERE code = ?').run(code);
  },
};

// Auth audit log operations
export const authAuditLogDb = {
  create(log: Omit<IAuthAuditLog, 'createdAt'>) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO auth_audit_log (id, user_id, event_type, ip_address, user_agent, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(log.id, log.userId || null, log.eventType, log.ipAddress || null, log.userAgent || null, log.details || null, now);
    return { ...log, createdAt: now };
  },

  findByUser(userId: string, limit = 100): IAuthAuditLog[] {
    const rows = db
      .prepare('SELECT * FROM auth_audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      eventType: row.event_type,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      details: row.details,
      createdAt: row.created_at,
    })) as IAuthAuditLog[];
  },

  findAll(limit = 500): IAuthAuditLog[] {
    const rows = db
      .prepare('SELECT * FROM auth_audit_log ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      eventType: row.event_type,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      details: row.details,
      createdAt: row.created_at,
    })) as IAuthAuditLog[];
  },
};

// User session operations
export const userSessionDb = {
  create(session: Omit<IUserSession, 'createdAt'>) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO user_sessions (id, user_id, token, expires_at, last_active_at, ip_address, user_agent, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      session.id,
      session.userId,
      session.token,
      session.expiresAt,
      session.lastActiveAt,
      session.ipAddress || null,
      session.userAgent || null,
      session.status,
      now
    );
    return { ...session, createdAt: now };
  },

  findByToken(token: string): IUserSession | undefined {
    const row = db.prepare('SELECT * FROM user_sessions WHERE token = ?').get(token) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      userId: row.user_id,
      token: row.token,
      expiresAt: row.expires_at,
      lastActiveAt: row.last_active_at,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      status: row.status,
      createdAt: row.created_at,
    } as IUserSession;
  },

  findByUser(userId: string): IUserSession[] {
    const rows = db
      .prepare("SELECT * FROM user_sessions WHERE user_id = ? AND status = 'active'")
      .all(userId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      token: row.token,
      expiresAt: row.expires_at,
      lastActiveAt: row.last_active_at,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      status: row.status,
      createdAt: row.created_at,
    })) as IUserSession[];
  },

  revoke(id: string) {
    db.prepare("UPDATE user_sessions SET status = 'revoked' WHERE id = ?").run(id);
  },

  revokeByUser(userId: string, exceptToken?: string) {
    if (exceptToken) {
      db.prepare("UPDATE user_sessions SET status = 'revoked' WHERE user_id = ? AND token != ?").run(userId, exceptToken);
    } else {
      db.prepare("UPDATE user_sessions SET status = 'revoked' WHERE user_id = ?").run(userId);
    }
  },

  updateLastActive(token: string) {
    db.prepare('UPDATE user_sessions SET last_active_at = ? WHERE token = ?').run(Date.now(), token);
  },

  deleteExpired() {
    db.prepare("DELETE FROM user_sessions WHERE expires_at < ? AND status = 'active'").run(Date.now());
  },
};

// Skill operations
export const skillDb = {
  create(skill: Omit<ISkill, 'createdAt' | 'updatedAt'>) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO skills (id, user_id, name, description, source, enabled, content, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      skill.id,
      skill.userId,
      skill.name,
      skill.description || null,
      skill.source || 'user',
      skill.enabled ? 1 : 0,
      skill.content || null,
      skill.config ? JSON.stringify(skill.config) : null,
      now,
      now
    );
    return { ...skill, createdAt: now, updatedAt: now };
  },

  findById(id: string): ISkill | undefined {
    const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id as string,
      userId: row.user_id as string,
      name: row.name as string,
      description: row.description as string | undefined,
      source: (row.source as ISkill['source']) || 'user',
      enabled: Boolean(row.enabled),
      content: row.content as string | undefined,
      config: row.config ? JSON.parse(row.config as string) : undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    } as ISkill;
  },

  findByUser(userId: string): ISkill[] {
    const rows = db.prepare('SELECT * FROM skills WHERE user_id = ?').all(userId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      userId: row.user_id as string,
      name: row.name as string,
      description: row.description as string | undefined,
      source: (row.source as ISkill['source']) || 'user',
      enabled: Boolean(row.enabled),
      content: row.content as string | undefined,
      config: row.config ? JSON.parse(row.config as string) : undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    })) as ISkill[];
  },

  findAll(): ISkill[] {
    const rows = db.prepare('SELECT * FROM skills').all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      userId: row.user_id as string,
      name: row.name as string,
      description: row.description as string | undefined,
      source: (row.source as ISkill['source']) || 'user',
      enabled: Boolean(row.enabled),
      content: row.content as string | undefined,
      config: row.config ? JSON.parse(row.config as string) : undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    })) as ISkill[];
  },

  update(id: string, data: Partial<ISkill>) {
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.source !== undefined) updates.source = data.source;
    if (data.enabled !== undefined) updates.enabled = data.enabled ? 1 : 0;
    if (data.content !== undefined) updates.content = data.content;
    if (data.config !== undefined) updates.config = data.config ? JSON.stringify(data.config) : null;

    const fields = Object.keys(updates);
    if (fields.length === 0) return;

    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => updates[f]);
    const stmt = db.prepare(`UPDATE skills SET ${setClause}, updated_at = ? WHERE id = ?`);
    stmt.run(...values, Date.now(), id);
  },

  delete(id: string) {
    db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  },
};

// Agent operations
export const agentDb = {
  create(agent: Omit<IAgent, 'createdAt' | 'updatedAt'>) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO agents (id, group_id, name, prompt, status, kind, result_summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      agent.id,
      agent.groupId,
      agent.name,
      agent.prompt,
      agent.status || 'idle',
      agent.kind || 'conversation',
      agent.resultSummary || null,
      now,
      now
    );
    return { ...agent, createdAt: now, updatedAt: now };
  },

  findById(id: string): IAgent | undefined {
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      groupId: row.group_id,
      name: row.name,
      prompt: row.prompt,
      status: row.status,
      kind: row.kind,
      resultSummary: row.result_summary,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as IAgent;
  },

  findByGroup(groupId: string): IAgent[] {
    const rows = db.prepare('SELECT * FROM agents WHERE group_id = ?').all(groupId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      name: row.name,
      prompt: row.prompt,
      status: row.status,
      kind: row.kind,
      resultSummary: row.result_summary,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) as IAgent[];
  },

  findAll(): IAgent[] {
    const rows = db.prepare('SELECT * FROM agents').all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      name: row.name,
      prompt: row.prompt,
      status: row.status,
      kind: row.kind,
      resultSummary: row.result_summary,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) as IAgent[];
  },

  update(id: string, data: Partial<IAgent>) {
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.prompt !== undefined) updates.prompt = data.prompt;
    if (data.status !== undefined) updates.status = data.status;
    if (data.kind !== undefined) updates.kind = data.kind;
    if (data.resultSummary !== undefined) updates.result_summary = data.resultSummary;

    const fields = Object.keys(updates);
    if (fields.length === 0) return;

    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => updates[f]);
    const stmt = db.prepare(`UPDATE agents SET ${setClause}, updated_at = ? WHERE id = ?`);
    stmt.run(...values, Date.now(), id);
  },

  delete(id: string) {
    db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  },
};

export { db };
