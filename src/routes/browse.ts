import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { readdir, stat, mkdir } from 'fs/promises';
import { resolve, join } from 'path';
import { appConfig } from '../config.js';
import { groupDb } from '../db.js';

const browse = new Hono();

function getGroupWorkDir(groupId: string): string {
  return resolve(appConfig.paths.sessions, `group-${groupId.slice(0, 8)}`);
}

function safePath(inputPath: string): string {
  return inputPath.replace(/\.\./g, '').replace(/^\//, '');
}

// GET /api/browse/directories - 列出目录
browse.get('/directories', authMiddleware, async (c) => {
  try {
    const groupJid = c.req.query('group');
    const rawPath = c.req.query('path') || '/';
    if (!groupJid) return c.json({ error: 'group is required' }, 400);

    const group = groupDb.findById(groupJid);
    if (!group) return c.json({ error: 'Group not found' }, 404);

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const workDir = getGroupWorkDir(groupJid);
    const targetPath = resolve(workDir, safePath(rawPath));
    if (!targetPath.startsWith(workDir)) return c.json({ error: 'Invalid path' }, 400);

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

    return c.json({ entries, currentPath: rawPath });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to browse' }, 500);
  }
});

// POST /api/browse/directories - 创建目录
browse.post('/directories', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const groupJid = body.group;
    const rawPath = body.path || '/';
    const dirName = body.name;

    if (!groupJid) return c.json({ error: 'group is required' }, 400);
    if (!dirName) return c.json({ error: 'name is required' }, 400);

    const group = groupDb.findById(groupJid);
    if (!group) return c.json({ error: 'Group not found' }, 404);

    const user = c.get('user') as { userId: string };
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const workDir = getGroupWorkDir(groupJid);
    const targetPath = resolve(workDir, safePath(join(rawPath, dirName)));
    if (!targetPath.startsWith(workDir)) return c.json({ error: 'Invalid path' }, 400);

    await mkdir(targetPath, { recursive: true });
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create directory' }, 500);
  }
});

export default browse;
