import Fastify from 'fastify';
import pino from 'pino';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
import { config } from 'dotenv';

// Load environment variables
config();

// Import configuration
import { appConfig } from './config.js';

// Import database
import { initSchema } from './db.js';

// Import services
import { initAdminUser } from './services/auth.service.js';
import { loadSessionsFromDb, cleanupIdleSessions } from './services/claude-session.service.js';
import { startProcessWatchdog } from './services/process-registry.js';
import { runDailySummaryIfNeeded } from './daily-summary.js';
import { ensurePredefinedAgentsForAllGroups } from './services/agent-presets.js';
import { startSchedulerLoop, initializeTaskSchedules } from './services/task-scheduler.js';

// Import routes
import authRoutes, { authMiddleware, adminMiddleware } from './routes/auth.js';
import claudeRoutes from './routes/claude.js';
import mcpRoutes from './routes/mcp.js';
import groupsRoutes from './routes/groups.js';
import messagesRoutes from './routes/messages.js';
import agentDefinitionsRoutes from './routes/agent-definitions.js';
import skillsRoutes from './routes/skills.js';
import tasksRoutes from './routes/tasks.js';
import filesRoutes from './routes/files.js';
import configRoutes from './routes/config.js';
import statusRoutes from './routes/status.js';
import adminRoutes from './routes/admin.js';
import mcpServersRoutes from './routes/mcp-servers.js';
import billingRoutes from './routes/billing.js';
import usageRoutes from './routes/usage.js';
import dockerRoutes from './routes/docker.js';
import memoryRoutes from './routes/memory.js';
import agentsRoutes from './routes/agents.js';
import browseRoutes from './routes/browse.js';
import bugReportRoutes from './routes/bug-report.js';
import workspaceConfigRoutes from './routes/workspace-config.js';

// Import WebSocket
import { setupWebSocket, setWsMessageHandler } from './services/ws.service.js';
import { logger } from './logger.js';
import type { WsMessageIn } from './types.js';
import type { WsClientInfo } from './services/ws.service.js';
import { wsSendMessageHandler } from './routes/messages.js';

// Create Fastify instance
const fastifyLogger = pino({
  level: 'info',
  hooks: {
    logMethod(inputArgs, method) {
      // Suppress Fastify's repeated "Server listening at" logs for every interface.
      // We already print a consolidated startup message after app.listen().
      if (inputArgs[0] === 'Server listening at %s') {
        return;
      }
      return method.apply(this, inputArgs);
    },
  },
});

const app = Fastify({
  loggerInstance: fastifyLogger,
  // Skill installation via npx can take >60s (downloading CLI + cloning repo).
  // Default Fastify connectionTimeout is 60s; raise it to avoid 500 on long installs.
  connectionTimeout: 300_000,
});

