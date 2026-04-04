import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth.js';
import { groupDb } from '../db.js';
import { appConfig } from '../config.js';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  lstatSync,
  realpathSync,
  cpSync,
  mkdtempSync,
  renameSync,
} from 'fs';
import { resolve, join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { validateSkillId, validateSkillPath, scanSkillDirectory } from '../skill-utils.js';

const execFileAsync = promisify(execFile);

// ─── Helpers ───────────────────────────────────────────────────

function checkGroupAccess(request: any, jid: string): { ok: false; status: number; message: string } | { ok: true; group: any } {
  const group = groupDb.findById(jid);
  if (!group) return { ok: false, status: 404, message: 'Group not found' };

  const user = request.user as { userId: string };
  const members = group.members || [];
  if (group.ownerId !== user.userId && !members.includes(user.userId)) {
    return { ok: false, status: 403, message: 'Forbidden' };
  }
  return { ok: true, group };
}

function getWorkspaceRoot(group: any): string {
  return resolve(appConfig.paths.sessions, group.folder || group.id);
}

function getClaudeDir(group: any): string {
  return join(getWorkspaceRoot(group), '.claude');
}

function getSkillsDir(group: any): string {
  return join(getClaudeDir(group), 'skills');
}

function getSettingsPath(group: any): string {
  return join(getClaudeDir(group), 'settings.json');
}

function getMcpMetaPath(group: any): string {
  return join(getClaudeDir(group), 'happyclaw-workspace.json');
}

interface McpServerMeta {
  enabled: boolean;
  description?: string;
  addedAt: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: 'http' | 'sse';
  url?: string;
  headers?: Record<string, string>;
}

interface WorkspaceMeta {
  mcpServers: Record<string, McpServerMeta>;
}

function readWorkspaceMeta(group: any): WorkspaceMeta {
  try {
    return JSON.parse(readFileSync(getMcpMetaPath(group), 'utf-8'));
  } catch {
    return { mcpServers: {} };
  }
}

function writeWorkspaceMeta(group: any, meta: WorkspaceMeta): void {
  const p = getMcpMetaPath(group);
  mkdirSync(getClaudeDir(group), { recursive: true });
  writeFileSync(p, JSON.stringify(meta, null, 2));
}

function readWorkspaceSettings(group: any): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(getSettingsPath(group), 'utf-8'));
  } catch {
    return {};
  }
}

function writeWorkspaceSettings(group: any, settings: Record<string, unknown>): void {
  mkdirSync(getClaudeDir(group), { recursive: true });
  writeFileSync(getSettingsPath(group), JSON.stringify(settings, null, 2));
}

function syncMcpToSettings(group: any, meta: WorkspaceMeta, existingSettings?: Record<string, unknown>): void {
  const settings = existingSettings ?? readWorkspaceSettings(group);
  const mcpServers: Record<string, Record<string, unknown>> = {};

  for (const [id, entry] of Object.entries(meta.mcpServers)) {
    if (!entry.enabled) continue;

    const isHttpType = entry.type === 'http' || entry.type === 'sse';
    if (isHttpType) {
      if (!entry.url) continue;
      const server: Record<string, unknown> = { type: entry.type, url: entry.url };
      if (entry.headers && Object.keys(entry.headers).length > 0) server.headers = entry.headers;
      mcpServers[id] = server;
    } else {
      if (!entry.command) continue;
      const server: Record<string, unknown> = { command: entry.command };
      if (entry.args && entry.args.length > 0) server.args = entry.args;
      if (entry.env && Object.keys(entry.env).length > 0) server.env = entry.env;
      mcpServers[id] = server;
    }
  }

  if (Object.keys(mcpServers).length > 0) {
    settings.mcpServers = mcpServers;
  } else {
    delete settings.mcpServers;
  }

  writeWorkspaceSettings(group, settings);
}

function copySkillEntry(src: string, dest: string): void {
  let realSrc = src;
  try {
    const ls = lstatSync(src);
    if (ls.isSymbolicLink()) realSrc = realpathSync(src);
  } catch {
    // use src as-is
  }
  cpSync(realSrc, dest, { recursive: true });
}

