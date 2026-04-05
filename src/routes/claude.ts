import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import {
  createSession,
  getSession,
  getOrCreateSession,
  listUserSessions,
  destroySession,
  abortQuery,
  querySession,
  saveUserMessage,
  getSessionMessages,
} from '../services/claude-session.service.js';
import { mcpServerDb } from '../db.js';
import { appConfig } from '../config.js';
import type { IAuthToken } from '../services/auth.service.js';

// Query schema
const querySchema = z.object({
  workspace: z.string().default('default'),
  sessionId: z.string().optional(),
  prompt: z.string().min(1),
  mcpServers: z.array(z.string()).optional(),
  systemPrompt: z.string().optional(),
});

export default async function claudeRoutes(fastify: FastifyInstance) {
  // Create session endpoint
  fastify.post('/sessions', async (request, reply) => {
    try {
      const user = request.user as IAuthToken;
      const body = request.body as any;
      const workspace = body.workspace || 'default';
      const sessionId = body.sessionId || uuidv4();

      const session = await createSession(user.userId, workspace, sessionId);

      return reply.send({
        success: true,
        data: session,
      });
    } catch (error) {
      return reply.status(500).send(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create session',
        }
      );
    }
  });

  // List sessions endpoint
  fastify.get('/sessions', async (request, reply) => {
    try {
      const user = request.user as IAuthToken;
      const sessions = listUserSessions(user.userId);

      return reply.send({
        success: true,
        data: sessions,
      });
    } catch (error) {
      return reply.status(500).send(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list sessions',
        }
      );
    }
  });

  // Get session endpoint
  fastify.get('/sessions/:sessionId', async (request, reply) => {
    try {
      const user = request.user as IAuthToken;
      const { sessionId } = request.params as any;
      const workspace = (request.query as any).workspace || 'default';

      const session = getSession(user.userId, workspace, sessionId);
      if (!session) {
        return reply.status(404).send({ success: false, error: 'Session not found' });
      }

      return reply.send({
        success: true,
        data: session,
      });
    } catch (error) {
      return reply.status(500).send(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get session',
        }
      );
    }
  });

  // Delete session endpoint
  fastify.delete('/sessions/:sessionId', async (request, reply) => {
    try {
      const user = request.user as IAuthToken;
      const { sessionId } = request.params as any;
      const workspace = (request.query as any).workspace || 'default';

      const success = destroySession(user.userId, workspace, sessionId);
      if (!success) {
        return reply.status(404).send({ success: false, error: 'Session not found' });
      }

      return reply.send({
        success: true,
        message: 'Session destroyed',
      });
    } catch (error) {
      return reply.status(500).send(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to destroy session',
        }
      );
    }
  });

  // Get session messages endpoint
  fastify.get('/sessions/:sessionId/messages', async (request, reply) => {
    try {
      const { sessionId } = request.params as any;
      const limit = parseInt((request.query as any).limit || '100', 10);

      const messages = getSessionMessages(sessionId, limit);

      return reply.send({
        success: true,
        data: messages,
      });
    } catch (error) {
      return reply.status(500).send(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get messages',
        }
      );
    }
  });

  // Query endpoint (non-streaming)
  fastify.post('/query', async (request, reply) => {
    try {
      const user = request.user as IAuthToken;
      const body = request.body as any;
      const data = querySchema.parse(body);

      // Get or create session
      const session = await getOrCreateSession(user.userId, data.workspace, data.sessionId);

      // Get MCP servers
      const mcpServers: unknown[] = [];
      if (data.mcpServers && data.mcpServers.length > 0) {
        for (const serverId of data.mcpServers) {
          const server = mcpServerDb.findById(serverId);
          if (server && server.enabled) {
            mcpServers.push({
              name: server.name,
              command: server.command,
              args: server.args,
              env: server.env,
            });
          }
        }
      }

      // Save user message
      saveUserMessage(user.userId, session.sessionId, data.prompt);

      // Collect all events
      const events: unknown[] = [];
      const stream = querySession({
        userId: user.userId,
        workspace: data.workspace,
        sessionId: session.sessionId,
        prompt: data.prompt,
        mcpServers,
        systemPrompt: data.systemPrompt,
      });

      for await (const event of stream) {
        events.push(event);
      }

      return reply.send({
        success: true,
        data: {
          sessionId: session.sessionId,
          events,
        },
      });
    } catch (error) {
      return reply.status(500).send(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Query failed',
        }
      );
    }
  });

  // GET query endpoint (streaming SSE for UI compatibility)
  fastify.get('/query', async (request, reply) => {
    try {
      const user = request.user as IAuthToken;
      const query = request.query as any;
      const workspace = query.workspace || 'default';
      const sessionId = query.sessionId || query.session_id || uuidv4();
      const prompt = query.prompt || '';
      const systemPrompt = query.systemPrompt || undefined;

      if (!prompt) {
        return reply.status(400).send({ success: false, error: 'Prompt is required' });
      }

      const session = await getOrCreateSession(user.userId, workspace, sessionId);
      saveUserMessage(user.userId, session.sessionId, prompt);

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const queryStream = querySession({
        userId: user.userId,
        workspace,
        sessionId: session.sessionId,
        prompt,
        mcpServers: [],
        systemPrompt,
      });

      for await (const event of queryStream) {
        const line = `data: ${JSON.stringify(event)}\n\n`;
        reply.raw.write(line);
      }

      reply.raw.end();
      return reply;
    } catch (error) {
      return reply.status(500).send(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Query failed',
        }
      );
    }
  });

  // Stream query endpoint
  fastify.post('/query/stream', async (request, reply) => {
    try {
      const user = request.user as IAuthToken;
      const body = request.body as any;
      const data = querySchema.parse(body);

      // Get or create session
      const session = await getOrCreateSession(user.userId, data.workspace, data.sessionId);

      // Get MCP servers
      const mcpServers: unknown[] = [];
      if (data.mcpServers && data.mcpServers.length > 0) {
        for (const serverId of data.mcpServers) {
          const server = mcpServerDb.findById(serverId);
          if (server && server.enabled) {
            mcpServers.push({
              name: server.name,
              command: server.command,
              args: server.args,
              env: server.env,
            });
          }
        }
      }

      // Save user message
      saveUserMessage(user.userId, session.sessionId, data.prompt);

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const queryStream = querySession({
        userId: user.userId,
        workspace: data.workspace,
        sessionId: session.sessionId,
        prompt: data.prompt,
        mcpServers,
        systemPrompt: data.systemPrompt,
      });

      for await (const event of queryStream) {
        const line = `data: ${JSON.stringify(event)}\n\n`;
        reply.raw.write(line);
      }

      reply.raw.end();
      return reply;
    } catch (error) {
      return reply.status(500).send(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Query failed',
        }
      );
    }
  });

  // Abort query endpoint
  fastify.post('/abort', async (request, reply) => {
    try {
      const user = request.user as IAuthToken;
      const body = request.body as any;
      const { workspace = 'default', sessionId } = body;

      if (!sessionId) {
        return reply.status(400).send({ success: false, error: 'Session ID required' });
      }

      const success = abortQuery(user.userId, workspace, sessionId);

      return reply.send({
        success,
        message: success ? 'Query aborted' : 'No running query found',
      });
    } catch (error) {
      return reply.status(500).send(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Abort failed',
        }
      );
    }
  });

  // File upload endpoint
  fastify.post('/upload', async (request, reply) => {
    try {
      const user = request.user as IAuthToken;
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({ success: false, error: 'No file provided' });
      }

      // Parse fields from multipart
      const fields: any = {};
      for (const [key, value] of Object.entries(data.fields || {})) {
        fields[key] = Array.isArray(value) ? (value[0] as any).value : (value as any).value;
      }

      const workspace = fields.workspace || 'default';
      const sessionId = fields.sessionId || uuidv4();

      // Ensure session exists
      const session = await getOrCreateSession(user.userId, workspace, sessionId);

      // Save file
      const uploadDir = resolve(appConfig.claude.baseDir, session.workDir, 'upload-files');
      mkdirSync(uploadDir, { recursive: true });

      const fileName = `${Date.now()}_${data.filename}`;
      const filePath = join(uploadDir, fileName);

      const buffer = await data.toBuffer();
      writeFileSync(filePath, buffer);

      return reply.send({
        success: true,
        data: {
          fileName: data.filename,
          filePath: join(session.workDir, 'upload-files', fileName),
          size: buffer.length,
          type: data.mimetype,
        },
      });
    } catch (error) {
      return reply.status(500).send(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Upload failed',
        }
      );
    }
  });
}
