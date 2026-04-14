import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolve } from 'path';
import { appConfig } from '../config.js';
import { groupDb, userDb } from '../db.js';

// --- Constants ---
const GROUPS_DIR = resolve(appConfig.dataDir, 'groups');
const WORKSPACE_DIR = resolve(appConfig.claude.baseDir);
const USER_GLOBAL_DIR = path.join(GROUPS_DIR, 'user-global');
const MEMORY_DATA_DIR = path.join(appConfig.dataDir, 'memory');
const MAX_GLOBAL_MEMORY_LENGTH = 200_000;
const MAX_MEMORY_FILE_LENGTH = 500_000;
const MEMORY_LIST_LIMIT = 500;
const MEMORY_SEARCH_LIMIT = 120;
const MEMORY_SOURCE_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
]);
const WALK_SKIP_DIRS = new Set([
  'logs',
  '.claude',
  'conversations',
  'downloads',
  'node_modules',
]);
const MEMORY_BLOCKED_DIRS = ['logs', '.claude', 'conversations'];

// --- Types ---
type MemorySourceType = 'global' | 'heartbeat' | 'session' | 'date' | 'conversation';

interface MemorySource {
  path: string;
  writable: boolean;
  exists: boolean;
  updatedAt: string | null;
  size: number;
  type: MemorySourceType;
  label: string;
  ownerName?: string;
  folder?: string;
}

interface MemoryFilePayload {
  path: string;
  content: string;
  updatedAt: string | null;
  size: number;
  writable: boolean;
}

interface MemorySearchHit extends MemorySource {
  hits: number;
  snippet: string;
}

// --- Utility Functions ---

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function normalizeRelativePath(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error('path must be a string');
  }
  const normalized = input.replace(/\\/g, '/').trim().replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0')) {
    throw new Error('Invalid memory path');
  }
  const parts = normalized.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) {
    throw new Error('Invalid memory path');
  }
  return normalized;
}

function resolveMemoryPath(
  relativePath: string,
  user: { id: string; role: string },
): {
  absolutePath: string;
  writable: boolean;
} {
  const absolute = path.resolve(process.cwd(), relativePath);
  const inGroups = isWithinRoot(absolute, GROUPS_DIR);
  const inMemoryData = isWithinRoot(absolute, MEMORY_DATA_DIR);
  const inWorkspace = isWithinRoot(absolute, WORKSPACE_DIR);
  const writable = inGroups || inMemoryData || inWorkspace;

  if (!writable) {
    throw new Error('Memory path out of allowed scope');
  }

  // User ownership check for non-admin
  if (user.role !== 'admin') {
    if (isWithinRoot(absolute, USER_GLOBAL_DIR)) {
      const relToUserGlobal = path.relative(USER_GLOBAL_DIR, absolute);
      const ownerUserId = relToUserGlobal.split(path.sep)[0];
      if (ownerUserId !== user.id) {
        throw new Error('Memory path out of allowed scope');
      }
    } else if (inGroups) {
      const relToGroups = path.relative(GROUPS_DIR, absolute);
      const folder = relToGroups.split(path.sep)[0];
      if (!isUserOwnedFolder(user, folder)) {
        throw new Error('Memory path out of allowed scope');
      }
    } else if (inMemoryData) {
      const relToMemory = path.relative(MEMORY_DATA_DIR, absolute);
      const folder = relToMemory.split(path.sep)[0];
      if (!isUserOwnedFolder(user, folder)) {
        throw new Error('Memory path out of allowed scope');
      }
    } else if (inWorkspace) {
      const relToWorkspace = path.relative(WORKSPACE_DIR, absolute);
      const folder = relToWorkspace.split(path.sep)[0];
      if (!isUserOwnedFolder(user, folder)) {
        throw new Error('Memory path out of allowed scope');
      }
    }
  }

  return { absolutePath: absolute, writable };
}

function isUserOwnedFolder(
  user: { id: string; role: string },
  folder: string,
): boolean {
  if (user.role === 'admin') return true;
  if (!folder) return false;
  const groups = groupDb.findAll();
  for (const group of groups) {
    if (group.folder === folder && group.ownerId === user.id) {
      return true;
    }
  }
  return false;
}

