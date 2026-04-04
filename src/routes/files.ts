import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth.js';
import { groupDb } from '../db.js';
import { resolve, join, dirname } from 'path';
import { appConfig } from '../config.js';
import { readdir, stat, mkdir, readFile, writeFile, rm } from 'fs/promises';

// Helper: 获取群组工作目录
function getGroupWorkDir(groupId: string): string {
  return resolve(appConfig.paths.sessions, `group-${groupId.slice(0, 8)}`);
}

// Helper: 安全地解析路径
function safePath(inputPath: string): string {
  // 移除 .. 和 leading /
  return inputPath.replace(/\.\./g, '').replace(/^\//, '');
}

export default async function filesRoutes(fastify: FastifyInstance) {
  // GET /api/groups/:jid/files - 获取文件列表
  fastify.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const path = (request.query as any).path || '/';
      const workDir = getGroupWorkDir(jid);
      const targetPath = resolve(workDir, safePath(path));

      // 确保路径在工作目录内
      if (!targetPath.startsWith(workDir)) {
        return reply.status(400).send({ error: 'Invalid path' });
      }

      const entries: any[] = [];
      try {
        const items = await readdir(targetPath, { withFileTypes: true });
        for (const item of items) {
          const itemPath = join(targetPath, item.name);
          const itemStat = await stat(itemPath);
          entries.push({
            name: item.name,
            path: join(path, item.name).replace(/\\/g, '/'),
            type: item.isDirectory() ? 'directory' : 'file',
            size: itemStat.size,
            modified_at: itemStat.mtime.toISOString(),
          });
        }
      } catch {
        // 目录不存在，返回空列表
      }

      return reply.send({ files: entries, currentPath: path });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load files' });
    }
  });

  // POST /api/groups/:jid/directories - 创建目录
  fastify.post('/directories', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const body = request.body as any;
      const parentPath = body.path || '/';
      const dirName = body.name;

      if (!dirName) {
        return reply.status(400).send({ error: 'Name is required' });
      }

      const workDir = getGroupWorkDir(jid);
      const targetPath = resolve(workDir, safePath(join(parentPath, dirName)));

      if (!targetPath.startsWith(workDir)) {
        return reply.status(400).send({ error: 'Invalid path' });
      }

      await mkdir(targetPath, { recursive: true });
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to create directory' });
    }
  });

  // GET /api/groups/:jid/files/content/:encodedPath - 获取文件内容
  fastify.get('/content/:encodedPath', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const encodedPath = (request.params as any).encodedPath as string;
      const filePath = Buffer.from(encodedPath, 'base64').toString('utf-8');
      const workDir = getGroupWorkDir(jid);
      const targetPath = resolve(workDir, safePath(filePath));

      if (!targetPath.startsWith(workDir)) {
        return reply.status(400).send({ error: 'Invalid path' });
      }

      const content = await readFile(targetPath, 'utf-8');
      return reply.send({ content });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to read file' });
    }
  });

  // PUT /api/groups/:jid/files/content/:encodedPath - 更新文件内容
  fastify.put('/content/:encodedPath', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const encodedPath = (request.params as any).encodedPath as string;
      const filePath = Buffer.from(encodedPath, 'base64').toString('utf-8');
      const workDir = getGroupWorkDir(jid);
      const targetPath = resolve(workDir, safePath(filePath));

      if (!targetPath.startsWith(workDir)) {
        return reply.status(400).send({ error: 'Invalid path' });
      }

      const body = request.body as any;
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, body.content, 'utf-8');
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to write file' });
    }
  });

  // DELETE /api/groups/:jid/files/:encodedPath - 删除文件或目录
  fastify.delete('/:encodedPath', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const encodedPath = (request.params as any).encodedPath as string;
      const filePath = Buffer.from(encodedPath, 'base64').toString('utf-8');
      const workDir = getGroupWorkDir(jid);
      const targetPath = resolve(workDir, safePath(filePath));

      if (!targetPath.startsWith(workDir)) {
        return reply.status(400).send({ error: 'Invalid path' });
      }

      await rm(targetPath, { recursive: true, force: true });
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to delete file' });
    }
  });
}
