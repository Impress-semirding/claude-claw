import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth.js';
import { groupDb, messageDb, mcpServerDb } from '../db.js';
import { randomUUID } from 'crypto';
import { resolve } from 'path';
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
import { resolveAgent } from '../services/agent-presets.js';
import { ClaudeAgent, AgentEnvironment } from '../services/agent.js';

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

  // Resolve agent and build environment
  const agent = resolveAgent(chatJid, agentId);
  const groupConfig = group.config || {};
  const workspaceDir = resolve(appConfig.claude.baseDir, group.folder || '');
  const userGlobalPath = resolve(appConfig.dataDir, 'groups', 'user-global', userId, 'CLAUDE.md');

  const env: AgentEnvironment = {
    userId,
    email: displayName,
    chatJid,
    workspaceDir,
    userGlobalPath,
    groupConfig,
  };

  // Fire-and-forget the agent query
  runAgentQuery(agent, env, session.sessionId, content, enabledMcpServers, chatJid, agentId);

  return { ok: true, messageId, timestamp };
}

async function runAgentQuery(
  agent: ClaudeAgent,
  env: AgentEnvironment,
  sessionId: string,
  content: string,
  mcpServers: Record<string, unknown>,
  chatJid: string,
  agentId?: string
): Promise<void> {
  const queryKey = agentId ? `${chatJid}:${agentId}` : chatJid;
  if (runningQueries.get(queryKey)) {
    return;
  }

  runningQueries.set(queryKey, true);
  broadcastRunnerState(chatJid, 'running', agentId);
  broadcastTyping(chatJid, true, agentId);

  let turnId = `turn-${Date.now()}`;
  let result: import('../services/agent.js').AgentQueryResult | undefined;

  const mcpNames = Object.keys(mcpServers);
  console.log('[messages] runAgentQuery', {
    userId: env.userId,
    chatJid,
    sessionId,
    agentId,
    promptLength: content.length,
    mcpCount: mcpNames.length,
    mcpNames,
  });

  try {
    result = await agent.query(env, content, {
      sessionId,
      mcpServers,
      onStreamEvent: (ev) => {
        broadcastStreamEvent(chatJid, ev, agentId);
        if (ev.eventType === 'text_delta' || ev.eventType === 'thinking_delta') {
          broadcastTyping(chatJid, false, agentId);
        }
      },
      onTypingChange: (isTyping) => {
        broadcastTyping(chatJid, isTyping, agentId);
      },
    });

    turnId = result.turnId;

    if (result.error) {
      console.error('[messages] agent query error', result.error);
    }

    // Handle overflow partial recovery
    if (result.contextOverflow && result.assistantText) {
      console.log('[messages] saving overflow_partial, length', result.assistantText.trim().length);
      const partialMsgId = randomUUID();
      const partialTimestamp = new Date().toISOString();
      messageDb.create({
        id: partialMsgId,
        sessionId,
        userId: '__assistant__',
        role: 'assistant',
        content: result.assistantText.trim(),
        metadata: {
          senderName: 'Claude',
          turnId,
          timestamp: partialTimestamp,
          sourceKind: 'overflow_partial',
          finalizationReason: 'context_overflow',
          agentId,
        },
      });

      broadcastNewMessage(chatJid, {
        id: partialMsgId,
        chat_jid: chatJid,
        sender: '__assistant__',
        sender_name: 'Claude',
        content: result.assistantText.trim() + '\n\n_（上下文溢出，部分回复已保存）_',
        timestamp: partialTimestamp,
        is_from_me: true,
        turn_id: turnId,
        session_id: sessionId,
        sdk_message_uuid: null,
        source_kind: 'overflow_partial',
        finalization_reason: 'context_overflow',
      }, agentId);
      return;
    }

    // Handle unrecoverable errors
    if (result.unrecoverableError) {
      console.log('[messages] unrecoverable error, not saving assistant message');
      return;
    }

    if (result.assistantText.trim()) {
      console.log('[messages] saving assistant message, length', result.assistantText.trim().length);
      const assistantMsgId = randomUUID();
      const assistantTimestamp = new Date().toISOString();
      messageDb.create({
        id: assistantMsgId,
        sessionId,
        userId: '__assistant__',
        role: 'assistant',
        content: result.assistantText.trim(),
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
        content: result.assistantText.trim(),
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
    console.error('[messages] runAgentQuery error', errorMsg);
    broadcastStreamEvent(chatJid, {
      eventType: 'error',
      error: errorMsg,
      turnId,
    }, agentId);
  } finally {
    runningQueries.delete(queryKey);
    broadcastRunnerState(chatJid, 'idle', agentId);
    broadcastTyping(chatJid, false, agentId);

    // Trigger memory flush after compaction (non-blocking)
    if (result?.hadCompaction) {
      console.log('[messages] compaction happened, triggering memory flush');
      agent.buildSystemPrompt(env).then((systemPrompt) => {
        runMemoryFlush(env.userId, chatJid, sessionId, mcpServers, systemPrompt).catch((err) => {
          console.error('[messages] memory flush error:', err);
        });
      }).catch((err) => {
        console.error('[messages] buildSystemPrompt for flush error:', err);
      });
    }
  }
}

/**
 * Run memory flush query after compaction (inspired by happyclaw)
 * This is a background operation that updates CLAUDE.md and memory files.
 */
async function runMemoryFlush(
  userId: string,
  chatJid: string,
  sessionId: string,
  mcpServers: Record<string, unknown>,
  systemPrompt: string
): Promise<void> {
  const flushKey = `flush:${chatJid}`;
  if (runningQueries.get(flushKey)) {
    console.log('[messages] memory flush already running, skipping');
    return;
  }

  runningQueries.set(flushKey, true);
  try {
    const today = new Date().toISOString().split('T')[0];
    const flushPrompt = [
      '上下文压缩前记忆刷新。',
      '**优先检查全局记忆**：先 Read /workspace/global/CLAUDE.md，如果有「待记录」字段且你已获知对应信息（用户身份、偏好、常用项目等），用 Edit 工具立即填写。',
      '用户明确要求记住的内容，以及下次对话仍可能用到的信息，也写入全局记忆。',
      `然后使用 memory_append 将时效性记忆保存到 memory/${today}.md（今日进展、临时决策、待办等）。`,
      '如需确认上下文，可先用 memory_search/memory_get 查阅。',
      '如果没有值得保存的内容，回复一个字：OK。',
    ].join(' ');

    console.log('[messages] starting memory flush query');

    const stream = querySession({
      userId,
      workspace: chatJid,
      sessionId,
      prompt: flushPrompt,
      mcpServers,
      systemPrompt,
      isMemoryFlush: true,
    });

    // Consume the stream but don't broadcast to user
    for await (const _event of stream) {
      // Silently consume
    }

    console.log('[messages] memory flush completed');
  } catch (err) {
    console.error('[messages] memory flush error:', err);
  } finally {
    runningQueries.delete(flushKey);
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
