import type { FastifyInstance } from 'fastify';
import { authMiddleware, adminMiddleware } from './auth.js';
import { skillDb } from '../db.js';
import { appConfig } from '../config.js';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
  lstatSync,
  realpathSync,
  cpSync,
  mkdtempSync,
  renameSync,
} from 'fs';
import { resolve, join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import os from 'os';
import {
  validateSkillId,
  validateSkillPath,
  parseFrontmatter,
  scanSkillDirectory,
} from '../skill-utils.js';

const execFileAsync = promisify(execFile);
let skillInstallLock: Promise<void> = Promise.resolve();

// ─── Paths ─────────────────────────────────────────────────────

const CONFIG_DIR = resolve(appConfig.dataDir, 'config');
mkdirSync(CONFIG_DIR, { recursive: true });

function configPath(name: string) {
  return resolve(CONFIG_DIR, `${name}.json`);
}

function readConfig(name: string, fallback: any = {}) {
  const p = configPath(name);
  if (existsSync(p)) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function writeConfig(name: string, data: any) {
  writeFileSync(configPath(name), JSON.stringify(data, null, 2));
}

function getUserSkillsDir(userId: string): string {
  return resolve(appConfig.dataDir, 'skills', userId);
}

function getGlobalSkillsDir(): string {
  return join(os.homedir(), '.claude', 'skills');
}

function getSkillsManifestPath(userId: string): string {
  return join(getUserSkillsDir(userId), '.skills-manifest.json');
}

function getHostSyncManifestPath(userId: string): string {
  return join(getUserSkillsDir(userId), '.host-sync.json');
}

interface SkillsManifest {
  skills: Record<
    string,
    {
      packageName: string;
      installedAt: string;
      source: string;
    }
  >;
}

interface HostSyncManifest {
  syncedSkills: string[];
  lastSyncAt: string;
}

function readSkillsManifest(userId: string): SkillsManifest {
  try {
    const data = readFileSync(getSkillsManifestPath(userId), 'utf-8');
    return JSON.parse(data);
  } catch {
    return { skills: {} };
  }
}

function writeSkillsManifest(userId: string, manifest: SkillsManifest): void {
  const p = getSkillsManifestPath(userId);
  mkdirSync(getUserSkillsDir(userId), { recursive: true });
  writeFileSync(p, JSON.stringify(manifest, null, 2));
}

function readHostSyncManifest(userId: string): HostSyncManifest {
  try {
    const data = readFileSync(getHostSyncManifestPath(userId), 'utf-8');
    return JSON.parse(data);
  } catch {
    return { syncedSkills: [], lastSyncAt: '' };
  }
}

function writeHostSyncManifest(userId: string, manifest: HostSyncManifest): void {
  const p = getHostSyncManifestPath(userId);
  mkdirSync(getUserSkillsDir(userId), { recursive: true });
  writeFileSync(p, JSON.stringify(manifest, null, 2));
}

function updateSkillsManifest(userId: string, packageName: string, installedSkillIds: string[]): void {
  const manifest = readSkillsManifest(userId);
  const now = new Date().toISOString();
  for (const id of installedSkillIds) {
    manifest.skills[id] = { packageName, installedAt: now, source: 'skills.sh' };
  }
  writeSkillsManifest(userId, manifest);
}

function removeFromSkillsManifest(userId: string, skillId: string): void {
  const manifest = readSkillsManifest(userId);
  if (skillId in manifest.skills) {
    delete manifest.skills[skillId];
    writeSkillsManifest(userId, manifest);
  }
}

function copySkillToUser(src: string, dest: string): void {
  let realSrc = src;
  try {
    const ls = lstatSync(src);
    if (ls.isSymbolicLink()) {
      realSrc = realpathSync(src);
    }
  } catch {
    // use src as-is
  }
  cpSync(realSrc, dest, { recursive: true });
}

// Map filesystem skill to DB-like shape expected by web-adapter
function fileSkillToApi(skillId: string, userId: string): any {
  const userDir = getUserSkillsDir(userId);
  const skillDir = join(userDir, skillId);
  if (!existsSync(skillDir) || !validateSkillPath(userDir, skillDir)) return null;

  const skillMdPath = join(skillDir, 'SKILL.md');
  const skillMdDisabledPath = join(skillDir, 'SKILL.md.disabled');
  let enabled = false;
  let skillFilePath: string | null = null;

  if (existsSync(skillMdPath)) {
    enabled = true;
    skillFilePath = skillMdPath;
  } else if (existsSync(skillMdDisabledPath)) {
    enabled = false;
    skillFilePath = skillMdDisabledPath;
  } else {
    return null;
  }

  try {
    const content = readFileSync(skillFilePath, 'utf-8');
    const frontmatter = parseFrontmatter(content);
    const stats = statSync(skillDir);
    const manifest = readSkillsManifest(userId);
    const hostManifest = readHostSyncManifest(userId);

    return {
      id: skillId,
      name: frontmatter.name || skillId,
      description: frontmatter.description || '',
      source: 'user',
      enabled,
      content,
      config: {
        userInvocable: frontmatter['user-invocable'] === undefined ? true : frontmatter['user-invocable'] !== 'false',
        allowedTools: frontmatter['allowed-tools'] ? frontmatter['allowed-tools'].split(',').map((t: string) => t.trim()) : [],
        argumentHint: frontmatter['argument-hint'] || null,
        packageName: manifest.skills[skillId]?.packageName || null,
        installedAt: manifest.skills[skillId]?.installedAt || stats.mtime.toISOString(),
        syncedFromHost: hostManifest.syncedSkills.includes(skillId),
      },
      created_at: stats.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

// Build merged list: DB skills + filesystem skills
function buildSkillList(userId: string, isAdmin: boolean): any[] {
  const dbSkills = (isAdmin ? skillDb.findAll() : skillDb.findByUser(userId)).filter(
    (s: any) => s.userId === userId || s.userId === 'system'
  );

  const filesystemSkills = scanSkillDirectory(getUserSkillsDir(userId), 'user');
  const dbIds = new Set(dbSkills.map((s: any) => s.id));
  const merged = [...dbSkills];

  for (const fsSkill of filesystemSkills) {
    if (!dbIds.has(fsSkill.id)) {
      const apiSkill = fileSkillToApi(fsSkill.id, userId);
      if (apiSkill) merged.push(apiSkill);
    } else {
      // enrich DB skill with filesystem metadata
      const idx = merged.findIndex((s) => s.id === fsSkill.id);
      if (idx >= 0) {
        const manifest = readSkillsManifest(userId);
        const hostManifest = readHostSyncManifest(userId);
        merged[idx] = {
          ...merged[idx],
          config: {
            ...(merged[idx].config || {}),
            packageName: manifest.skills[fsSkill.id]?.packageName || merged[idx].config?.packageName,
            installedAt: manifest.skills[fsSkill.id]?.installedAt || merged[idx].config?.installedAt,
            syncedFromHost: hostManifest.syncedSkills.includes(fsSkill.id),
          },
        };
      }
    }
  }

  return merged;
}

// ─── Install lock ──────────────────────────────────────────────

async function withSkillInstallLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = skillInstallLock.catch(() => undefined);
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  skillInstallLock = previous.then(() => current);
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

// ─── Install / Sync ────────────────────────────────────────────

async function installSkillForUser(
  userId: string,
  pkg: string
): Promise<{ success: boolean; installed?: string[]; error?: string }> {
  if (
    !/[\w\-]+\/[\w\-.]+(?:[@#][\w\-.\/]+)?$/.test(pkg) &&
    !/^https?:\/\//.test(pkg)
  ) {
    return { success: false, error: 'Invalid package name format' };
  }

  const tempHome = mkdtempSync(join(os.tmpdir(), 'skill-install-'));
  const tempSkillsDir = join(tempHome, '.claude', 'skills');
  mkdirSync(tempSkillsDir, { recursive: true });

  try {
    await execFileAsync(
      'npx',
      ['-y', 'skills', 'add', pkg, '--global', '--yes', '-a', 'claude-code'],
      { timeout: 60_000, env: { ...process.env, HOME: tempHome } }
    );

    const installedEntries: string[] = [];
    if (existsSync(tempSkillsDir)) {
      for (const entry of readdirSync(tempSkillsDir, { withFileTypes: true })) {
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          installedEntries.push(entry.name);
        }
      }
    }

    if (installedEntries.length === 0) {
      return { success: false, error: 'No skills were installed — package may be invalid' };
    }

    const userDir = getUserSkillsDir(userId);
    mkdirSync(userDir, { recursive: true });

    for (const name of installedEntries) {
      const src = join(tempSkillsDir, name);
      const dest = join(userDir, name);
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      copySkillToUser(src, dest);

      // upsert DB record from SKILL.md
      const apiSkill = fileSkillToApi(name, userId);
      if (apiSkill) {
        const existing = skillDb.findById(name);
        if (existing) {
          skillDb.update(name, {
            name: apiSkill.name,
            description: apiSkill.description,
            enabled: apiSkill.enabled,
            content: apiSkill.content,
            config: apiSkill.config,
          });
        } else {
          skillDb.create({
            id: name,
            userId,
            name: apiSkill.name,
            description: apiSkill.description,
            source: 'user',
            enabled: apiSkill.enabled,
            content: apiSkill.content,
            config: apiSkill.config,
          });
        }
      }
    }

    updateSkillsManifest(userId, pkg, installedEntries);
    return { success: true, installed: installedEntries };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function syncHostSkillsForUser(
  userId: string
): Promise<{ stats: { added: number; updated: number; deleted: number; skipped: number }; total: number }> {
  return withSkillInstallLock(async () => {
    const hostDir = getGlobalSkillsDir();
    const userDir = getUserSkillsDir(userId);
    mkdirSync(userDir, { recursive: true });

    const hostSkillNames: string[] = [];
    if (existsSync(hostDir)) {
      for (const entry of readdirSync(hostDir, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const skillDir = join(hostDir, entry.name);
        try {
          const rp = realpathSync(skillDir);
          if (
            existsSync(join(rp, 'SKILL.md')) ||
            existsSync(join(rp, 'SKILL.md.disabled'))
          ) {
            hostSkillNames.push(entry.name);
          }
        } catch {
          // skip broken symlinks
        }
      }
    }

    const manifest = readHostSyncManifest(userId);
    const previouslySynced = new Set(manifest.syncedSkills);

    const existingUserSkills = new Set<string>();
    if (existsSync(userDir)) {
      for (const entry of readdirSync(userDir, { withFileTypes: true })) {
        if (entry.isDirectory()) existingUserSkills.add(entry.name);
      }
    }

    const stats = { added: 0, updated: 0, deleted: 0, skipped: 0 };
    const newSyncedList: string[] = [];

    for (const name of hostSkillNames) {
      const isManuallyInstalled = existingUserSkills.has(name) && !previouslySynced.has(name);
      if (isManuallyInstalled) {
        stats.skipped++;
        continue;
      }

      const src = join(hostDir, name);
      const dest = join(userDir, name);

      if (existingUserSkills.has(name)) {
        rmSync(dest, { recursive: true, force: true });
        copySkillToUser(src, dest);
        stats.updated++;
      } else {
        copySkillToUser(src, dest);
        stats.added++;
      }
      newSyncedList.push(name);

      // upsert DB record
      const apiSkill = fileSkillToApi(name, userId);
      if (apiSkill) {
        const existing = skillDb.findById(name);
        if (existing) {
          skillDb.update(name, { name: apiSkill.name, description: apiSkill.description, enabled: apiSkill.enabled, content: apiSkill.content, config: apiSkill.config });
        } else {
          skillDb.create({ id: name, userId, name: apiSkill.name, description: apiSkill.description, source: 'user', enabled: apiSkill.enabled, content: apiSkill.content, config: apiSkill.config });
        }
      }
    }

    const hostSkillSet = new Set(hostSkillNames);
    for (const name of previouslySynced) {
      if (!hostSkillSet.has(name) && existingUserSkills.has(name)) {
        rmSync(join(userDir, name), { recursive: true, force: true });
        removeFromSkillsManifest(userId, name);
        const dbSkill = skillDb.findById(name);
        if (dbSkill && dbSkill.userId === userId) skillDb.delete(name);
        stats.deleted++;
      }
    }

    writeHostSyncManifest(userId, { syncedSkills: newSyncedList, lastSyncAt: new Date().toISOString() });
    return { stats, total: hostSkillNames.length };
  });
}

function deleteSkillForUser(userId: string, skillId: string): { success: boolean; error?: string } {
  if (!validateSkillId(skillId)) return { success: false, error: 'Invalid skill ID' };

  const userDir = getUserSkillsDir(userId);
  const skillDir = join(userDir, skillId);

  if (!existsSync(skillDir)) {
    // try DB-only delete
    const dbSkill = skillDb.findById(skillId);
    if (dbSkill && (dbSkill.userId === userId || dbSkill.userId === 'system')) {
      skillDb.delete(skillId);
      return { success: true };
    }
    return { success: false, error: 'Skill not found' };
  }

  if (!validateSkillPath(userDir, skillDir)) return { success: false, error: 'Invalid skill path' };

  try {
    rmSync(skillDir, { recursive: true, force: true });
    removeFromSkillsManifest(userId, skillId);
    const dbSkill = skillDb.findById(skillId);
    if (dbSkill && (dbSkill.userId === userId || dbSkill.userId === 'system')) {
      skillDb.delete(skillId);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ─── Search cache ──────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const SEARCH_CACHE_TTL = 5 * 60 * 1000;
const SEARCH_CACHE_MAX = 100;
const searchCache = new Map<string, CacheEntry<any[]>>();

function getCachedSearch(key: string): any[] | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    searchCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedSearch(key: string, value: any[]): void {
  if (searchCache.size >= SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
  searchCache.set(key, { value, expiresAt: Date.now() + SEARCH_CACHE_TTL });
}

function parseSearchOutput(output: string): any[] {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
  const results: any[] = [];
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pkgMatch = line.match(/^([\w\-]+\/[\w\-.]+(?:@[\w\-.]+)?)$/);
    if (pkgMatch) {
      const pkg = pkgMatch[1];
      let url = '';
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].replace(/^[└├│─\s]+/, '');
        if (nextLine.startsWith('http')) {
          url = nextLine;
          i++;
        }
      }
      results.push({ package: pkg, url });
    }
  }
  return results;
}

async function searchSkillsApi(query: string): Promise<any[]> {
  const cached = getCachedSearch(query);
  if (cached) return cached;

  try {
    const resp = await fetch(`https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=20`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`skills.sh returned ${resp.status}`);

    const data = (await resp.json()) as {
      skills?: Array<{ id: string; skillId: string; name: string; installs: number; source: string }>;
    };

    const results = (data.skills || []).map((s) => ({
      package: s.source === s.skillId || !s.skillId ? s.source : `${s.source}@${s.skillId}`,
      url: `https://skills.sh/s/${s.id}`,
      description: '',
      installs: s.installs,
      skillId: s.skillId,
      source: s.source,
    }));

    setCachedSearch(query, results);
    return results;
  } catch {
    return searchSkillsFallback(query);
  }
}

async function searchSkillsFallback(query: string): Promise<any[]> {
  try {
    const { stdout } = await execFileAsync('npx', ['-y', 'skills', 'find', query], { timeout: 30_000 });
    const results = parseSearchOutput(stdout);
    setCachedSearch(query, results);
    return results;
  } catch (error: any) {
    if (error && typeof error === 'object' && 'stdout' in error) {
      const results = parseSearchOutput(error.stdout || '');
      if (results.length > 0) {
        setCachedSearch(query, results);
        return results;
      }
    }
    return [];
  }
}

async function fetchSkillMdFromGitHub(
  source: string,
  skillId: string
): Promise<{ content: string; description: string; skillName: string } | null> {
  const pathCandidates = [
    `skills/${skillId}/SKILL.md`,
    `${skillId}/SKILL.md`,
    `.claude/skills/${skillId}/SKILL.md`,
    `SKILL.md`,
  ];

  for (const branch of ['main', 'master']) {
    for (const filePath of pathCandidates) {
      try {
        const url = `https://raw.githubusercontent.com/${source}/${branch}/${filePath}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });
        if (!resp.ok) continue;

        const content = await resp.text();
        if (!content.startsWith('---')) continue;

        const frontmatter = parseFrontmatter(content);
        return { content, description: frontmatter.description || '', skillName: frontmatter.name || skillId };
      } catch {
        continue;
      }
    }
  }
  return null;
}

// ─── Routes ────────────────────────────────────────────────────

export default async function skillsRoutes(fastify: FastifyInstance) {
  fastify.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const user = request.user as { userId: string; role: string };
      const skills = buildSkillList(user.userId, user.role === 'admin');
      return reply.send({ skills });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load skills' });
    }
  });

  fastify.post('/', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const user = request.user as { userId: string };
      const body = request.body as any;
      const id = body.id || randomUUID();
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
      return reply.status(201).send({ success: true, skill });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to create skill' });
    }
  });

  fastify.patch('/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const user = request.user as { userId: string };
      const body = request.body as any;

      // filesystem enable/disable toggle
      const userDir = getUserSkillsDir(user.userId);
      const skillDir = join(userDir, id);
      if (existsSync(skillDir) && validateSkillPath(userDir, skillDir) && typeof body.enabled === 'boolean') {
        const srcPath = join(skillDir, body.enabled ? 'SKILL.md.disabled' : 'SKILL.md');
        const dstPath = join(skillDir, body.enabled ? 'SKILL.md' : 'SKILL.md.disabled');
        if (existsSync(srcPath)) {
          renameSync(srcPath, dstPath);
        }
      }

      const skill = skillDb.findById(id);
      if (skill) {
        skillDb.update(id, {
          name: body.name,
          description: body.description,
          enabled: body.enabled,
          content: body.content,
          config: body.config,
        });
      }
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update skill' });
    }
  });

  fastify.delete('/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const user = request.user as { userId: string };
      const result = deleteSkillForUser(user.userId, id);
      if (!result.success) {
        const status =
          result.error === 'Invalid skill ID' || result.error === 'Invalid skill path' ? 400 : 404;
        return reply.status(status).send({ error: result.error });
      }
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to delete skill' });
    }
  });

  fastify.post('/install', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const user = request.user as { userId: string };
      const body = request.body as any;
      if (typeof body.package !== 'string') {
        return reply.status(400).send({ error: 'package field must be string' });
      }
      const pkg = body.package.trim();
      const result = await withSkillInstallLock(() => installSkillForUser(user.userId, pkg));
      if (!result.success) {
        return reply.status(result.error === 'Invalid package name format' ? 400 : 500)
          .send({ error: 'Failed to install skill', details: result.error });
      }
      return reply.send({ success: true, installed: result.installed });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to install skill' });
    }
  });

  fastify.post('/:id/reinstall', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const user = request.user as { userId: string };

      if (!validateSkillId(id)) return reply.status(400).send({ error: 'Invalid skill ID' });

      const manifest = readSkillsManifest(user.userId);
      const meta = manifest.skills[id];
      if (!meta?.packageName) {
        return reply.status(400).send({ error: 'Skill has no package info — cannot reinstall' });
      }

      const deleteResult = deleteSkillForUser(user.userId, id);
      if (!deleteResult.success) {
        return reply.status(500).send({ error: 'Failed to delete old skill', details: deleteResult.error });
      }

      const installResult = await withSkillInstallLock(() => installSkillForUser(user.userId, meta.packageName));
      if (!installResult.success) {
        return reply.status(500).send({ error: 'Failed to reinstall skill', details: installResult.error });
      }
      return reply.send({ success: true, installed: installResult.installed });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to reinstall skill' });
    }
  });

  fastify.post('/sync-host', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const user = request.user as { userId: string };
      const result = await syncHostSkillsForUser(user.userId);
      return reply.send({ success: true, ...result });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to sync skills' });
    }
  });

  fastify.get('/sync-status', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const user = request.user as { userId: string };
      const manifest = readHostSyncManifest(user.userId);
      const system = readConfig('system', {});
      return reply.send({
        lastSyncAt: manifest.lastSyncAt || null,
        syncedCount: manifest.syncedSkills.length,
        autoSyncEnabled: system.skillAutoSyncEnabled ?? false,
        autoSyncIntervalMinutes: system.skillAutoSyncIntervalMinutes ?? 60,
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to get sync status' });
    }
  });

  fastify.put('/sync-settings', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const body = request.body as any;
      const current = readConfig('system', {});
      const updates: any = {};
      if (typeof body.autoSyncEnabled === 'boolean') updates.skillAutoSyncEnabled = body.autoSyncEnabled;
      if (typeof body.autoSyncIntervalMinutes === 'number' && body.autoSyncIntervalMinutes >= 1) {
        updates.skillAutoSyncIntervalMinutes = body.autoSyncIntervalMinutes;
      }
      writeConfig('system', { ...current, ...updates });
      const saved = readConfig('system', {});
      return reply.send({
        autoSyncEnabled: saved.skillAutoSyncEnabled ?? false,
        autoSyncIntervalMinutes: saved.skillAutoSyncIntervalMinutes ?? 60,
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update sync settings' });
    }
  });

  fastify.get('/search', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const query = ((request.query as any).q as string | undefined)?.trim();
      if (!query) return reply.send({ results: [] });
      const results = await searchSkillsApi(query);
      return reply.send({ results });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to search skills' });
    }
  });

  fastify.get('/search/detail', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const source = ((request.query as any).source as string | undefined)?.trim();
      const skillId = ((request.query as any).skillId as string | undefined)?.trim();
      const url = ((request.query as any).url as string | undefined)?.trim();

      if (source && skillId) {
        const result = await fetchSkillMdFromGitHub(source, skillId);
        if (!result) return reply.send({ detail: null });
        return reply.send({
          detail: {
            description: result.description,
            skillName: result.skillName,
            readme: result.content,
            installs: '',
            age: '',
            features: [],
          },
        });
      }

      if (url) {
        try {
          const parsed = new URL(url);
          if (parsed.hostname === 'skills.sh') {
            const segments = parsed.pathname.replace(/^\/s\//, '').split('/').filter(Boolean);
            if (segments.length >= 3) {
              const srcFromUrl = `${segments[0]}/${segments[1]}`;
              const skillIdFromUrl = segments[2];
              const result = await fetchSkillMdFromGitHub(srcFromUrl, skillIdFromUrl);
              if (result) {
                return reply.send({
                  detail: {
                    description: result.description,
                    skillName: result.skillName,
                    readme: result.content,
                    installs: '',
                    age: '',
                    features: [],
                  },
                });
              }
            }
          }
        } catch {
          // fall through
        }
      }

      return reply.send({ detail: null });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to get skill detail' });
    }
  });

  fastify.get('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const user = request.user as { userId: string };

      // prefer filesystem
      const fsSkill = fileSkillToApi(id, user.userId);
      if (fsSkill) return reply.send({ skill: fsSkill });

      const skill = skillDb.findById(id);
      if (!skill) return reply.status(404).send({ error: 'Skill not found' });
      return reply.send({ skill });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load skill' });
    }
  });
}

export { getUserSkillsDir, installSkillForUser, deleteSkillForUser, syncHostSkillsForUser };
