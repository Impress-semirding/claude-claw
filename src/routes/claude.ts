import { Hono } from 'hono';
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

const claude = new Hono();

// Query schema
const querySchema = z.object({
  workspace: z.string().default('default'),
  sessionId: z.string().optional(),
  prompt: z.string().min(1),
  mcpServers: z.array(z.string()).optional(),
  systemPrompt: z.string().optional(),
});

// Create session endpoint
claude.post('/sessions', async (c) => {
  try {
    const user = c.get('user') as IAuthToken;
    const body = await c.req.json();
    const workspace = body.workspace || 'default';
    const sessionId = body.sessionId || uuidv4();

    const session = await createSession(user.userId, workspace, sessionId);

    return c.json({
      success: true,
      data: session,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create session',
      },
      500
    );
  }
});

// List sessions endpoint
claude.get('/sessions', async (c) => {
  try {
    const user = c.get('user') as IAuthToken;
    const sessions = listUserSessions(user.userId);

    return c.json({
      success: true,
      data: sessions,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list sessions',
      },
      500
    );
  }
});

// Get session endpoint
claude.get('/sessions/:sessionId', async (c) => {
  try {
    const user = c.get('user') as IAuthToken;
    const sessionId = c.req.param('sessionId');
    const workspace = c.req.query('workspace') || 'default';

    const session = getSession(user.userId, workspace, sessionId);
    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }

    return c.json({
      success: true,
      data: session,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get session',
      },
      500
    );
  }
});

// Delete session endpoint
claude.delete('/sessions/:sessionId', async (c) => {
  try {
    const user = c.get('user') as IAuthToken;
    const sessionId = c.req.param('sessionId');
    const workspace = c.req.query('workspace') || 'default';

    const success = destroySession(user.userId, workspace, sessionId);
    if (!success) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }

    return c.json({
      success: true,
      message: 'Session destroyed',
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to destroy session',
      },
      500
    );
  }
});

// Get session messages endpoint
claude.get('/sessions/:sessionId/messages', async (c) => {
  try {
    const sessionId = c.req.param('sessionId');
    const limit = parseInt(c.req.query('limit') || '100', 10);

    const messages = getSessionMessages(sessionId, limit);

    return c.json({
      success: true,
      data: messages,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get messages',
      },
      500
    );
  }
});

// Query endpoint (non-streaming)
claude.post('/query', async (c) => {
  try {
    const user = c.get('user') as IAuthToken;
    const body = await c.req.json();
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

    return c.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        events,
      },
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Query failed',
      },
      500
    );
  }
});

// Stream query endpoint
claude.post('/query/stream', async (c) => {
  try {
    const user = c.get('user') as IAuthToken;
    const body = await c.req.json();
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

    // Set up SSE
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    const stream = new ReadableStream({
      async start(controller) {
        const queryStream = querySession({
          userId: user.userId,
          workspace: data.workspace,
          sessionId: session.sessionId,
          prompt: data.prompt,
          mcpServers,
          systemPrompt: data.systemPrompt,
        });

        for await (const event of queryStream) {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(new TextEncoder().encode(data));
        }

        controller.close();
      },
    });

    return c.body(stream);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Query failed',
      },
      500
    );
  }
});

// Abort query endpoint
claude.post('/abort', async (c) => {
  try {
    const user = c.get('user') as IAuthToken;
    const body = await c.req.json();
    const { workspace = 'default', sessionId } = body;

    if (!sessionId) {
      return c.json({ success: false, error: 'Session ID required' }, 400);
    }

    const success = abortQuery(user.userId, workspace, sessionId);

    return c.json({
      success,
      message: success ? 'Query aborted' : 'No running query found',
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Abort failed',
      },
      500
    );
  }
});

// File upload endpoint
claude.post('/upload', async (c) => {
  try {
    const user = c.get('user') as IAuthToken;
    const body = await c.req.parseBody();

    const file = body.file as File;
    const workspace = (body.workspace as string) || 'default';
    const sessionId = (body.sessionId as string) || uuidv4();

    if (!file) {
      return c.json({ success: false, error: 'No file provided' }, 400);
    }

    // Ensure session exists
    const session = await getOrCreateSession(user.userId, workspace, sessionId);

    // Save file
    const uploadDir = resolve(appConfig.claude.baseDir, session.workDir, 'upload-files');
    mkdirSync(uploadDir, { recursive: true });

    const fileName = `${Date.now()}_${file.name}`;
    const filePath = join(uploadDir, fileName);

    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(filePath, buffer);

    return c.json({
      success: true,
      data: {
        fileName: file.name,
        filePath: join(session.workDir, 'upload-files', fileName),
        size: file.size,
        type: file.type,
      },
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      },
      500
    );
  }
});

export default claude;
