import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth.js';

export default async function dockerRoutes(fastify: FastifyInstance) {
  // POST /api/docker/build - 构建 Docker 镜像
  fastify.post('/build', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.status(202).send({ success: true, message: 'Docker build not supported in this version' });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to build Docker image' });
    }
  });

  // GET /api/docker/images - 获取 Docker 镜像列表
  fastify.get('/images', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({ images: [] });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load images' });
    }
  });
}