function classifyMemorySource(
  relativePath: string,
): Pick<MemorySource, 'type' | 'label' | 'ownerName' | 'folder'> {
  const parts = relativePath.split('/');

  // data/groups/user-global/{userId}/...
  if (
    parts[0] === 'data' &&
    parts[1] === 'groups' &&
    parts[2] === 'user-global'
  ) {
    const userId = parts[3] || 'unknown';
    const name = parts.slice(4).join('/') || 'CLAUDE.md';
    const owner = userDb.findById(userId);
    const ownerLabel = owner ? owner.name : userId;

    if (name === 'HEARTBEAT.md') {
      return {
        type: 'heartbeat',
        label: `${ownerLabel} / 每日心跳`,
        ownerName: ownerLabel,
      };
    }
    return {
      type: 'global',
      label: `${ownerLabel} / 全局记忆 / ${name}`,
      ownerName: ownerLabel,
    };
  }

  // data/memory/{folder}/...
  if (parts[0] === 'data' && parts[1] === 'memory') {
    const folder = parts[2] || 'unknown';
    const name = parts.slice(3).join('/') || 'memory';
    return {
      type: 'date',
      label: `${folder} / 日期记忆 / ${name}`,
      folder,
    };
  }

  // data/groups/{folder}/conversations/...
  if (
    parts[0] === 'data' &&
    parts[1] === 'groups' &&
    parts.length >= 4 &&
    parts[3] === 'conversations'
  ) {
    const folder = parts[2] || 'unknown';
    const name = parts.slice(4).join('/');
    return {
      type: 'conversation',
      label: `${folder} / 对话归档 / ${name}`,
      folder,
    };
  }

  // data/sessions/{folder}/... (workspace session memory)
  if (parts[0] === 'data' && parts[1] === 'sessions') {
    const folder = parts[2] || 'unknown';
    const name = parts.slice(3).join('/');
    return {
      type: 'session',
      label: `${folder} / ${name}`,
      folder,
    };
  }

  // data/groups/{folder}/... (session memory)
  if (parts[0] === 'data' && parts[1] === 'groups') {
    const folder = parts[2] || 'unknown';
    const name = parts.slice(3).join('/');
    return {
      type: 'session',
      label: `${folder} / ${name}`,
      folder,
    };
  }

  // Fallback
  return {
    type: 'session',
    label: parts.slice(2).join('/'),
    folder: parts[2] || undefined,
  };
}

function readMemoryFile(
  relativePath: string,
  user: { id: string; role: string },
): MemoryFilePayload {
  const normalized = normalizeRelativePath(relativePath);
  const { absolutePath, writable } = resolveMemoryPath(normalized, user);
  if (!fs.existsSync(absolutePath)) {
    if (!writable) {
      throw new Error('Memory file not found');
    }
    return {
      path: normalized,
      content: '',
      updatedAt: null,
      size: 0,
      writable,
    };
  }
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const stat = fs.statSync(absolutePath);
  return {
    path: normalized,
    content,
    updatedAt: stat.mtime.toISOString(),
    size: Buffer.byteLength(content, 'utf-8'),
    writable,
  };
}

function isBlockedMemoryPath(normalizedPath: string): boolean {
  const parts = normalizedPath.split('/');
  if (parts[0] === 'data' && parts[1] === 'groups' && parts.length >= 4) {
    const subPath = parts[3];
    if (MEMORY_BLOCKED_DIRS.includes(subPath)) return true;
  }
  return false;
}

