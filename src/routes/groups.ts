import type { FastifyInstance } from 'fastify';
import { authMiddleware, groupAccessMiddleware, groupOwnerMiddleware } from './auth.js';
import { groupDb, sessionDb, messageDb, userDb, groupEnvDb } from '../db.js';
import { randomUUID } from 'crypto';
import { mkdir, rm } from 'fs/promises';
import { resolve, join } from 'path';
import { appConfig } from '../config.js';
import { getOrCreateSession, destroySession, abortQuery } from '../services/claude-session.service.js';
import { broadcastGroupCreated } from '../services/ws.service.js';
import {
  stopWorkspace,
  waitForWorkspaceExit,
} from '../services/process-registry.js';
import { ensurePredefinedAgents } from '../services/agent-presets.js';
import { validateAndResolvePath, isSystemPath } from './files.js';

// Helper: 转换 Group 为前端格式
function toGroupInfo(group: any, userId: string): any {
  const isOwner = group.ownerId === userId;
  const members = group.members || [];
  const isMember = members.includes(userId);

  // 安全地处理时间戳
  let createdAt: string;
  try {
    const ts = group.createdAt || group.created_at || Date.now();
    createdAt = new Date(typeof ts === 'number' ? ts : Date.parse(ts)).toISOString();
  } catch {
    createdAt = new Date().toISOString();
  }

  const pinnedAt = group.pinnedAt
    ? new Date(group.pinnedAt).toISOString()
    : null;

  return {
    jid: group.id,
    name: group.name,
    folder: group.folder || group.id,
    description: group.description || '',
    is_my_home: group.isHome || false,
    pinned_at: pinnedAt,
    member_count: members.length + 1, // +1 for owner
    is_owner: isOwner,
    is_member: isMember,
    role: isOwner ? 'owner' : isMember ? 'member' : 'none',
    created_at: createdAt,
    execution_mode: group.executionMode || 'host',
    custom_cwd: null,
    linked_im_groups: [],
    mcp_mode: group.config?.mcpMode || 'default',
  };
}

