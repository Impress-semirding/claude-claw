import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth.js';

export default async function bugReportRoutes(fastify: FastifyInstance) {
  // GET /api/bug-report/capabilities - 获取 Bug Report 能力
  fastify.get('/capabilities', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({
        canGenerate: true,
        canSubmit: false,
        providers: [],
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to get capabilities' });
    }
  });

  // POST /api/bug-report/generate - 生成 Bug Report
  fastify.post('/generate', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const body = request.body as any;
      const prompt = body.prompt || 'No prompt provided';
      return reply.send({
        success: true,
        title: 'Bug Report',
        body: prompt,
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to generate bug report' });
    }
  });

  // POST /api/bug-report/submit - 提交 Bug Report
  fastify.post('/submit', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({
        success: false,
        message: 'Bug report submission is not supported in this version',
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to submit bug report' });
    }
  });
}