function writeMemoryFile(
  relativePath: string,
  content: string,
  user: { id: string; role: string },
): MemoryFilePayload {
  const normalized = normalizeRelativePath(relativePath);
  const { absolutePath, writable } = resolveMemoryPath(normalized, user);
  if (!writable) {
    throw new Error('Memory file is read-only');
  }
  if (isBlockedMemoryPath(normalized)) {
    throw new Error('Cannot write to system path');
  }
  if (
    normalized.includes('user-global/') &&
    normalized.endsWith('/HEARTBEAT.md')
  ) {
    throw new Error('HEARTBEAT.md is read-only (auto-generated)');
  }
  if (Buffer.byteLength(content, 'utf-8') > MAX_MEMORY_FILE_LENGTH) {
    throw new Error('Memory file is too large');
  }

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const tempPath = `${absolutePath}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf-8');
  fs.renameSync(tempPath, absolutePath);

  const stat = fs.statSync(absolutePath);
  return {
    path: normalized,
    content,
    updatedAt: stat.mtime.toISOString(),
    size: Buffer.byteLength(content, 'utf-8'),
    writable,
  };
}

function walkFiles(
  baseDir: string,
  maxDepth: number,
  limit: number,
  out: string[],
  currentDepth = 0,
): void {
  if (out.length >= limit || currentDepth > maxDepth || !fs.existsSync(baseDir))
    return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= limit) break;
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      if (WALK_SKIP_DIRS.has(entry.name)) continue;
      walkFiles(fullPath, maxDepth, limit, out, currentDepth + 1);
      continue;
    }
    out.push(fullPath);
  }
}

function isMemoryCandidateFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return MEMORY_SOURCE_EXTENSIONS.has(ext);
}

function listMemorySources(user: { id: string; role: string }): MemorySource[] {
  const files = new Set<string>();
  const isAdmin = user.role === 'admin';
  const groups = groupDb.findAll();
  const accessibleFolders = new Set<string>();

  if (isAdmin) {
    for (const group of groups) {
      accessibleFolders.add(group.folder || group.id);
    }
  } else {
    for (const group of groups) {
      if (group.ownerId === user.id) {
        accessibleFolders.add(group.folder || group.id);
      }
    }
  }

  // 1. User-global memory + heartbeat
  files.add(path.join(USER_GLOBAL_DIR, user.id, 'CLAUDE.md'));
  const heartbeatPath = path.join(USER_GLOBAL_DIR, user.id, 'HEARTBEAT.md');
  if (fs.existsSync(heartbeatPath)) {
    files.add(heartbeatPath);
  }

  // 2. Group CLAUDE.md files
  for (const folder of accessibleFolders) {
    files.add(path.join(GROUPS_DIR, folder, 'CLAUDE.md'));
    files.add(path.join(WORKSPACE_DIR, folder, 'CLAUDE.md'));
  }

  // 3. Explicitly scan .claude/rules/ (walkFiles skips .claude)
  for (const folder of accessibleFolders) {
    const rulesDir = path.join(GROUPS_DIR, folder, '.claude', 'rules');
    if (fs.existsSync(rulesDir)) {
      const scanned: string[] = [];
      walkFiles(rulesDir, 4, MEMORY_LIST_LIMIT, scanned);
      for (const f of scanned) {
        if (isMemoryCandidateFile(f)) files.add(f);
      }
    }
    const workspaceRulesDir = path.join(WORKSPACE_DIR, folder, '.claude', 'rules');
    if (fs.existsSync(workspaceRulesDir)) {
      const scanned: string[] = [];
      walkFiles(workspaceRulesDir, 4, MEMORY_LIST_LIMIT, scanned);
      for (const f of scanned) {
        if (isMemoryCandidateFile(f)) files.add(f);
      }
    }
  }

  // 4. Scan group workspace directories (skips system dirs)
  for (const folder of accessibleFolders) {
    const folderDir = path.join(GROUPS_DIR, folder);
    const scanned: string[] = [];
    walkFiles(folderDir, 4, MEMORY_LIST_LIMIT, scanned);
    for (const f of scanned) {
      if (isMemoryCandidateFile(f)) files.add(f);
    }
    const workspaceDir = path.join(WORKSPACE_DIR, folder);
    const workspaceScanned: string[] = [];
    walkFiles(workspaceDir, 4, MEMORY_LIST_LIMIT, workspaceScanned);
    for (const f of workspaceScanned) {
      if (isMemoryCandidateFile(f)) files.add(f);
    }
  }

  // 5. Scan data/memory/ (date memory files)
  if (fs.existsSync(MEMORY_DATA_DIR)) {
    const memFolders = fs.readdirSync(MEMORY_DATA_DIR, { withFileTypes: true });
    for (const d of memFolders) {
      if (d.isDirectory() && (isAdmin || accessibleFolders.has(d.name))) {
        const scanned: string[] = [];
        walkFiles(
          path.join(MEMORY_DATA_DIR, d.name),
          4,
          MEMORY_LIST_LIMIT,
          scanned,
        );
        for (const f of scanned) {
          if (isMemoryCandidateFile(f)) files.add(f);
        }
      }
    }
  }

  // 6. Scan conversations/ directories (read-only archives)
  for (const folder of accessibleFolders) {
    const convDir = path.join(GROUPS_DIR, folder, 'conversations');
    if (!fs.existsSync(convDir)) continue;
    try {
      const entries = fs.readdirSync(convDir, { withFileTypes: true });
      for (const entry of entries) {
        if (files.size >= MEMORY_LIST_LIMIT) break;
        if (!entry.isFile()) continue;
        const fullPath = path.join(convDir, entry.name);
        if (isMemoryCandidateFile(fullPath)) files.add(fullPath);
      }
    } catch {
      /* skip unreadable */
    }
  }

  const sources: MemorySource[] = [];
  for (const absolutePath of files) {
    const inGroups = isWithinRoot(absolutePath, GROUPS_DIR);
    const inMemoryData = isWithinRoot(absolutePath, MEMORY_DATA_DIR);
    const inWorkspace = isWithinRoot(absolutePath, WORKSPACE_DIR);
    if (!inGroups && !inMemoryData && !inWorkspace) continue;

    const relativePath = path
      .relative(process.cwd(), absolutePath)
      .replace(/\\/g, '/');
    const exists = fs.existsSync(absolutePath);
    let updatedAt: string | null = null;
    let size = 0;
    if (exists) {
      const stat = fs.statSync(absolutePath);
      updatedAt = stat.mtime.toISOString();
      size = stat.size;
    }

    const classified = classifyMemorySource(relativePath);
    const writable =
      classified.type !== 'heartbeat' && classified.type !== 'conversation';
    sources.push({
      path: relativePath,
      writable,
      exists,
      updatedAt,
      size,
      ...classified,
    });
  }

  const typeRank: Record<MemorySource['type'], number> = {
    global: 0,
    heartbeat: 1,
    session: 2,
    date: 3,
    conversation: 4,
  };

  sources.sort((a, b) => {
    if (typeRank[a.type] !== typeRank[b.type])
      return typeRank[a.type] - typeRank[b.type];
    if (a.folder !== b.folder)
      return (a.folder || '').localeCompare(b.folder || '', 'zh-CN');
    return a.path.localeCompare(b.path, 'zh-CN');
  });

  return sources.slice(0, MEMORY_LIST_LIMIT);
}

function buildSearchSnippet(
  content: string,
  index: number,
  keywordLength: number,
): string {
  const start = Math.max(0, index - 36);
  const end = Math.min(content.length, index + keywordLength + 36);
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
}

function searchMemorySources(
  keyword: string,
  user: { id: string; role: string },
  limit = MEMORY_SEARCH_LIMIT,
): MemorySearchHit[] {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) return [];

  const maxResults = Number.isFinite(limit)
    ? Math.max(1, Math.min(MEMORY_SEARCH_LIMIT, Math.trunc(limit)))
    : MEMORY_SEARCH_LIMIT;

  const hits: MemorySearchHit[] = [];
  const sources = listMemorySources(user);

  for (const source of sources) {
    if (hits.length >= maxResults) break;
    if (!source.exists || source.size === 0) continue;
    if (source.size > MAX_MEMORY_FILE_LENGTH) continue;

    try {
      const payload = readMemoryFile(source.path, user);
      const lower = payload.content.toLowerCase();
      const firstIndex = lower.indexOf(normalizedKeyword);
      if (firstIndex === -1) continue;

      let count = 0;
      let from = 0;
      while (from < lower.length) {
        const idx = lower.indexOf(normalizedKeyword, from);
        if (idx === -1) break;
        count += 1;
        from = idx + normalizedKeyword.length;
      }

      hits.push({
        ...source,
        hits: count,
        snippet: buildSearchSnippet(
          payload.content,
          firstIndex,
          normalizedKeyword.length,
        ),
      });
    } catch {
      continue;
    }
  }

  return hits;
}

function getAuthUser(
  request: any,
): { id: string; role: string; name: string } | null {
  const reqUser = request.user as { userId: string } | undefined;
  if (!reqUser?.userId) return null;
  const record = userDb.findById(reqUser.userId);
  if (!record) return null;
  return { id: record.id, role: record.role, name: record.name };
}

// --- Routes ---
export default async function memoryRoutes(fastify: FastifyInstance) {
  fastify.get('/sources', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const user = getAuthUser(request);
      if (!user) return reply.status(401).send({ error: 'Unauthorized' });
      return reply.send({ sources: listMemorySources(user) });
    } catch (err) {
      console.error('Failed to list memory sources', err);
      return reply.status(500).send({ error: 'Failed to list memory sources' });
    }
  });

  fastify.get('/search', { preHandler: authMiddleware }, async (request, reply) => {
    const query = (request.query as any).q;
    if (!query || !query.trim()) {
      return reply.status(400).send({ error: 'Missing q' });
    }
    const limitRaw = Number((request.query as any).limit);
    const limit = Number.isFinite(limitRaw) ? limitRaw : MEMORY_SEARCH_LIMIT;
    try {
      const user = getAuthUser(request);
      if (!user) return reply.status(401).send({ error: 'Unauthorized' });
      return reply.send({ hits: searchMemorySources(query, user, limit) });
    } catch (err) {
      console.error('Failed to search memory sources', err);
      return reply.status(500).send({ error: 'Failed to search memory sources' });
    }
  });

  fastify.get('/file', { preHandler: authMiddleware }, async (request, reply) => {
    const filePath = (request.query as any).path;
    if (!filePath) return reply.status(400).send({ error: 'Missing path' });
    try {
      const user = getAuthUser(request);
      if (!user) return reply.status(401).send({ error: 'Unauthorized' });
      return reply.send(readMemoryFile(filePath, user));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to read memory file';
      const status = message.includes('not found') ? 404 : 400;
      return reply.status(status).send({ error: message });
    }
  });

  fastify.put('/file', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as any;
    if (!body || typeof body.path !== 'string') {
      return reply
        .status(400)
        .send({ error: 'Invalid request body: path is required' });
    }
    try {
      const user = getAuthUser(request);
      if (!user) return reply.status(401).send({ error: 'Unauthorized' });
      return reply.send(
        writeMemoryFile(
          body.path,
          typeof body.content === 'string' ? body.content : '',
          user,
        ),
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to write memory file';
      return reply.status(400).send({ error: message });
    }
  });

  fastify.get('/global', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const user = getAuthUser(request);
      if (!user) return reply.status(401).send({ error: 'Unauthorized' });
      const userGlobalPath = `data/groups/user-global/${user.id}/CLAUDE.md`;
      return reply.send(readMemoryFile(userGlobalPath, user));
    } catch (err) {
      console.error('Failed to read user global memory', err);
      return reply.status(500).send({ error: 'Failed to read global memory' });
    }
  });

  fastify.put('/global', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as any;
    if (!body || typeof body.content !== 'string') {
      return reply.status(400).send({ error: 'Invalid request body' });
    }
    if (Buffer.byteLength(body.content, 'utf-8') > MAX_GLOBAL_MEMORY_LENGTH) {
      return reply.status(400).send({ error: 'Global memory is too large' });
    }
    try {
      const user = getAuthUser(request);
      if (!user) return reply.status(401).send({ error: 'Unauthorized' });
      const userGlobalPath = `data/groups/user-global/${user.id}/CLAUDE.md`;
      return reply.send(writeMemoryFile(userGlobalPath, body.content, user));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to write global memory';
      console.error('Failed to write user global memory', err);
      return reply.status(400).send({ error: message });
    }
  });
}