// Helper: 安全地转换时间戳为 ISO 字符串
function toISOString(ts: any): string {
  try {
    if (typeof ts === 'number') {
      return new Date(ts).toISOString();
    }
    if (typeof ts === 'string') {
      return new Date(ts).toISOString();
    }
    return new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

// Helper: 转换 Message 为前端格式
function toMessage(msg: any): any {
  return {
    id: msg.id,
    chat_jid: msg.sessionId,
    sender: msg.userId,
    sender_name: msg.metadata?.senderName || msg.userId,
    content: msg.content,
    timestamp: toISOString(msg.createdAt),
    is_from_me: msg.role === 'assistant',
    attachments: msg.attachments ? JSON.stringify(msg.attachments) : undefined,
    token_usage: msg.metadata?.tokenUsage ? JSON.stringify(msg.metadata.tokenUsage) : undefined,
    turn_id: msg.metadata?.turnId || null,
    session_id: msg.metadata?.sdkSessionId || null,
    sdk_message_uuid: msg.metadata?.sdkMessageUuid || null,
    source_kind: msg.metadata?.sourceKind || null,
    finalization_reason: msg.metadata?.finalizationReason || null,
  };
}

export default async function groupsRoutes(fastify: FastifyInstance) {
  // GET /api/groups - 获取群组列表
  fastify.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    const user = request.user as { userId: string; email: string; role: string };

    try {
      const allGroups = groupDb.findAll();
      const userGroups = allGroups.filter(
        (g) => g.ownerId === user.userId || (g.members || []).includes(user.userId)
      );

      const groupsMap: Record<string, any> = {};
      for (const group of userGroups) {
        groupsMap[group.id] = toGroupInfo(group, user.userId);
      }

      return reply.send({ groups: groupsMap });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load groups' });
    }
  });

  // POST /api/groups - 创建群组
  fastify.post('/', { preHandler: authMiddleware }, async (request, reply) => {
    const user = request.user as { userId: string; email: string; role: string };

    try {
      const body = request.body as any;
      const name = body.name;
      if (!name || typeof name !== 'string') {
        return reply.status(400).send({ error: 'Name is required' });
      }

      const groupId = randomUUID();
      const folder = `group-${groupId.slice(0, 8)}`;
      const workDir = resolve(appConfig.paths.sessions, folder);

      // 创建工作目录
      await mkdir(workDir, { recursive: true });

      const group = groupDb.create({
        id: groupId,
        name,
        description: body.description || '',
        ownerId: user.userId,
        members: [],
        config: body.config || {},
        folder,
        isHome: false,
        pinnedAt: null,
        executionMode: body.execution_mode || 'host',
      });

      // 自动创建 session
      await getOrCreateSession(user.userId, groupId);

      // 自动创建预定义 Sub-Agent
      ensurePredefinedAgents(groupId);

      const groupInfo = toGroupInfo(group, user.userId);
      broadcastGroupCreated(groupId, folder, name, user.userId);

      return reply.status(201).send({
        success: true,
        jid: group.id,
        group: groupInfo,
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to create group' });
    }
  });

  // GET /api/groups/:jid - 获取群组详情
  fastify.get('/:jid', { preHandler: [authMiddleware, groupAccessMiddleware] }, async (request, reply) => {
    const user = request.user as { userId: string; email: string; role: string };
    const jid = (request.params as any).jid as string;

    try {
      const virtualMatch = jid.match(/^(.+)#agent:(.+)$/);
      const groupJid = virtualMatch ? virtualMatch[1] : jid;
      const group = groupDb.findById(groupJid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      return reply.send({ group: toGroupInfo(group, user.userId) });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load group' });
    }
  });

  // PATCH /api/groups/:jid - 更新群组
  fastify.patch('/:jid', { preHandler: [authMiddleware, groupOwnerMiddleware] }, async (request, reply) => {
    const user = request.user as { userId: string; email: string; role: string };
    const jid = (request.params as any).jid as string;

    try {
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const body = request.body as any;
      const updates: any = {};

      if (body.name !== undefined) {
        updates.name = body.name;
      }

      if (body.description !== undefined) {
        updates.description = body.description;
      }

      if (body.pinned_at !== undefined) {
        updates.pinnedAt = body.pinned_at ? Date.parse(body.pinned_at) || null : null;
      }

      if (body.execution_mode !== undefined) {
        updates.executionMode = body.execution_mode;
      }

      if (body.config !== undefined) {
        updates.config = { ...group.config, ...body.config };
      }

      if (Object.keys(updates).length > 0) {
        groupDb.update(jid, updates);
      }

      const updated = groupDb.findById(jid)!;
      return reply.send({ success: true, group: toGroupInfo(updated, user.userId) });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update group' });
    }
  });

  // DELETE /api/groups/:jid - 删除群组
  fastify.delete('/:jid', { preHandler: [authMiddleware, groupOwnerMiddleware] }, async (request, reply) => {
    const jid = (request.params as any).jid as string;

    try {
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      // 先停止该 workspace 下所有正在运行的隔离进程，并等待它们真正退出
      stopWorkspace(jid, true);
      await waitForWorkspaceExit(jid, 3000);

      // 删除关联的 sessions
      const allSessions = sessionDb.findAll();
      const parentDirsToClean = new Set<string>();
      for (const session of allSessions) {
        const s = session as any;
        if (s.workspace === jid) {
          // 如果有正在运行的查询，先中断
          abortQuery(s.userId, s.workspace, s.id);
          // 删除 session 的消息
          messageDb.deleteBySession(s.id);
          // 删除 session 私有目录（configDir / tmpDir），workDir 是共享的，稍后统一删
          if (s.configDir) {
            try {
              await rm(resolve(appConfig.claude.baseDir, s.configDir as string), { recursive: true, force: true });
            } catch {
              // ignore
            }
          }
          if (s.tmpDir) {
            try {
              await rm(resolve(appConfig.claude.baseDir, s.tmpDir as string), { recursive: true, force: true });
            } catch {
              // ignore
            }
          }
          parentDirsToClean.add(resolve(appConfig.claude.baseDir, s.userId, jid));
          sessionDb.delete(s.id);
        }
      }

      // 清理空的 parent 目录（data/sessions/{userId}/{groupId}）
      for (const parentDir of parentDirsToClean) {
        try {
          await rm(parentDir, { recursive: true, force: true });
        } catch {
          // ignore if not empty or already gone
        }
      }

      // 删除群组共享工作目录（data/sessions/group-xxxx）
      const groupWorkDir = resolve(appConfig.claude.baseDir, group.folder || group.id);
      try {
        await rm(groupWorkDir, { recursive: true, force: true });
      } catch {
        // ignore
      }

      groupDb.delete(jid);
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to delete group' });
    }
  });

  // GET /api/groups/:jid/messages - 获取消息
  fastify.get('/:jid/messages', { preHandler: [authMiddleware, groupAccessMiddleware] }, async (request, reply) => {
    const jid = (request.params as any).jid as string;

    try {
      // Parse virtual JID: {groupJid}#agent:{agentId}
      const virtualMatch = jid.match(/^(.+)#agent:(.+)$/);
      const groupJid = virtualMatch ? virtualMatch[1] : jid;
      const virtualAgentId = virtualMatch ? virtualMatch[2] : undefined;

      const group = groupDb.findById(groupJid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const before = (request.query as any).before as string | undefined;
      const after = (request.query as any).after as string | undefined;
      const limit = parseInt((request.query as any).limit || '50', 10);
      const queryAgentId = (request.query as any).agentId as string | undefined;
      const agentId = virtualAgentId || queryAgentId;

      // 找到该群组的 session（按 agentId 过滤）
      const allSessions = sessionDb.findByUser('');
      const groupSessions = allSessions.filter((s: any) => {
        if (s.workspace !== groupJid) return false;
        if (agentId) return s.agent_id === agentId || s.agentId === agentId;
        return !s.agent_id && !s.agentId;
      });
      // 获取所有消息
      let allMessages: any[] = [];
      for (const session of groupSessions) {
        const s = session as any;
        const msgs = messageDb.findBySession(s.id, 5000);
        allMessages = allMessages.concat(msgs.map((m) => ({ ...toMessage(m), chat_jid: jid })));
      }

      // 按时间排序
      allMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      // 应用过滤（防御式处理：统一转为数字毫秒比较，避免 Invalid Date）
      const afterTs = after ? new Date(after).getTime() : null;
      const beforeTs = before ? new Date(before).getTime() : null;
      if (afterTs && !Number.isNaN(afterTs)) {
        allMessages = allMessages.filter((m) => new Date(m.timestamp).getTime() > afterTs);
      }
      if (beforeTs && !Number.isNaN(beforeTs)) {
        allMessages = allMessages.filter((m) => new Date(m.timestamp).getTime() < beforeTs);
      }

      // 当 after 过滤后没有新消息时，返回空列表以符合增量轮询语义
      // 这不是 bug——前端用最新消息时间戳作为 after，正常情况就是 0 条
      // 限制数量
      const hasMore = allMessages.length > limit;
      const messages = allMessages.slice(-limit);

      return reply.send({ messages, hasMore });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load messages' });
    }
  });

  // POST /api/groups/:jid/directories - 创建目录
  fastify.post('/:jid/directories', { preHandler: [authMiddleware, groupAccessMiddleware] }, async (request, reply) => {
    const jid = (request.params as any).jid as string;

    try {
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const body = request.body as any;
      const parentPath = body.path || '';
      const dirName = body.name;

      if (!dirName || typeof dirName !== 'string') {
        return reply.status(400).send({ error: 'Directory name is required' });
      }

      const folder = group.folder || jid;
      const targetPath = validateAndResolvePath(folder, join(parentPath, dirName));
      if (isSystemPath(join(parentPath, dirName))) {
        return reply.status(403).send({ error: 'Cannot create directory in system path' });
      }

      await mkdir(targetPath, { recursive: true });
      return reply.send({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create directory';
      const isSafe = ['Path traversal detected', 'Symlink traversal detected'].includes(msg);
      return reply.status(isSafe ? 400 : 500).send({ error: msg });
    }
  });

  // DELETE /api/groups/:jid/messages/:id - 删除消息
  fastify.delete('/:jid/messages/:id', { preHandler: [authMiddleware, groupAccessMiddleware] }, async (request, reply) => {
    const jid = (request.params as any).jid as string;

    try {
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      // TODO: 实现消息删除
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to delete message' });
    }
  });

  // GET /api/groups/:jid/members - 获取成员
  fastify.get('/:jid/members', { preHandler: [authMiddleware, groupAccessMiddleware] }, async (request, reply) => {
    const jid = (request.params as any).jid as string;

    try {
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      // 构建成员列表
      const members: any[] = [];
      const joinedAt = toISOString(group.createdAt);

      // 添加 owner
      const owner = userDb.findById(group.ownerId);
      if (owner) {
        members.push({
          user_id: owner.id,
          username: owner.email,
          display_name: owner.name,
          role: 'owner',
          joined_at: joinedAt,
        });
      }

      // 添加 members
      for (const memberId of group.members) {
        const member = userDb.findById(memberId);
        if (member) {
          members.push({
            user_id: member.id,
            username: member.email,
            display_name: member.name,
            role: 'member',
            joined_at: joinedAt,
          });
        }
      }

      return reply.send({ members });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load members' });
    }
  });

  // GET /api/groups/:jid/members/search - 搜索可添加用户
  fastify.get('/:jid/members/search', { preHandler: [authMiddleware, groupOwnerMiddleware] }, async (request, reply) => {
    const jid = (request.params as any).jid as string;
    const q = ((request.query as any).q as string) || '';

    try {
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const allUsers = userDb.findActive();
      const existingIds = new Set([group.ownerId, ...group.members]);

      const results = allUsers
        .filter((u) => !existingIds.has(u.id))
        .filter((u) => {
          if (!q) return true;
          const searchText = `${u.email} ${u.name || ''}`.toLowerCase();
          return q.toLowerCase().split(/\s+/).every((term) => searchText.includes(term));
        })
        .map((u) => ({
          user_id: u.id,
          username: u.email,
          display_name: u.name,
        }));

      return reply.send({ users: results });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to search users' });
    }
  });

  // POST /api/groups/:jid/members - 添加成员
  fastify.post('/:jid/members', { preHandler: [authMiddleware, groupOwnerMiddleware] }, async (request, reply) => {
    const jid = (request.params as any).jid as string;

    try {
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const body = request.body as any;
      const userIdToAdd = body.user_id;

      if (!userIdToAdd) {
        return reply.status(400).send({ error: 'user_id is required' });
      }

      // 检查用户是否存在
      const userToAdd = userDb.findById(userIdToAdd);
      if (!userToAdd) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // 检查是否已经是成员
      if (group.members.includes(userIdToAdd) || group.ownerId === userIdToAdd) {
        return reply.status(409).send({ error: 'User is already a member' });
      }

      // 添加成员
      const newMembers = [...group.members, userIdToAdd];
      groupDb.update(jid, { members: newMembers });

      // 返回更新后的成员列表
      const updated = groupDb.findById(jid)!;
      const members: any[] = [];
      const owner = userDb.findById(updated.ownerId);
      if (owner) {
        members.push({
          user_id: owner.id,
          username: owner.email,
          display_name: owner.name,
          role: 'owner',
          joined_at: toISOString(updated.createdAt ?? (updated as any).created_at),
        });
      }
      for (const memberId of updated.members) {
        const member = userDb.findById(memberId);
        if (member) {
          members.push({
            user_id: member.id,
            username: member.email,
            display_name: member.name,
            role: 'member',
            joined_at: toISOString(updated.createdAt ?? (updated as any).created_at),
          });
        }
      }

      return reply.send({ members });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to add member' });
    }
  });

  // DELETE /api/groups/:jid/members/:id - 移除成员
  fastify.delete('/:jid/members/:id', { preHandler: [authMiddleware, groupAccessMiddleware] }, async (request, reply) => {
    const user = request.user as { userId: string; email: string; role: string };
    const jid = (request.params as any).jid as string;
    const memberId = (request.params as any).id as string;

    try {
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      // 检查权限（只有 owner 可以移除成员，或者成员可以自己退出）
      if (group.ownerId !== user.userId && memberId !== user.userId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      // 不能移除 owner
      if (memberId === group.ownerId) {
        return reply.status(400).send({ error: 'Cannot remove owner' });
      }

      // 移除成员
      const newMembers = group.members.filter((id: string) => id !== memberId);
      groupDb.update(jid, { members: newMembers });

      // 返回更新后的成员列表
      const updated = groupDb.findById(jid)!;
      const members: any[] = [];
      const owner = userDb.findById(updated.ownerId);
      if (owner) {
        members.push({
          user_id: owner.id,
          username: owner.email,
          display_name: owner.name,
          role: 'owner',
          joined_at: toISOString(updated.createdAt ?? (updated as any).created_at),
        });
      }
      for (const mId of updated.members) {
        const member = userDb.findById(mId);
        if (member) {
          members.push({
            user_id: member.id,
            username: member.email,
            display_name: member.name,
            role: 'member',
            joined_at: toISOString(updated.createdAt ?? (updated as any).created_at),
          });
        }
      }

      return reply.send({ members });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to remove member' });
    }
  });

  // GET /api/groups/:jid/env - 获取环境变量
  fastify.get('/:jid/env', { preHandler: [authMiddleware, groupAccessMiddleware] }, async (request, reply) => {
    const jid = (request.params as any).jid as string;

    try {
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const env = groupEnvDb.findById(jid) || {};
      const configEnv = group.config?.env || {};
      return reply.send({ success: true, env: { ...configEnv, ...env } });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to get env' });
    }
  });

  // PUT /api/groups/:jid/env - 更新环境变量
  fastify.put('/:jid/env', { preHandler: [authMiddleware, groupOwnerMiddleware] }, async (request, reply) => {
    const jid = (request.params as any).jid as string;

    try {
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const body = request.body as any;
      const env = body.env || {};
      groupEnvDb.set(jid, env);

      return reply.send({ success: true, env });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update env' });
    }
  });

  // POST /api/groups/:jid/stop - 停止群组
  fastify.post('/:jid/stop', { preHandler: [authMiddleware, groupAccessMiddleware] }, async (request, reply) => {
    const jid = (request.params as any).jid as string;

    try {
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      // Kill any active isolated processes for this group
      stopWorkspace(jid, true);

      // 更新所有相关 session 的状态
      const allSessions = sessionDb.findByUser('');
      for (const session of allSessions) {
        const s = session as any;
        if (s.workspace === jid) {
          sessionDb.update(s.id, { status: 'idle' });
        }
      }

      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to stop group' });
    }
  });

  // POST /api/groups/:jid/interrupt - 中断查询
  fastify.post('/:jid/interrupt', { preHandler: [authMiddleware, groupAccessMiddleware] }, async (request, reply) => {
    const jid = (request.params as any).jid as string;

    try {
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      // 检查是否有活跃的 session
      const allSessions = sessionDb.findByUser('');
      const activeSessions = allSessions.filter((s: any) => s.workspace === jid && s.status === 'running');

      if (activeSessions.length === 0) {
        return reply.send({ success: true, interrupted: false });
      }

      // Kill any active isolated processes for this group
      stopWorkspace(jid, true);

      // Graceful interrupt via sentinel for persistent runners
      for (const session of activeSessions) {
        const s = session as any;
        abortQuery(s.user_id, jid, s.id);
      }

      return reply.send({ success: true, interrupted: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to interrupt' });
    }
  });

  // POST /api/groups/:jid/reset-session - 重置会话
  fastify.post('/:jid/reset-session', { preHandler: [authMiddleware, groupAccessMiddleware] }, async (request, reply) => {
    const jid = (request.params as any).jid as string;

    try {
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      // 先停止该 workspace 下所有正在运行的隔离进程和中断查询
      stopWorkspace(jid, true);
      const allSessions = sessionDb.findByUser('');
      for (const session of allSessions) {
        const s = session as any;
        if (s.workspace === jid) {
          abortQuery(s.userId, s.workspace, s.id);
          messageDb.deleteBySession(s.id);
          sessionDb.update(s.id, { status: 'destroyed', sdk_session_id: null });
          // 从内存注册表移除，确保下次 getOrCreateSession 新建 session
          destroySession(s.userId as string, s.workspace as string, s.id as string);
        }
      }

      // 添加分隔消息
      const dividerId = randomUUID();

      return reply.send({ success: true, dividerMessageId: dividerId });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to reset session' });
    }
  });

  // POST /api/groups/:jid/clear-history - 清空历史
  fastify.post('/:jid/clear-history', { preHandler: [authMiddleware, groupAccessMiddleware] }, async (request, reply) => {
    const jid = (request.params as any).jid as string;

    try {
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      // 删除该群组的所有消息
      const allSessions = sessionDb.findByUser('');
      for (const session of allSessions) {
        const s = session as any;
        if (s.workspace === jid) {
          messageDb.deleteBySession(s.id);
        }
      }

      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to clear history' });
    }
  });
}
