import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth.js';
import { groupDb, sessionDb } from '../db.js';
import * as processRegistry from '../services/process-registry.js';

export default async function statusRoutes(fastify: FastifyInstance) {
  // GET /api/status - 获取系统状态
  fastify.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const groups = groupDb.findAll();
      const sessions = sessionDb.findAll();
      const runningSessions = sessions.filter((s: any) => s.status === 'running');
      const activeProcesses = processRegistry.countActive();

      const activeHostProcesses = activeProcesses || runningSessions.length;

      return reply.send({
        status: 'healthy',
        version: '1.0.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        activeContainers: 0,
        activeHostProcesses,
        activeTotal: activeHostProcesses,
        maxConcurrentContainers: 20,
        maxConcurrentHostProcesses: 5,
        queueLength: 0,
        dockerImageExists: true,
        claudeCodeVersions: { host: null, container: null, latest: null },
        groups: groups.map((g) => {
          const active = runningSessions.some((s: any) => s.workspace === g.id);
          return {
            jid: g.id,
            name: g.name,
            status: active ? 'running' : 'idle',
            active,
            pendingMessages: false,
            pendingTasks: 0,
            containerName: null,
            displayName: g.name,
          };
        }),
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to get status' });
    }
  });
}
