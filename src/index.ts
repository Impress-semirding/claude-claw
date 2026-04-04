import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
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
import type { WsMessageIn } from './types.js';
import type { WsClientInfo } from './services/ws.service.js';
import { wsSendMessageHandler } from './routes/messages.js';

// Create app
const app = new Hono();

// Middleware
app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', '*'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    exposeHeaders: ['Content-Length', 'X-Request-Id'],
    credentials: true,
    maxAge: 86400,
  })
);
app.use('*', logger());

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// Public routes
app.route('/api/auth', authRoutes);

// Protected routes
app.use('/api/claude/*', authMiddleware);
app.route('/api/claude', claudeRoutes);

app.use('/api/mcp/*', authMiddleware, adminMiddleware);
app.route('/api/mcp', mcpRoutes);

// Groups routes
app.route('/api/groups', groupsRoutes);

// Messages routes
app.route('/api/messages', messagesRoutes);

// Agent definitions routes
app.route('/api/agent-definitions', agentDefinitionsRoutes);

// Skills routes
app.route('/api/skills', skillsRoutes);

// Tasks routes
app.route('/api/tasks', tasksRoutes);

// Files routes (nested under groups)
app.route('/api/groups/:jid/files', filesRoutes);

// Agent routes (nested under groups)
app.route('/api/groups', agentsRoutes);

// Workspace config routes (nested under groups)
app.route('/api/groups', workspaceConfigRoutes);

// Browse routes
app.route('/api/browse', browseRoutes);

// Bug report routes
app.route('/api/bug-report', bugReportRoutes);

// Config routes
app.route('/api/config', configRoutes);

// Status routes
app.route('/api/status', statusRoutes);

// Admin routes
app.route('/api/admin', adminRoutes);

// MCP Servers routes
app.route('/api/mcp-servers', mcpServersRoutes);

// Billing routes
app.route('/api/billing', billingRoutes);

// Usage routes
app.route('/api/usage', usageRoutes);

// Docker routes
app.route('/api/docker', dockerRoutes);

// Memory routes
app.route('/api/memory', memoryRoutes);

// Admin stats (legacy)
app.get('/api/admin/stats', authMiddleware, adminMiddleware, async (c) => {
  return c.json({
    success: true,
    data: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: '1.0.0',
    },
  });
});

// Error handler
app.onError((err, c) => {
  console.error('Error:', err);
  return c.json(
    {
      success: false,
      error: err.message || 'Internal server error',
    },
    500
  );
});

// Not found handler
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: 'Not found',
    },
    404
  );
});

// Initialize application
let httpServer: ReturnType<typeof serve> | null = null;

async function init() {
  try {
    // Ensure directories exist
    mkdirSync(resolve(appConfig.claude.baseDir), { recursive: true });
    mkdirSync(resolve(appConfig.dataDir), { recursive: true });
    mkdirSync(resolve(appConfig.dataDir, 'config'), { recursive: true });
    mkdirSync(resolve(appConfig.dataDir, 'avatars'), { recursive: true });

    // Initialize database
    initSchema();
    console.log('Database initialized');

    // Initialize admin user
    await initAdminUser();

    // Load existing sessions
    loadSessionsFromDb();
    console.log('Sessions loaded from database');

    // Start cleanup interval
    setInterval(() => {
      const cleaned = cleanupIdleSessions();
      if (cleaned > 0) {
        console.log(`Cleaned up ${cleaned} idle sessions`);
      }
    }, 60000); // Every minute

    // Start server
    const port = appConfig.port;
    httpServer = serve(
      {
        fetch: app.fetch,
        port,
      },
      (info) => {
        console.log(`🚀 Server running on http://localhost:${info.port}`);
        console.log(`📁 Data directory: ${resolve(appConfig.dataDir)}`);
        console.log(`🔧 Claude base directory: ${resolve(appConfig.claude.baseDir)}`);
      }
    );

    // Setup WebSocket
    setupWebSocket(httpServer);
    setWsMessageHandler(async (client: WsClientInfo, msg: WsMessageIn) => {
      console.log('[ws-handler] received', msg.type, 'chatJid=', msg.chatJid, 'contentLength=', msg.content?.length);
      if (msg.type === 'send_message') {
        if (msg.chatJid && msg.content) {
          console.log('[ws-handler] forwarding send_message to wsSendMessageHandler');
          await wsSendMessageHandler(client, msg);
          console.log('[ws-handler] wsSendMessageHandler done');
        } else {
          console.log('[ws-handler] missing chatJid or content');
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
    console.error('Failed to initialize:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  if (httpServer) {
    httpServer.close();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  if (httpServer) {
    httpServer.close();
  }
  process.exit(0);
});

// Start
init();
