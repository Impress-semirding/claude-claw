import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { groupDb, sessionDb, messageDb, userDb, groupEnvDb } from '../db.js';
import { randomUUID } from 'crypto';
import { mkdir, rm } from 'fs/promises';
import { resolve } from 'path';
import { appConfig } from '../config.js';
import { getOrCreateSession } from '../services/claude-session.service.js';
import { broadcastGroupCreated } from '../services/ws.service.js';
import * as processRegistry from '../services/process-registry.js';

const groups = new Hono();

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

// GET /api/groups - 获取群组列表
groups.get('/', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };

  try {
    const allGroups = groupDb.findAll();
    const userGroups = allGroups.filter(
      (g) => g.ownerId === user.userId || (g.members || []).includes(user.userId)
    );

    const groupsMap: Record<string, any> = {};
    for (const group of userGroups) {
      groupsMap[group.id] = toGroupInfo(group, user.userId);
    }

    return c.json({ groups: groupsMap });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load groups' }, 500);
  }
});

// POST /api/groups - 创建群组
groups.post('/', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };

  try {
    const body = await c.req.json();
    const name = body.name;
    if (!name || typeof name !== 'string') {
      return c.json({ error: 'Name is required' }, 400);
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

    const groupInfo = toGroupInfo(group, user.userId);
    broadcastGroupCreated(groupId, folder, name, user.userId);

    return c.json({
      success: true,
      jid: group.id,
      group: groupInfo,
    }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create group' }, 500);
  }
});

// GET /api/groups/:jid - 获取群组详情
groups.get('/:jid', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };
  const jid = c.req.param('jid');

  try {
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    // 检查权限
    const members = group.members || [];
    if (group.ownerId !== user.userId && !members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    return c.json({ group: toGroupInfo(group, user.userId) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load group' }, 500);
  }
});

// PATCH /api/groups/:jid - 更新群组
groups.patch('/:jid', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };
  const jid = c.req.param('jid');

  try {
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    // 检查权限（只有 owner 可以修改）
    if (group.ownerId !== user.userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const body = await c.req.json();
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
    return c.json({ success: true, group: toGroupInfo(updated, user.userId) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update group' }, 500);
  }
});

// DELETE /api/groups/:jid - 删除群组
groups.delete('/:jid', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };
  const jid = c.req.param('jid');

  try {
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    // 检查权限
    if (group.ownerId !== user.userId && user.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // 删除关联的 sessions
    const allSessions = sessionDb.findAll();
    for (const session of allSessions) {
      const s = session as any;
      if (s.workspace === jid) {
        // 删除 session 的消息
        messageDb.deleteBySession(s.id);
        // 删除 session 目录
        try {
          await rm(s.workDir as string, { recursive: true, force: true });
        } catch {
          // ignore
        }
        sessionDb.delete(s.id);
      }
    }

    // 删除群组工作目录
    const workDir = resolve(appConfig.paths.sessions, group.folder || group.id);
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    groupDb.delete(jid);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete group' }, 500);
  }
});

// GET /api/groups/:jid/messages - 获取消息
groups.get('/:jid/messages', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };
  const jid = c.req.param('jid');

  try {
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    // 检查权限
    if (group.ownerId !== user.userId && !group.members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // 获取查询参数
    const before = c.req.query('before');
    const after = c.req.query('after');
    const limit = parseInt(c.req.query('limit') || '50', 10);

    // 找到该群组的所有 session（不限于当前用户，包含所有成员）
    const allSessions = sessionDb.findByUser('');
    const groupSessions = allSessions.filter((s: any) => s.workspace === jid);
    console.log('[groups/messages] jid=', jid, 'groupSessions=', groupSessions.length, 'after=', after, 'before=', before, 'limit=', limit);

    // 获取所有消息
    let allMessages: any[] = [];
    for (const session of groupSessions) {
      const s = session as any;
      const msgs = messageDb.findBySession(s.id, 5000);
      console.log('[groups/messages] session=', s.id, 'msgs=', msgs.length);
      allMessages = allMessages.concat(msgs.map((m) => ({ ...toMessage(m), chat_jid: jid })));
    }

    // 按时间排序
    allMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    console.log('[groups/messages] totalMessages=', allMessages.length);

    // 应用过滤
    if (after) {
      const beforeFilter = allMessages.length;
      allMessages = allMessages.filter((m) => new Date(m.timestamp) > new Date(after));
      console.log('[groups/messages] after filter: before=', beforeFilter, 'after=', allMessages.length);
    }
    if (before) {
      allMessages = allMessages.filter((m) => new Date(m.timestamp) < new Date(before));
    }

    // 限制数量
    const hasMore = allMessages.length > limit;
    const messages = allMessages.slice(-limit);
    console.log('[groups/messages] returning', messages.length, 'messages, hasMore=', hasMore);

    return c.json({ messages, hasMore });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load messages' }, 500);
  }
});

// DELETE /api/groups/:jid/messages/:id - 删除消息
groups.delete('/:jid/messages/:id', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };
  const jid = c.req.param('jid');

  try {
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    // 检查权限
    if (group.ownerId !== user.userId && !group.members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // TODO: 实现消息删除
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete message' }, 500);
  }
});

// GET /api/groups/:jid/members - 获取成员
groups.get('/:jid/members', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };
  const jid = c.req.param('jid');

  try {
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    // 检查权限
    if (group.ownerId !== user.userId && !group.members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
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

    return c.json({ members });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load members' }, 500);
  }
});

