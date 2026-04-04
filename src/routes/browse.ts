import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth.js';
import { readdir, stat, mkdir } from 'fs/promises';
import { resolve, join } from 'path';
import { appConfig } from '../config.js';
import { groupDb } from '../db.js';

function getGroupWorkDir(groupId: string): string {
  return resolve(appConfig.paths.sessions, `group-${groupId.slice(0, 8)}`);
}

function safePath(inputPath: string): string {
  return inputPath.replace(/\.\./g, '').replace(/^\//, '');
}

export default async function browseRoutes(fastify: FastifyInstance) {
  // GET /api/browse/directories - 列出目录
  fastify.get('/directories', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const groupJid = (request.query as any).group as string;
      const rawPath = (request.query as any).path || '/';
      if (!groupJid) return reply.status(400).send({ error: 'group is required' });

      const group = groupDb.findById(groupJid);
      if (!group) return reply.status(404).send({ error: 'Group not found' });

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const workDir = getGroupWorkDir(groupJid);
      const targetPath = resolve(workDir, safePath(rawPath));
      if (!targetPath.startsWith(workDir)) return reply.status(400).send({ error: 'Invalid path' });

      const entries: any[] = [];
      try {
        const items = await readdir(targetPath, { withFileTypes: true });
        for (const item of items) {
          if (item.name.startsWith('.')) continue;
          const itemPath = join(targetPath, item.name);
          const itemStat = await stat(itemPath);
          entries.push({
            name: item.name,
            path: join(rawPath, item.name).replace(/\\/g, '/'),
            type: item.isDirectory() ? 'directory' : 'file',
            size: itemStat.size,
            modified_at: itemStat.mtime.toISOString(),
          });
        }
      } catch {
        // directory may not exist
      }

      return reply.send({ entries, currentPath: rawPath });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to browse' });
    }
  });

  // POST /api/browse/directories - 创建目录
  fastify.post('/directories', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const body = request.body as any;
      const groupJid = body.group;
      const rawPath = body.path || '/';
      const dirName = body.name;

      if (!groupJid) return reply.status(400).send({ error: 'group is required' });
      if (!dirName) return reply.status(400).send({ error: 'name is required' });

      const group = groupDb.findById(groupJid);
      if (!group) return reply.status(404).send({ error: 'Group not found' });

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const workDir = getGroupWorkDir(groupJid);
      const targetPath = resolve(workDir, safePath(join(rawPath, dirName)));
      if (!targetPath.startsWith(workDir)) return reply.status(400).send({ error: 'Invalid path' });

      await mkdir(targetPath, { recursive: true });
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to create directory' });
    }
  });
}
