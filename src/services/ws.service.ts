import { WebSocketServer, WebSocket } from 'ws';
import { verifyToken } from './auth.service.js';
import type { WsMessageOut, WsMessageIn, StreamEvent } from '../types.js';

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

    console.log('[ws] client connected', session.userId, 'role=', session.role, 'totalClients=', wsClients.size + 1);
    wsClients.set(ws, session);

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
      wsClients.delete(ws);
    });

    ws.on('error', () => {
      wsClients.delete(ws);
    });
  });

  return wss;
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
  for (const [client, clientInfo] of wsClients) {
    if (client.readyState !== WebSocket.OPEN) {
      wsClients.delete(client);
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
      wsClients.delete(client);
    }
  }
  if (msg.type === 'new_message') {
    console.log('[ws] broadcast new_message chatJid=', msg.chatJid, 'messageId=', (msg as any).message?.id, 'sender=', (msg as any).message?.sender, 'sent=', sent, 'skipped=', skipped, 'totalClients=', wsClients.size);
  } else {
    console.log('[ws] broadcast', msg.type, 'chatJid=', msg.chatJid, 'sent=', sent, 'skipped=', skipped, 'totalClients=', wsClients.size);
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
  safeBroadcast(out, () => true);
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
  safeBroadcast(out, () => true);
}

export function broadcastRunnerState(
  chatJid: string,
  state: 'idle' | 'running',
  agentId?: string
): void {
  safeBroadcast(
    { type: 'runner_state', chatJid, state, ...(agentId ? { agentId } : {}) },
    () => true
  );
}

export function broadcastTyping(chatJid: string, isTyping: boolean, agentId?: string): void {
  safeBroadcast(
    { type: 'typing', chatJid, isTyping, ...(agentId ? { agentId } : {}) },
    () => true
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
    () => true
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
    () => true
  );
}

export function getConnectedClients(): Map<WebSocket, WsClientInfo> {
  return wsClients;
}
