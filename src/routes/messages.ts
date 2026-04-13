import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth.js';
import { groupDb, messageDb, mcpServerDb } from '../db.js';
import { randomUUID } from 'crypto';
import { resolve } from 'path';
import { appConfig } from '../config.js';
import { logger } from '../logger.js';
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
const autoContinueCounts = new Map<string, number>();
const autoContinueLastEmpty = new Map<string, boolean>();
const pendingUserQueries = new Map<string, number>();

function incrementPendingQuery(sessionId: string): void {
  pendingUserQueries.set(sessionId, (pendingUserQueries.get(sessionId) || 0) + 1);
}

function decrementPendingQuery(sessionId: string): void {
  const next = (pendingUserQueries.get(sessionId) || 0) - 1;
  if (next <= 0) {
    pendingUserQueries.delete(sessionId);
    autoContinueCounts.delete(sessionId);
    autoContinueLastEmpty.delete(sessionId);
  } else {
    pendingUserQueries.set(sessionId, next);
  }
}

interface SendMessageResult {
  ok: true;
  messageId: string;
  timestamp: string;
}

function parseVirtualJid(chatJid: string): { groupJid: string; agentId?: string } {
  const match = chatJid.match(/^(.+)#agent:(.+)$/);
  if (match) {
    return { groupJid: match[1], agentId: match[2] };
  }
  return { groupJid: chatJid };
}

async function handleMessageSend(
  userId: string,
  displayName: string,
  chatJid: string,
  content: string,
  attachments?: unknown[],
  explicitAgentId?: string
): Promise<SendMessageResult | { ok: false; error: string; status: number }> {
  // Parse virtual JID: {groupJid}#agent:{agentId}
  const { groupJid, agentId: virtualAgentId } = parseVirtualJid(chatJid);
  const agentId = explicitAgentId || virtualAgentId;

  // Check group
  const group = groupDb.findById(groupJid);
  if (!group) {
    return { ok: false, error: 'Group not found', status: 404 };
  }

  const members = group.members || [];
  if (group.ownerId !== userId && !members.includes(userId)) {
    return { ok: false, error: 'Forbidden', status: 403 };
  }

  // Get or create session for this group (scoped by agentId), using actual groupJid as workspace
  const session = await getOrCreateSession(userId, groupJid, undefined, agentId);

  const messageId = randomUUID();
  const timestamp = new Date().toISOString();

  // Save user message
  saveUserMessage(userId, session.sessionId, content, attachments as any, messageId, {
    senderName: displayName,
    sourceKind: 'user_message',
    timestamp,
    agentId,
  });
  logger.info({ messageId, sessionId: session.sessionId, chatJid, agentId, groupJid }, '[messages] saved user message');

  // Broadcast new_message immediately (use original chatJid so virtual JID tabs receive it)
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
  logger.info(userMsgPayload, '[messages] broadcasting user new_message');
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
  const agent = resolveAgent(groupJid, agentId);
  const groupConfig = group.config || {};
  const workspaceDir = resolve(appConfig.claude.baseDir, group.folder || '');
  const userGlobalPath = resolve(appConfig.dataDir, 'groups', 'user-global', userId, 'CLAUDE.md');

  const env: AgentEnvironment = {
    userId,
    email: displayName,
    chatJid: groupJid,
    workspaceDir,
    userGlobalPath,
    groupConfig,
  };

  // Reset auto-continue counter for user-initiated messages
  autoContinueCounts.delete(session.sessionId);

  // Fire-and-forget the agent query (broadcast with original chatJid for virtual JID routing)
  incrementPendingQuery(session.sessionId);
  runAgentQuery(agent, env, session.sessionId, content, enabledMcpServers, chatJid, agentId, true);

  return { ok: true, messageId, timestamp };
}

export async function runAgentQuery(
  agent: ClaudeAgent,
  env: AgentEnvironment,
  sessionId: string,
  content: string,
  mcpServers: Record<string, unknown>,
  chatJid: string,
  agentId?: string,
  isUserQuery = false
): Promise<import('../services/agent.js').AgentQueryResult | undefined> {

  runningQueries.set(sessionId, true);
  broadcastRunnerState(chatJid, 'running', agentId);
  broadcastTyping(chatJid, true, agentId);

  let turnId = `turn-${Date.now()}`;
  let result: import('../services/agent.js').AgentQueryResult | undefined;

  const mcpNames = Object.keys(mcpServers);
  logger.info({
    userId: env.userId,
    chatJid,
    sessionId,
    agentId,
    promptLength: content.length,
    mcpCount: mcpNames.length,
    mcpNames,
  }, '[messages] runAgentQuery');

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
      logger.error({ error: result.error }, '[messages] agent query error');
      const errorMsgId = randomUUID();
      const errorTimestamp = new Date().toISOString();
      const errorContent = `⚠️ ${result.error}`;
      messageDb.create({
        id: errorMsgId,
        sessionId,
        userId: '__assistant__',
        role: 'assistant',
        content: errorContent,
        metadata: {
          senderName: 'Claude',
          turnId,
          timestamp: errorTimestamp,
          sourceKind: 'agent_error',
          finalizationReason: 'error',
          agentId,
        },
      });
      broadcastNewMessage(chatJid, {
        id: errorMsgId,
        chat_jid: chatJid,
        sender: '__assistant__',
        sender_name: 'Claude',
        content: errorContent,
        timestamp: errorTimestamp,
        is_from_me: true,
        turn_id: turnId,
        session_id: sessionId,
        sdk_message_uuid: null,
        source_kind: 'agent_error',
        finalization_reason: 'error',
      }, agentId);
    }

    // Handle overflow partial recovery
    if (result.contextOverflow && result.assistantText) {
      logger.info({ length: result.assistantText.trim().length }, '[messages] saving overflow_partial');
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
      logger.info('[messages] unrecoverable error, not saving assistant message');
      return;
    }

    if (result.assistantText.trim()) {
      logger.info({ length: result.assistantText.trim().length }, '[messages] saving assistant message');
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

      logger.info({ chatJid, agentId, msgId: assistantMsgId }, '[messages] broadcasting new_message for assistant reply');
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
      logger.info('[messages] broadcast complete');
    } else {
      logger.info('[messages] no assistant text to save, text length=0');
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ error: errorMsg }, '[messages] runAgentQuery error');
    broadcastStreamEvent(chatJid, {
      eventType: 'error',
      error: errorMsg,
      turnId,
    }, agentId);

    // Persist error message so the user sees what happened
    const errorMsgId = randomUUID();
    const errorTimestamp = new Date().toISOString();
    const errorContent = `⚠️ ${errorMsg}`;
    messageDb.create({
      id: errorMsgId,
      sessionId,
      userId: '__assistant__',
      role: 'assistant',
      content: errorContent,
      metadata: {
        senderName: 'Claude',
        turnId,
        timestamp: errorTimestamp,
        sourceKind: 'agent_error',
        finalizationReason: 'error',
        agentId,
      },
    });
    broadcastNewMessage(chatJid, {
      id: errorMsgId,
      chat_jid: chatJid,
      sender: '__assistant__',
      sender_name: 'Claude',
      content: errorContent,
      timestamp: errorTimestamp,
      is_from_me: true,
      turn_id: turnId,
      session_id: sessionId,
      sdk_message_uuid: null,
      source_kind: 'agent_error',
      finalization_reason: 'error',
    }, agentId);
  } finally {
    runningQueries.delete(sessionId);
    broadcastRunnerState(chatJid, 'idle', agentId);
    broadcastTyping(chatJid, false, agentId);

    if (isUserQuery) {
      decrementPendingQuery(sessionId);
    }

    if (result?.hadCompaction) {
      // Fire-and-forget so new user messages can acquire the session lock first
      Promise.resolve().then(async () => {
        if (pendingUserQueries.has(sessionId)) {
          logger.info({ sessionId }, '[messages] skipping auto-continue because pending user queries exist');
          return;
        }
        try {
          const systemPrompt = await agent.buildSystemPrompt(env);
          await runMemoryFlush(env.userId, chatJid, sessionId, mcpServers, systemPrompt);
          if (pendingUserQueries.has(sessionId)) {
            logger.info({ sessionId }, '[messages] skipping auto-continue because user queries arrived during memory flush');
            return;
          }
          await maybeAutoContinue(agent, env, sessionId, mcpServers, chatJid, agentId);
        } catch (err) {
          logger.error({ err }, '[messages] auto-continue chain error');
        }
      });
    }
  }
  return result;
}

