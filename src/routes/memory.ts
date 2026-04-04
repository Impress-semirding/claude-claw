import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { appConfig } from '../config.js';

const MEMORY_DIR = resolve(appConfig.dataDir, 'memory');
mkdirSync(MEMORY_DIR, { recursive: true });

export default async function memoryRoutes(fastify: FastifyInstance) {
  // GET /api/memory/sources - 获取记忆源列表
  fastify.get('/sources', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({ sources: [] });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load memory sources' });
    }
  });

  // GET /api/memory/search - 搜索记忆
  fastify.get('/search', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({ results: [] });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to search memory' });
    }
  });

  // GET /api/memory/file - 获取记忆文件
  fastify.get('/file', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const path = (request.query as any).path || 'CLAUDE.md';
      const filePath = resolve(MEMORY_DIR, path);
      if (!existsSync(filePath)) {
        return reply.send({ content: '', exists: false });
      }
      const content = readFileSync(filePath, 'utf-8');
      return reply.send({ content, exists: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to read memory file' });
    }
  });

  // PUT /api/memory/file - 更新记忆文件
  fastify.put('/file', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const body = request.body as any;
      const path = body.path || 'CLAUDE.md';
      const filePath = resolve(MEMORY_DIR, path);
      writeFileSync(filePath, body.content || '');
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to write memory file' });
    }
  });

  // GET /api/memory/global - 获取全局记忆
  fastify.get('/global', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const user = request.user as { userId: string };
      const globalDir = resolve(appConfig.dataDir, 'groups', 'user-global', user.userId);
      mkdirSync(globalDir, { recursive: true });
      const filePath = resolve(globalDir, 'CLAUDE.md');
      if (!existsSync(filePath)) {
        return reply.send({ content: '', exists: false });
      }
      const content = readFileSync(filePath, 'utf-8');
      return reply.send({ content, exists: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to read global memory' });
    }
  });

  // PUT /api/memory/global - 更新全局记忆
  fastify.put('/global', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const body = request.body as any;
      const user = request.user as { userId: string };
      const globalDir = resolve(appConfig.dataDir, 'groups', 'user-global', user.userId);
      mkdirSync(globalDir, { recursive: true });
      const filePath = resolve(globalDir, 'CLAUDE.md');
      writeFileSync(filePath, body.content || '');
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to write global memory' });
    }
  });
}