async function init() {
  try {
    // Register plugins
    await app.register(cors, {
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', '*'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
      exposedHeaders: ['Content-Length', 'X-Request-Id'],
      credentials: true,
      maxAge: 86400,
    });

    await app.register(multipart, {
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
      },
    });

    // Ensure directories exist
    mkdirSync(resolve(appConfig.claude.baseDir), { recursive: true });
    mkdirSync(resolve(appConfig.dataDir), { recursive: true });
    mkdirSync(resolve(appConfig.dataDir, 'config'), { recursive: true });
    mkdirSync(resolve(appConfig.dataDir, 'avatars'), { recursive: true });

    // Initialize database
    initSchema();
    logger.info('Database initialized');

    // Initialize admin user
    await initAdminUser();

    // Load existing sessions
    loadSessionsFromDb();
    logger.info('Sessions loaded from database');

    // Ensure predefined sub-agents for all existing groups
    ensurePredefinedAgentsForAllGroups();

    // Initialize task schedules and start scheduler
    initializeTaskSchedules();
    startSchedulerLoop();

    // Start cleanup interval
    setInterval(() => {
      const cleaned = cleanupIdleSessions();
      if (cleaned > 0) {
        logger.info({ cleaned }, 'Cleaned up idle sessions');
      }
    }, 60000); // Every minute

    // Start runner process watchdog
    startProcessWatchdog();

    // Daily heartbeat summary (runs within 2:00–3:00 AM window, throttled to once per 55min)
    setInterval(() => {
      runDailySummaryIfNeeded().catch((err) =>
        logger.error({ err }, '[daily-summary] interval error')
      );
    }, 60000); // Check every minute

    // Health check
    app.get('/health', async (_request, reply) => {
      return reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      });
    });

    // Public routes
    await app.register(authRoutes, { prefix: '/api/auth' });

    // Protected routes
    await app.register(claudeRoutes, { prefix: '/api/claude' });
    app.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/api/claude')) {
        await authMiddleware(request, reply);
      }
    });

    await app.register(mcpRoutes, { prefix: '/api/mcp' });
    app.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/api/mcp')) {
        await authMiddleware(request, reply);
        await adminMiddleware(request, reply);
      }
    });

    // Groups routes
    await app.register(groupsRoutes, { prefix: '/api/groups' });

    // Messages routes
    await app.register(messagesRoutes, { prefix: '/api/messages' });

    // Agent definitions routes
    await app.register(agentDefinitionsRoutes, { prefix: '/api/agent-definitions' });

    // Skills routes
    await app.register(skillsRoutes, { prefix: '/api/skills' });

    // Tasks routes
    await app.register(tasksRoutes, { prefix: '/api/tasks' });

    // Files routes (nested under groups)
    await app.register(filesRoutes, { prefix: '/api/groups/:jid/files' });

    // Agent routes (nested under groups)
    await app.register(agentsRoutes, { prefix: '/api/groups' });

    // Workspace config routes (nested under groups)
    await app.register(workspaceConfigRoutes, { prefix: '/api/groups' });

    // Browse routes
    await app.register(browseRoutes, { prefix: '/api/browse' });

    // Bug report routes
    await app.register(bugReportRoutes, { prefix: '/api/bug-report' });

    // Config routes
    await app.register(configRoutes, { prefix: '/api/config' });

    // Status routes
    await app.register(statusRoutes, { prefix: '/api/status' });

    // Admin routes
    await app.register(adminRoutes, { prefix: '/api/admin' });

    // MCP Servers routes
    await app.register(mcpServersRoutes, { prefix: '/api/mcp-servers' });

    // Billing routes
    await app.register(billingRoutes, { prefix: '/api/billing' });

    // Usage routes
    await app.register(usageRoutes, { prefix: '/api/usage' });

    // Docker routes
    await app.register(dockerRoutes, { prefix: '/api/docker' });

    // Memory routes
    await app.register(memoryRoutes, { prefix: '/api/memory' });

    // Admin stats (legacy)
    app.get('/api/admin/stats', { preHandler: [authMiddleware, adminMiddleware] }, async (_request, reply) => {
      return reply.send({
        success: true,
        data: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          version: '1.0.0',
        },
      });
    });

    // Error handler
    app.setErrorHandler((error, _request, reply) => {
      logger.error({ error }, 'Unhandled error');
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        success: false,
        error: message || 'Internal server error',
      });
    });

    // Not found handler
    app.setNotFoundHandler((_request, reply) => {
      return reply.status(404).send({
        success: false,
        error: 'Not found',
      });
    });

    // Start server
    const port = appConfig.port;
    await app.ready();
    await app.listen({ port, host: '0.0.0.0' });
    logger.info(`🚀 Server running on http://localhost:${port}`);
    logger.info(`📁 Data directory: ${resolve(appConfig.dataDir)}`);
    logger.info(`🔧 Claude base directory: ${resolve(appConfig.claude.baseDir)}`);

    // Setup WebSocket on the raw HTTP server
    const server = app.server;
    if (server) {
      setupWebSocket(server);
    }

    setWsMessageHandler(async (client: WsClientInfo, msg: WsMessageIn) => {
      logger.trace({ type: msg.type, chatJid: msg.chatJid, contentLength: msg.content?.length }, '[ws-handler] received');
      if (msg.type === 'send_message') {
        if (msg.chatJid && msg.content) {
          logger.trace('[ws-handler] forwarding send_message to wsSendMessageHandler');
          await wsSendMessageHandler(client, msg);
          logger.trace('[ws-handler] wsSendMessageHandler done');
        } else {
          logger.trace('[ws-handler] missing chatJid or content');
        }
      } else if (msg.type === 'terminal_start') {
        // Dockerless edition - terminal not supported
        const { safeBroadcast } = await import('./services/ws.service.js');
        safeBroadcast(
          {
            type: 'terminal_error',
            chatJid: msg.chatJid || '',
            error: 'Terminal not supported in Dockerless edition',
          },
          (c) => c.sessionId === client.sessionId
        );
      } else if (msg.type === 'terminal_input') {
        // No-op
      } else if (msg.type === 'terminal_resize') {
        // No-op
      } else if (msg.type === 'terminal_stop') {
        // No-op
      }
    });
  } catch (error) {
    logger.fatal({ error }, 'Failed to initialize');
    process.exitCode = 1;
    return;
  }
}

import { agentPool } from './services/agent-pool.js';

// Handle graceful shutdown
let isShuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'Shutting down gracefully...');
  for (const { sessionId } of agentPool.listActive()) {
    agentPool.kill(sessionId, 'SIGTERM');
  }
  await app.close().catch(() => { /* ignore close errors during shutdown */ });
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Start
init();