async function maybeAutoContinue(
  agent: ClaudeAgent,
  env: AgentEnvironment,
  sessionId: string,
  mcpServers: Record<string, unknown>,
  chatJid: string,
  agentId?: string
): Promise<void> {
  if (pendingUserQueries.has(sessionId)) {
    logger.info({ sessionId }, '[messages] canceling auto-continue because a user query arrived');
    autoContinueCounts.delete(sessionId);
    autoContinueLastEmpty.delete(sessionId);
    return;
  }
  const count = autoContinueCounts.get(sessionId) || 0;
  if (count >= 3) {
    logger.info({ sessionId }, '[messages] auto-continue limit reached');
    autoContinueCounts.delete(sessionId);
    autoContinueLastEmpty.delete(sessionId);
    return;
  }
  if (autoContinueLastEmpty.get(sessionId)) {
    logger.info({ sessionId }, '[messages] last auto-continue produced no text, stopping chain');
    autoContinueCounts.delete(sessionId);
    autoContinueLastEmpty.delete(sessionId);
    return;
  }
  autoContinueCounts.set(sessionId, count + 1);
  logger.info({ sessionId, count: count + 1 }, '[messages] auto-continue triggered');

  broadcastStreamEvent(chatJid, {
    eventType: 'status',
    statusText: '上下文已压缩，Agent 正在自动继续…',
    turnId: `turn-${Date.now()}`,
  }, agentId);
  broadcastTyping(chatJid, true, agentId);

  const result = await runAgentQuery(agent, env, sessionId, '继续', mcpServers, chatJid, agentId);
  if (!result?.assistantText.trim()) {
    autoContinueLastEmpty.set(sessionId, true);
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
  const flushKey = `flush:${sessionId}`;
  if (runningQueries.get(flushKey)) {
    logger.info('[messages] memory flush already running, skipping');
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

    logger.info('[messages] starting memory flush query');

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

    logger.info('[messages] memory flush completed');
  } catch (err) {
    logger.error({ err }, '[messages] memory flush error');
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
