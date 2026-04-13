import { WebSocketServer, WebSocket } from 'ws';
import { verifyToken } from './auth.service.js';
import { logger } from '../logger.js';
import type { WsMessageOut, WsMessageIn, StreamEvent } from '../types.js';
import { groupDb } from '../db.js';

export interface WsClientInfo {
  sessionId: string;
  userId: string;
  role: string;
}

const wsClients = new Map<WebSocket, WsClientInfo>();

// Message handler callback set by index.ts
let messageHandler: ((client: WsClientInfo, msg: WsMessageIn) => Promise<void>) | null = null;

export function setWsMessageHandler(
  handler: (client: WsClientInfo, msg: WsMessageIn) => Promise<void>
): void {
  messageHandler = handler;
}

export function setupWebSocket(server: any): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request: any, socket: any, head: any) => {
    const { pathname } = new URL(request.url, `http://${request.headers.host}`);

    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

    // Verify session cookie
    const cookies = request.headers.cookie || '';
    const sessionMatch = cookies.match(/session=([^;]+)/);
    const token = sessionMatch ? sessionMatch[1] : null;

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const payload = await verifyToken(token);
    if (!payload) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    request.__clawSession = {
      sessionId: token,
      userId: payload.userId,
      role: payload.role,
    };

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws, request: any) => {
    const session = request?.__clawSession as WsClientInfo | undefined;
    if (!session) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    logger.info({ userId: session.userId, role: session.role, totalClients: wsClients.size + 1 }, '[ws] client connected');
    wsClients.set(ws, session);

    // Heartbeat to keep connection alive through proxies and browser power-saving
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);

    ws.on('pong', () => {
      logger.trace({ userId: session.userId }, '[ws] pong received');
    });

    ws.on('message', async (data) => {
      try {
        const msg: WsMessageIn = JSON.parse(data.toString());
        if (messageHandler) {
          await messageHandler(session, msg);
        }
      } catch (err) {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      clearInterval(pingInterval);
      wsClients.delete(ws);
    });

    ws.on('error', () => {
      clearInterval(pingInterval);
      wsClients.delete(ws);
    });
  });

  return wss;
}

function resolveGroupJid(chatJid: string): string {
  const match = chatJid.match(/^(.+)#agent:(.+)$/);
  return match ? match[1] : chatJid;
}

function buildChatFilter(chatJid: string): (client: WsClientInfo) => boolean {
  const groupJid = resolveGroupJid(chatJid);
  const group = groupDb.findById(groupJid);
  if (!group) {
    return () => false;
  }
  const members = new Set<string>([group.ownerId, ...(group.members || [])]);
  return (client) => members.has(client.userId) || client.role === 'admin';
}

/**
 * Broadcast a WebSocket message with optional filtering.
 */
export function safeBroadcast(
  msg: WsMessageOut,
  filter?: (client: WsClientInfo) => boolean
): void {
  const data = JSON.stringify(msg);
  let sent = 0;
  let skipped = 0;
  const toDelete: WebSocket[] = [];
  for (const [client, clientInfo] of wsClients) {
    if (client.readyState !== WebSocket.OPEN) {
      toDelete.push(client);
      continue;
    }
    if (filter && !filter(clientInfo)) {
      skipped++;
      continue;
    }
    try {
      client.send(data);
      sent++;
    } catch {
      toDelete.push(client);
    }
  }
  for (const client of toDelete) {
    wsClients.delete(client);
  }
  if (msg.type === 'new_message') {
    logger.info({ chatJid: msg.chatJid, messageId: (msg as any).message?.id, sender: (msg as any).message?.sender, sent, skipped, totalClients: wsClients.size }, '[ws] broadcast new_message');
  } else {
    logger.trace({ type: msg.type, chatJid: msg.chatJid, sent, skipped, totalClients: wsClients.size }, '[ws] broadcast');
  }
}

export function broadcastNewMessage(
  chatJid: string,
  msg: any,
  agentId?: string,
  source?: string
): void {
  const out: WsMessageOut = {
    type: 'new_message',
    chatJid,
    message: { ...msg, is_from_me: msg.is_from_me ?? false },
    ...(agentId ? { agentId } : {}),
    ...(source ? { source } : {}),
  };
  safeBroadcast(out, buildChatFilter(chatJid));
}

export function broadcastStreamEvent(
  chatJid: string,
  event: StreamEvent,
  agentId?: string
): void {
  const out: WsMessageOut = {
    type: 'stream_event',
    chatJid,
    event,
    ...(agentId ? { agentId } : {}),
  };
  safeBroadcast(out, buildChatFilter(chatJid));
}

export function broadcastRunnerState(
  chatJid: string,
  state: 'idle' | 'running',
  agentId?: string
): void {
  safeBroadcast(
    { type: 'runner_state', chatJid, state, ...(agentId ? { agentId } : {}) },
    buildChatFilter(chatJid)
  );
}

export function broadcastTyping(chatJid: string, isTyping: boolean, agentId?: string): void {
  safeBroadcast(
    { type: 'typing', chatJid, isTyping, ...(agentId ? { agentId } : {}) },
    buildChatFilter(chatJid)
  );
}

export function broadcastAgentStatus(
  chatJid: string,
  agentId: string,
  status: string,
  name: string,
  prompt: string,
  resultSummary?: string,
  kind?: string
): void {
  safeBroadcast(
    {
      type: 'agent_status',
      chatJid,
      agentId,
      status,
      name,
      prompt,
      resultSummary,
      kind,
    } as any,
    buildChatFilter(chatJid)
  );
}

export function broadcastGroupCreated(
  jid: string,
  folder: string,
  name: string,
  userId?: string
): void {
  safeBroadcast(
    { type: 'group_created', chatJid: jid, folder, name } as any,
    (client) => !userId || client.userId === userId || client.role === 'admin'
  );
}

export function broadcastToWebClients(chatJid: string, text: string): void {
  const timestamp = new Date().toISOString();
  safeBroadcast(
    { type: 'agent_reply', chatJid, text, timestamp },
    buildChatFilter(chatJid)
  );
}

export function getConnectedClients(): Map<WebSocket, WsClientInfo> {
  return wsClients;
}