export default async function workspaceConfigRoutes(fastify: FastifyInstance) {
  // ─── Skills ────────────────────────────────────────────────────

  fastify.get('/:jid/workspace-config/skills', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const access = checkGroupAccess(request, (request.params as any).jid as string);
      if (!access.ok) return reply.status(access.status).send({ error: access.message });

      const skillsDir = getSkillsDir(access.group);
      const skills = scanSkillDirectory(skillsDir, 'workspace').map((s) => ({
        id: s.id,
        name: s.name,
        enabled: s.enabled,
      }));
      return reply.send({ skills });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load skills' });
    }
  });

  fastify.post('/:jid/workspace-config/skills/install', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const access = checkGroupAccess(request, (request.params as any).jid as string);
      if (!access.ok) return reply.status(access.status).send({ error: access.message });

      const body = request.body as any;
      const pkg = typeof body.package === 'string' ? body.package.trim() : '';

      if (
        !/[\w\-]+\/[\w\-.]+(?:[@#][\w\-.\/]+)?$/.test(pkg) &&
        !/^https?:\/\//.test(pkg)
      ) {
        return reply.status(400).send({ error: 'Invalid package name format' });
      }

      const tempHome = mkdtempSync(join(os.tmpdir(), 'ws-skill-install-'));
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
            if (entry.isDirectory() || entry.isSymbolicLink()) installedEntries.push(entry.name);
          }
        }

        if (installedEntries.length === 0) {
          return reply.status(500).send({ error: 'No skills were installed — package may be invalid' });
        }

        const targetDir = getSkillsDir(access.group);
        mkdirSync(targetDir, { recursive: true });

        for (const name of installedEntries) {
          const src = join(tempSkillsDir, name);
          const dest = join(targetDir, name);
          if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
          copySkillEntry(src, dest);
        }

        return reply.send({ success: true, installed: installedEntries });
      } catch (error) {
        return reply.status(500).send(
          { error: 'Failed to install skill', details: error instanceof Error ? error.message : 'Unknown error' }
        );
      } finally {
        try {
          rmSync(tempHome, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to install skill' });
    }
  });

  fastify.patch('/:jid/workspace-config/skills/:id', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const access = checkGroupAccess(request, (request.params as any).jid as string);
      if (!access.ok) return reply.status(access.status).send({ error: access.message });

      const id = (request.params as any).id as string;
      if (!validateSkillId(id)) return reply.status(400).send({ error: 'Invalid skill ID' });

      const { enabled } = request.body as { enabled: boolean };
      const skillsDir = getSkillsDir(access.group);
      const skillDir = join(skillsDir, id);

      if (!existsSync(skillDir)) return reply.status(404).send({ error: 'Skill not found' });
      if (!validateSkillPath(skillsDir, skillDir)) return reply.status(400).send({ error: 'Invalid skill path' });

      const srcPath = join(skillDir, enabled ? 'SKILL.md.disabled' : 'SKILL.md');
      const dstPath = join(skillDir, enabled ? 'SKILL.md' : 'SKILL.md.disabled');

      if (!existsSync(srcPath)) {
        return reply.status(404).send({ error: 'Skill not found or already in desired state' });
      }

      renameSync(srcPath, dstPath);
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update skill' });
    }
  });

  fastify.delete('/:jid/workspace-config/skills/:id', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const access = checkGroupAccess(request, (request.params as any).jid as string);
      if (!access.ok) return reply.status(access.status).send({ error: access.message });

      const id = (request.params as any).id as string;
      if (!validateSkillId(id)) return reply.status(400).send({ error: 'Invalid skill ID' });

      const skillsDir = getSkillsDir(access.group);
      const skillDir = join(skillsDir, id);

      if (!existsSync(skillDir)) return reply.status(404).send({ error: 'Skill not found' });
      if (!validateSkillPath(skillsDir, skillDir)) return reply.status(400).send({ error: 'Invalid skill path' });

      rmSync(skillDir, { recursive: true, force: true });
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to delete skill' });
    }
  });

  // ─── MCP Servers ───────────────────────────────────────────────

  fastify.get('/:jid/workspace-config/mcp-servers', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const access = checkGroupAccess(request, (request.params as any).jid as string);
      if (!access.ok) return reply.status(access.status).send({ error: access.message });

      const meta = readWorkspaceMeta(access.group);
      const settings = readWorkspaceSettings(access.group);
      const settingsMcp = (settings.mcpServers as Record<string, Record<string, unknown>>) || {};

      const servers: Array<McpServerMeta & { id: string }> = [];

      for (const [id, entry] of Object.entries(meta.mcpServers)) {
        servers.push({ id, ...entry });
      }

      for (const [id, entry] of Object.entries(settingsMcp)) {
        if (meta.mcpServers[id]) continue;
        const isHttpType = entry.type === 'http' || entry.type === 'sse';
        servers.push({
          id,
          enabled: true,
          addedAt: '',
          ...(isHttpType
            ? { type: entry.type as 'http' | 'sse', url: entry.url as string, ...(entry.headers ? { headers: entry.headers as Record<string, string> } : {}) }
            : { command: entry.command as string, ...(entry.args ? { args: entry.args as string[] } : {}), ...(entry.env ? { env: entry.env as Record<string, string> } : {}) }),
        });
      }

      return reply.send({ servers });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load MCP servers' });
    }
  });

  fastify.post('/:jid/workspace-config/mcp-servers', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const access = checkGroupAccess(request, (request.params as any).jid as string);
      if (!access.ok) return reply.status(access.status).send({ error: access.message });

      const body = request.body as any;
      const { id, command, args, env, description, type, url, headers } = body;

      if (!id || typeof id !== 'string') return reply.status(400).send({ error: 'id is required' });
      if (!/[\w\-]+$/.test(id)) return reply.status(400).send({ error: 'Invalid server ID' });

      const isHttpType = type === 'http' || type === 'sse';
      if (isHttpType) {
        if (!url || typeof url !== 'string') return reply.status(400).send({ error: 'url is required for http/sse type' });
      } else {
        if (!command || typeof command !== 'string') return reply.status(400).send({ error: 'command is required' });
      }

      const meta = readWorkspaceMeta(access.group);
      if (meta.mcpServers[id]) return reply.status(409).send({ error: `Server "${id}" already exists` });

      const entry: McpServerMeta = { enabled: true, addedAt: new Date().toISOString() };
      if (description) entry.description = description;
      if (isHttpType) {
        entry.type = type;
        entry.url = url;
        if (headers && Object.keys(headers).length > 0) entry.headers = headers;
      } else {
        entry.command = command;
        if (args && args.length > 0) entry.args = args;
        if (env && Object.keys(env).length > 0) entry.env = env;
      }

      meta.mcpServers[id] = entry;
      writeWorkspaceMeta(access.group, meta);
      syncMcpToSettings(access.group, meta);

      return reply.send({ success: true, server: { id, ...entry } });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to add MCP server' });
    }
  });

  fastify.patch('/:jid/workspace-config/mcp-servers/:id', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const access = checkGroupAccess(request, (request.params as any).jid as string);
      if (!access.ok) return reply.status(access.status).send({ error: access.message });

      const id = (request.params as any).id as string;
      if (!/[\w\-]+$/.test(id)) return reply.status(400).send({ error: 'Invalid server ID' });

      const body = request.body as any;
      const { command, args, env, enabled, description, url, headers } = body;

      const meta = readWorkspaceMeta(access.group);
      let entry = meta.mcpServers[id];

      if (!entry) {
        const settings = readWorkspaceSettings(access.group);
        const settingsMcp = (settings.mcpServers as Record<string, Record<string, unknown>>) || {};
        const settingsEntry = settingsMcp[id];
        if (!settingsEntry) return reply.status(404).send({ error: 'Server not found' });

        const isHttp = settingsEntry.type === 'http' || settingsEntry.type === 'sse';
        entry = {
          enabled: true,
          addedAt: '',
          ...(isHttp
            ? { type: settingsEntry.type as 'http' | 'sse', url: settingsEntry.url as string }
            : { command: settingsEntry.command as string }),
        };
        meta.mcpServers[id] = entry;
      }

      if (command !== undefined) entry.command = command;
      if (args !== undefined) entry.args = args;
      if (env !== undefined) entry.env = env;
      if (url !== undefined) entry.url = url;
      if (headers !== undefined) entry.headers = headers;
      if (typeof enabled === 'boolean') entry.enabled = enabled;
      if (description !== undefined) entry.description = typeof description === 'string' ? description : undefined;

      writeWorkspaceMeta(access.group, meta);
      syncMcpToSettings(access.group, meta);

      return reply.send({ success: true, server: { id, ...entry } });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update MCP server' });
    }
  });

  fastify.delete('/:jid/workspace-config/mcp-servers/:id', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const access = checkGroupAccess(request, (request.params as any).jid as string);
      if (!access.ok) return reply.status(access.status).send({ error: access.message });

      const id = (request.params as any).id as string;
      if (!/[\w\-]+$/.test(id)) return reply.status(400).send({ error: 'Invalid server ID' });

      const meta = readWorkspaceMeta(access.group);
      const hadMeta = !!meta.mcpServers[id];
      delete meta.mcpServers[id];

      const settings = readWorkspaceSettings(access.group);
      const settingsMcp = (settings.mcpServers as Record<string, unknown>) || {};
      const hadSettings = id in settingsMcp;

      if (!hadMeta && !hadSettings) return reply.status(404).send({ error: 'Server not found' });

      if (hadMeta) writeWorkspaceMeta(access.group, meta);
      syncMcpToSettings(access.group, meta, settings);

      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to delete MCP server' });
    }
  });
}
