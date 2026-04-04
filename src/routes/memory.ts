import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { appConfig } from '../config.js';

const memory = new Hono();

const MEMORY_DIR = resolve(appConfig.dataDir, 'memory');
mkdirSync(MEMORY_DIR, { recursive: true });

// GET /api/memory/sources - 获取记忆源列表
memory.get('/sources', authMiddleware, async (c) => {
  try {
    return c.json({ sources: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load memory sources' }, 500);
  }
});

// GET /api/memory/search - 搜索记忆
memory.get('/search', authMiddleware, async (c) => {
  try {
    return c.json({ results: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to search memory' }, 500);
  }
});

// GET /api/memory/file - 获取记忆文件
memory.get('/file', authMiddleware, async (c) => {
  try {
    const path = c.req.query('path') || 'CLAUDE.md';
    const filePath = resolve(MEMORY_DIR, path);
    if (!existsSync(filePath)) {
      return c.json({ content: '', exists: false });
    }
    const content = readFileSync(filePath, 'utf-8');
    return c.json({ content, exists: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to read memory file' }, 500);
  }
});

// PUT /api/memory/file - 更新记忆文件
memory.put('/file', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const path = body.path || 'CLAUDE.md';
    const filePath = resolve(MEMORY_DIR, path);
    writeFileSync(filePath, body.content || '');
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to write memory file' }, 500);
  }
});

// GET /api/memory/global - 获取全局记忆
memory.get('/global', authMiddleware, async (c) => {
  try {
    const user = c.get('user') as { userId: string };
    const globalDir = resolve(appConfig.dataDir, 'groups', 'user-global', user.userId);
    mkdirSync(globalDir, { recursive: true });
    const filePath = resolve(globalDir, 'CLAUDE.md');
    if (!existsSync(filePath)) {
      return c.json({ content: '', exists: false });
    }
    const content = readFileSync(filePath, 'utf-8');
    return c.json({ content, exists: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to read global memory' }, 500);
  }
});

// PUT /api/memory/global - 更新全局记忆
memory.put('/global', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const user = c.get('user') as { userId: string };
    const globalDir = resolve(appConfig.dataDir, 'groups', 'user-global', user.userId);
    mkdirSync(globalDir, { recursive: true });
    const filePath = resolve(globalDir, 'CLAUDE.md');
    writeFileSync(filePath, body.content || '');
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to write global memory' }, 500);
  }
});

export default memory;
