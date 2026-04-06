import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth.js';
import { groupDb, messageDb, mcpServerDb, agentDb } from '../db.js';
import { randomUUID } from 'crypto';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { appConfig } from '../config.js';
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
  agentId?: string
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

  // Get or create session for this group (scoped by agentId)
  const session = await getOrCreateSession(userId, chatJid, undefined, agentId);

  const messageId = randomUUID();
  const timestamp = new Date().toISOString();

  // Save user message
  saveUserMessage(userId, session.sessionId, content, attachments as any, messageId, {
    senderName: displayName,
    sourceKind: 'user_message',
    timestamp,
    agentId,
  });
  console.log('[messages] saved user message', { messageId, sessionId: session.sessionId, chatJid, agentId });

  // Broadcast new_message immediately
  const userMsgPayload = {
    id: messageId,
    chat_jid: chatJid,
    sender: userId,
    sender_name: displayName,
    content,
    timestamp,
    is_from_me: false,
    attachments: attachments ? JSON.stringify(attachments) : undefined,
    source_kind: 'user_message',
    session_id: session.sessionId,
  };
  console.log('[messages] broadcasting user new_message', JSON.stringify(userMsgPayload));
  broadcastNewMessage(chatJid, userMsgPayload, agentId);

  // Get enabled MCP servers for this user/group and shape them for the SDK
  const enabledMcpServers: Record<string, any> = {};
  for (const s of mcpServerDb.findEnabled()) {
    if (s.type === 'sse' || s.url) {
      enabledMcpServers[s.name] = {
        type: 'sse',
        url: s.url,
        headers: s.headers || {},
      };
    } else {
      enabledMcpServers[s.name] = {
        type: 'stdio',
        command: s.command,
        args: s.args || [],
        env: s.env || {},
      };
    }
  }

  // Build system prompt: global memory + group system prompt
  const groupConfig = group.config || {};
  let systemPrompt = groupConfig.systemPrompt || '';

  // Read user global memory (data/groups/user-global/{userId}/CLAUDE.md)
  const globalMemoryDir = resolve(appConfig.dataDir, 'groups', 'user-global', userId);
  const globalMemoryPath = resolve(globalMemoryDir, 'CLAUDE.md');
  if (existsSync(globalMemoryPath)) {
    const memoryContent = readFileSync(globalMemoryPath, 'utf-8');
    if (memoryContent.trim()) {
      systemPrompt = systemPrompt
        ? `${memoryContent.trim()}\n\n${systemPrompt}`
        : memoryContent.trim();
    }
  }

  // Add agent-specific prompt for conversation agents
  if (agentId) {
    const agent = agentDb.findById(agentId);
    if (agent?.prompt) {
      systemPrompt = systemPrompt
        ? `${agent.prompt.trim()}\n\n${systemPrompt}`
        : agent.prompt.trim();
    }
  }

  const mcpNames = Object.keys(enabledMcpServers);
  console.log('[messages] startQuery', {
    userId,
    chatJid,
    sessionId: session.sessionId,
    agentId,
    promptLength: content.length,
    systemPromptLength: systemPrompt.length,
    mcpCount: mcpNames.length,
    mcpNames,
  });
  console.log('[messages] mcpPayload:', JSON.stringify(enabledMcpServers));

  startQuery(userId, chatJid, session.sessionId, content, enabledMcpServers, systemPrompt, agentId);

  return { ok: true, messageId, timestamp };
}

async function startQuery(
  userId: string,
  chatJid: string,
  sessionId: string,
  prompt: string,
  mcpServers: Record<string, unknown>,
  systemPrompt?: string,
  agentId?: string
): Promise<void> {
  const queryKey = agentId ? `${chatJid}:${agentId}` : chatJid;
  if (runningQueries.get(queryKey)) {
    return;
  }

  runningQueries.set(queryKey, true);
  broadcastRunnerState(chatJid, 'running', agentId);
  broadcastTyping(chatJid, true, agentId);

  let assistantText = '';
  let turnId = `turn-${Date.now()}`;

  const mcpNames = Object.keys(mcpServers);
  console.log('[messages] startQuery', { userId, chatJid, sessionId, agentId, promptLength: prompt.length, mcpCount: mcpNames.length, mcpNames });

  try {
    const stream = querySession({
      userId,
      workspace: chatJid,
      sessionId,
      prompt,
      mcpServers,
      systemPrompt,
      onStreamEvent: (ev) => {
        broadcastStreamEvent(chatJid, ev, agentId);
        if (ev.eventType === 'text_delta' || ev.eventType === 'thinking_delta') {
          broadcastTyping(chatJid, false, agentId);
        }
      },
      turnId,
    });

    for await (const event of stream) {
      console.log('[messages] stream event', event.type, event.subtype || '');
      const ev = event as IStreamEvent;

      if (ev.type === 'system' && ev.subtype === 'init') {
        continue;
      }

      if (ev.type === 'assistant' && ev.content) {
        assistantText = ev.content;
      } else if (ev.type === 'error') {
        broadcastStreamEvent(chatJid, {
          eventType: 'error',
          error: ev.error || 'Unknown error',
          turnId,
        }, agentId);
      } else if (ev.type === 'complete') {
        broadcastStreamEvent(chatJid, {
          eventType: 'complete',
          turnId,
        }, agentId);
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
          sourceKind: 'sdk_final',
          finalizationReason: 'completed',
          agentId,
        },
      });

      console.log('[messages] broadcasting new_message for assistant reply, chatJid=', chatJid, 'agentId=', agentId, 'msgId=', assistantMsgId);
      broadcastNewMessage(chatJid, {
        id: assistantMsgId,
        chat_jid: chatJid,
        sender: '__assistant__',
        sender_name: 'Claude',
        content: assistantText.trim(),
        timestamp: assistantTimestamp,
        is_from_me: true,
        turn_id: turnId,
        session_id: sessionId,
        sdk_message_uuid: null,
        source_kind: 'sdk_final',
        finalization_reason: 'completed',
      }, agentId);
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
    }, agentId);
  } finally {
    runningQueries.delete(queryKey);
    broadcastRunnerState(chatJid, 'idle', agentId);
    broadcastTyping(chatJid, false, agentId);
  }
}

export default async function messagesRoutes(fastify: FastifyInstance) {
  // POST /api/messages - 发送消息
  fastify.post('/', { preHandler: authMiddleware }, async (request, reply) => {
    const user = request.user as { userId: string; email: string; role: string };

    try {
      const body = request.body as any;
      const chatJid = body.chatJid || body.chat_jid || body.group_jid || body.groupId;
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
