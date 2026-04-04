import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { groupDb } from '../db.js';
import { resolve, join, dirname } from 'path';
import { appConfig } from '../config.js';
import { readdir, stat, mkdir, readFile, writeFile, rm } from 'fs/promises';

const files = new Hono();

// Helper: 获取群组工作目录
function getGroupWorkDir(groupId: string): string {
  return resolve(appConfig.paths.sessions, `group-${groupId.slice(0, 8)}`);
}

// Helper: 安全地解析路径
function safePath(inputPath: string): string {
  // 移除 .. 和 leading /
  return inputPath.replace(/\.\./g, '').replace(/^\//, '');
}

// GET /api/groups/:jid/files - 获取文件列表
files.get('/', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid')!;
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const path = c.req.query('path') || '/';
    const workDir = getGroupWorkDir(jid);
    const targetPath = resolve(workDir, safePath(path));

    // 确保路径在工作目录内
    if (!targetPath.startsWith(workDir)) {
      return c.json({ error: 'Invalid path' }, 400);
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

    return c.json({ files: entries, currentPath: path });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load files' }, 500);
  }
});

// POST /api/groups/:jid/directories - 创建目录
files.post('/directories', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid')!;
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const body = await c.req.json();
    const parentPath = body.path || '/';
    const dirName = body.name;

    if (!dirName) {
      return c.json({ error: 'Name is required' }, 400);
    }

    const workDir = getGroupWorkDir(jid);
    const targetPath = resolve(workDir, safePath(join(parentPath, dirName)));

    if (!targetPath.startsWith(workDir)) {
      return c.json({ error: 'Invalid path' }, 400);
    }

    await mkdir(targetPath, { recursive: true });
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create directory' }, 500);
  }
});

// GET /api/groups/:jid/files/content/:encodedPath - 获取文件内容
files.get('/content/:encodedPath', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid')!;
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const encodedPath = c.req.param('encodedPath')!;
    const filePath = Buffer.from(encodedPath, 'base64').toString('utf-8');
    const workDir = getGroupWorkDir(jid);
    const targetPath = resolve(workDir, safePath(filePath));

    if (!targetPath.startsWith(workDir)) {
      return c.json({ error: 'Invalid path' }, 400);
    }

    const content = await readFile(targetPath, 'utf-8');
    return c.json({ content });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to read file' }, 500);
  }
});

// PUT /api/groups/:jid/files/content/:encodedPath - 更新文件内容
files.put('/content/:encodedPath', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid')!;
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const encodedPath = c.req.param('encodedPath')!;
    const filePath = Buffer.from(encodedPath, 'base64').toString('utf-8');
    const workDir = getGroupWorkDir(jid);
    const targetPath = resolve(workDir, safePath(filePath));

    if (!targetPath.startsWith(workDir)) {
      return c.json({ error: 'Invalid path' }, 400);
    }

    const body = await c.req.json();
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, body.content, 'utf-8');
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to write file' }, 500);
  }
});

// DELETE /api/groups/:jid/files/:encodedPath - 删除文件或目录
files.delete('/:encodedPath', authMiddleware, async (c) => {
  try {
    const jid = c.req.param('jid')!;
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const encodedPath = c.req.param('encodedPath')!;
    const filePath = Buffer.from(encodedPath, 'base64').toString('utf-8');
    const workDir = getGroupWorkDir(jid);
    const targetPath = resolve(workDir, safePath(filePath));

    if (!targetPath.startsWith(workDir)) {
      return c.json({ error: 'Invalid path' }, 400);
    }

    await rm(targetPath, { recursive: true, force: true });
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete file' }, 500);
  }
});

export default files;