// GET /api/groups/:jid/members/search - 搜索可添加用户
groups.get('/:jid/members/search', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };
  const jid = c.req.param('jid');
  const q = c.req.query('q') || '';

  try {
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    if (group.ownerId !== user.userId) {
      return c.json({ error: 'Forbidden' }, 403);
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

    return c.json({ users: results });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to search users' }, 500);
  }
});

// POST /api/groups/:jid/members - 添加成员
groups.post('/:jid/members', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };
  const jid = c.req.param('jid');

  try {
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    // 检查权限（只有 owner 可以添加成员）
    if (group.ownerId !== user.userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const body = await c.req.json();
    const userIdToAdd = body.user_id;

    if (!userIdToAdd) {
      return c.json({ error: 'user_id is required' }, 400);
    }

    // 检查用户是否存在
    const userToAdd = userDb.findById(userIdToAdd);
    if (!userToAdd) {
      return c.json({ error: 'User not found' }, 404);
    }

    // 检查是否已经是成员
    if (group.members.includes(userIdToAdd) || group.ownerId === userIdToAdd) {
      return c.json({ error: 'User is already a member' }, 409);
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
        joined_at: new Date(updated.createdAt).toISOString(),
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
          joined_at: new Date(updated.createdAt).toISOString(),
        });
      }
    }

    return c.json({ members });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to add member' }, 500);
  }
});

// DELETE /api/groups/:jid/members/:id - 移除成员
groups.delete('/:jid/members/:id', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };
  const jid = c.req.param('jid');
  const memberId = c.req.param('id');

  try {
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    // 检查权限（只有 owner 可以移除成员，或者成员可以自己退出）
    if (group.ownerId !== user.userId && memberId !== user.userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // 不能移除 owner
    if (memberId === group.ownerId) {
      return c.json({ error: 'Cannot remove owner' }, 400);
    }

    // 移除成员
    const newMembers = group.members.filter((id) => id !== memberId);
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
        joined_at: new Date(updated.createdAt).toISOString(),
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
          joined_at: new Date(updated.createdAt).toISOString(),
        });
      }
    }

    return c.json({ members });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to remove member' }, 500);
  }
});

// GET /api/groups/:jid/env - 获取环境变量
groups.get('/:jid/env', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };
  const jid = c.req.param('jid');

  try {
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    if (group.ownerId !== user.userId && !group.members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const env = groupEnvDb.findById(jid) || {};
    const configEnv = group.config?.env || {};
    return c.json({ success: true, env: { ...configEnv, ...env } });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to get env' }, 500);
  }
});

// PUT /api/groups/:jid/env - 更新环境变量
groups.put('/:jid/env', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };
  const jid = c.req.param('jid');

  try {
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    if (group.ownerId !== user.userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const body = await c.req.json();
    const env = body.env || {};
    groupEnvDb.set(jid, env);

    return c.json({ success: true, env });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update env' }, 500);
  }
});

// POST /api/groups/:jid/stop - 停止群组
groups.post('/:jid/stop', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };
  const jid = c.req.param('jid');

  try {
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    // 检查权限
    if (group.ownerId !== user.userId && !group.members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Kill any active isolated processes for this group
    processRegistry.stopWorkspace(jid, true);

    // 更新所有相关 session 的状态
    const allSessions = sessionDb.findByUser('');
    for (const session of allSessions) {
      const s = session as any;
      if (s.workspace === jid) {
        sessionDb.update(s.id, { status: 'idle' });
      }
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to stop group' }, 500);
  }
});

// POST /api/groups/:jid/interrupt - 中断查询
groups.post('/:jid/interrupt', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };
  const jid = c.req.param('jid');

  try {
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    // 检查权限
    if (group.ownerId !== user.userId && !group.members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // 检查是否有活跃的 session
    const allSessions = sessionDb.findByUser('');
    const activeSessions = allSessions.filter((s: any) => s.workspace === jid && s.status === 'running');

    if (activeSessions.length === 0) {
      return c.json({ success: true, interrupted: false });
    }

    // Kill any active isolated processes for this group
    processRegistry.stopWorkspace(jid, true);

    // 更新 session 状态
    for (const session of activeSessions) {
      const s = session as any;
      sessionDb.update(s.id, { status: 'idle' });
    }

    return c.json({ success: true, interrupted: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to interrupt' }, 500);
  }
});

// POST /api/groups/:jid/reset-session - 重置会话
groups.post('/:jid/reset-session', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };
  const jid = c.req.param('jid');

  try {
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    // 检查权限
    if (group.ownerId !== user.userId && !group.members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // 删除该群组的所有消息
    const allSessions = sessionDb.findByUser('');
    for (const session of allSessions) {
      const s = session as any;
      if (s.workspace === jid) {
        messageDb.deleteBySession(s.id);
      }
    }

    // 添加分隔消息
    const dividerId = randomUUID();

    return c.json({ success: true, dividerMessageId: dividerId });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to reset session' }, 500);
  }
});

// POST /api/groups/:jid/clear-history - 清空历史
groups.post('/:jid/clear-history', authMiddleware, async (c) => {
  const user = c.get('user') as { userId: string; email: string; role: string };
  const jid = c.req.param('jid');

  try {
    const group = groupDb.findById(jid);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    // 检查权限
    if (group.ownerId !== user.userId && !group.members.includes(user.userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // 删除该群组的所有消息
    const allSessions = sessionDb.findByUser('');
    for (const session of allSessions) {
      const s = session as any;
      if (s.workspace === jid) {
        messageDb.deleteBySession(s.id);
      }
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to clear history' }, 500);
  }
});

export default groups;
