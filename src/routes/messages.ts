import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth.js';
import { groupDb, messageDb, mcpServerDb } from '../db.js';
import { randomUUID } from 'crypto';
import {
  querySession,
  getOrCreateSession,
  saveUserMessage,
} from '../services/claude-session.service.js';
import {
  broadcastNewMessage,
  broadcastStreamEvent,
  broadcastRunnerState,
  broadcastTyping,
} from '../services/ws.service.js';
import type { WsClientInfo } from '../services/ws.service.js';
import type { IStreamEvent } from '../types.js';

// Track running queries per group to broadcast runner_state
const runningQueries = new Map<string, boolean>();

interface SendMessageResult {
  ok: true;
  messageId: string;
  timestamp: string;
}

async function handleMessageSend(
  userId: string,
  displayName: string,
  chatJid: string,
  content: string,
  attachments?: unknown[],
  _agentId?: string
): Promise<SendMessageResult | { ok: false; error: string; status: number }> {
  // Check group
  const group = groupDb.findById(chatJid);
  if (!group) {
    return { ok: false, error: 'Group not found', status: 404 };
  }

  const members = group.members || [];
  if (group.ownerId !== userId && !members.includes(userId)) {
    return { ok: false, error: 'Forbidden', status: 403 };
  }

  // Get or create session for this group
  const session = await getOrCreateSession(userId, chatJid);

  const messageId = randomUUID();
  const timestamp = new Date().toISOString();

  // Save user message
  saveUserMessage(userId, session.sessionId, content, attachments as any);

  // Broadcast new_message immediately
  broadcastNewMessage(chatJid, {
    id: messageId,
    chat_jid: chatJid,
    sender: userId,
    sender_name: displayName,
    content,
    timestamp,
    is_from_me: false,
    attachments: attachments ? JSON.stringify(attachments) : undefined,
  });

  // Get enabled MCP servers for this user/group
  const enabledMcpServers = mcpServerDb.findEnabled().map((s) => ({
    name: s.name,
    command: s.command,
    args: s.args,
    env: s.env,
  }));

  // Start query in background
  const groupConfig = group.config || {};
  const systemPrompt = groupConfig.systemPrompt;

  startQuery(userId, chatJid, session.sessionId, content, enabledMcpServers, systemPrompt);

  return { ok: true, messageId, timestamp };
}

async function startQuery(
  userId: string,
  chatJid: string,
  sessionId: string,
  prompt: string,
  mcpServers: unknown[],
  systemPrompt?: string
): Promise<void> {
  if (runningQueries.get(chatJid)) {
    return;
  }

  runningQueries.set(chatJid, true);
  broadcastRunnerState(chatJid, 'running');
  broadcastTyping(chatJid, true);

  let assistantText = '';
  let turnId = `turn-${Date.now()}`;

  console.log('[messages] startQuery', { userId, chatJid, sessionId, promptLength: prompt.length });

  try {
    const stream = querySession({
      userId,
      workspace: chatJid,
      sessionId,
      prompt,
      mcpServers,
      systemPrompt,
    });

    for await (const event of stream) {
      console.log('[messages] stream event', event.type, event.subtype || '');
      const ev = event as IStreamEvent;

      if (ev.type === 'system' && ev.subtype === 'init') {
        continue;
      }

      if (ev.type === 'assistant' && ev.content) {
        assistantText += ev.content;
        broadcastStreamEvent(chatJid, {
          eventType: 'text_delta',
          text: ev.content,
          turnId,
        });
        broadcastTyping(chatJid, false);
      } else if (ev.type === 'tool') {
        broadcastStreamEvent(chatJid, {
          eventType: 'tool_use_start',
          toolName: ev.tool_name || 'unknown',
          toolUseId: randomUUID(),
          turnId,
        });
        broadcastTyping(chatJid, false);
      } else if (ev.type === 'error') {
        broadcastStreamEvent(chatJid, {
          eventType: 'error',
          error: ev.error || 'Unknown error',
          turnId,
        });
      } else if (ev.type === 'complete') {
        broadcastStreamEvent(chatJid, {
          eventType: 'complete',
          turnId,
        });
      }
    }

    console.log('[messages] stream loop ended, assistantText.length=', assistantText.trim().length);

    if (assistantText.trim()) {
      console.log('[messages] saving assistant message, length', assistantText.trim().length);
      const assistantMsgId = randomUUID();
      const assistantTimestamp = new Date().toISOString();
      messageDb.create({
        id: assistantMsgId,
        sessionId,
        userId: '__assistant__',
        role: 'assistant',
        content: assistantText.trim(),
        metadata: {
          senderName: 'Claude',
          turnId,
          timestamp: assistantTimestamp,
        },
      });

      console.log('[messages] broadcasting new_message for assistant reply, chatJid=', chatJid, 'msgId=', assistantMsgId);
      broadcastNewMessage(chatJid, {
        id: assistantMsgId,
        chat_jid: chatJid,
        sender: '__assistant__',
        sender_name: 'Claude',
        content: assistantText.trim(),
        timestamp: assistantTimestamp,
        is_from_me: true,
      });
      console.log('[messages] broadcast complete');
    } else {
      console.log('[messages] no assistant text to save, text length=0');
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[messages] startQuery error', errorMsg);
    broadcastStreamEvent(chatJid, {
      eventType: 'error',
      error: errorMsg,
      turnId,
    });
  } finally {
    runningQueries.delete(chatJid);
    broadcastRunnerState(chatJid, 'idle');
    broadcastTyping(chatJid, false);
  }
}

export default async function messagesRoutes(fastify: FastifyInstance) {
  // POST /api/messages - 发送消息
  fastify.post('/', { preHandler: authMiddleware }, async (request, reply) => {
    const user = request.user as { userId: string; email: string; role: string };

    try {
      const body = request.body as any;
      const chatJid = body.chatJid || body.group_jid || body.groupId;
      const { content, attachments, agentId } = body;

      if (!chatJid || typeof chatJid !== 'string') {
        return reply.status(400).send({ error: 'chatJid is required' });
      }

      if (!content || typeof content !== 'string') {
        return reply.status(400).send({ error: 'content is required' });
      }

      const result = await handleMessageSend(
        user.userId,
        user.email,
        chatJid,
        content,
        attachments,
        agentId
      );

      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error });
      }

      return reply.send({
        success: true,
        messageId: result.messageId,
        timestamp: result.timestamp,
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to send message' });
    }
  });
}

// WebSocket message handler
export async function wsSendMessageHandler(
  client: WsClientInfo,
  msg: { chatJid?: string; content?: string; attachments?: unknown[]; agentId?: string }
): Promise<void> {
  if (!msg.chatJid || !msg.content) return;
  await handleMessageSend(
    client.userId,
    client.userId,
    msg.chatJid,
    msg.content,
    msg.attachments,
    msg.agentId
  );
}
