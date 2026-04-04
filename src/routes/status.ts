import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { groupDb, sessionDb } from '../db.js';
import * as processRegistry from '../services/process-registry.js';

const status = new Hono();

// GET /api/status - 获取系统状态
status.get('/', authMiddleware, async (c) => {
  try {
    const groups = groupDb.findAll();
    const sessions = sessionDb.findAll();
    const runningSessions = sessions.filter((s: any) => s.status === 'running');
    const activeProcesses = processRegistry.countActive();

    return c.json({
      status: 'healthy',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      activeContainers: 0,
      activeHostProcesses: activeProcesses || runningSessions.length,
      queueLength: 0,
      groups: groups.map((g) => ({
        jid: g.id,
        name: g.name,
        status: runningSessions.some((s: any) => s.workspace === g.id) ? 'running' : 'idle',
        pendingMessages: false,
        pendingTasks: 0,
        containerName: null,
        displayName: g.name,
      })),
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to get status' }, 500);
  }
});

export default status;
