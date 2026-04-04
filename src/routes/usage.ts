import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from './auth.js';
import { messageDb, billingDb } from '../db.js';

const usage = new Hono();

function generateEmptyDays(days: number) {
  const result = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    result.push({
      day: d.toISOString().slice(0, 10),
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUSD: 0,
      messages: 0,
    });
  }
  return result;
}

// GET /api/usage/stats - 获取使用统计
usage.get('/stats', authMiddleware, async (c) => {
  try {
    const query = c.req.query();
    const days = parseInt(query.days || '7', 10);
    const userId = query.userId || (c.get('user') as { userId: string }).userId;

    const startAt = Date.now() - days * 24 * 60 * 60 * 1000;
    const records = billingDb.findByUser(userId, 10000).filter((r) => r.createdAt >= startAt);
    const messages = messageDb.findBySession('', 10000).filter((m) => m.createdAt >= startAt && m.userId === userId);

    const dayMap = new Map<string, any>();
    for (const r of records) {
      const day = new Date(r.createdAt).toISOString().slice(0, 10);
      if (!dayMap.has(day)) {
        dayMap.set(day, { day, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUSD: 0, messages: 0 });
      }
      const entry = dayMap.get(day);
      entry.costUSD += r.cost || 0;
      if (r.type === 'input') entry.inputTokens += r.tokens || 0;
      if (r.type === 'output') entry.outputTokens += r.tokens || 0;
    }

    for (const m of messages) {
      const day = new Date(m.createdAt).toISOString().slice(0, 10);
      if (!dayMap.has(day)) {
        dayMap.set(day, { day, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUSD: 0, messages: 0 });
      }
      dayMap.get(day).messages += 1;
    }

    const emptyDays = generateEmptyDays(days);
    for (const d of emptyDays) {
      if (dayMap.has(d.day)) {
        const entry = dayMap.get(d.day);
        d.inputTokens = entry.inputTokens;
        d.outputTokens = entry.outputTokens;
        d.cacheReadTokens = entry.cacheReadTokens;
        d.cacheCreationTokens = entry.cacheCreationTokens;
        d.costUSD = entry.costUSD;
        d.messages = entry.messages;
      }
    }

    const summary = {
      totalInputTokens: emptyDays.reduce((s, d) => s + d.inputTokens, 0),
      totalOutputTokens: emptyDays.reduce((s, d) => s + d.outputTokens, 0),
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      totalCostUSD: emptyDays.reduce((s, d) => s + d.costUSD, 0),
      totalMessages: emptyDays.reduce((s, d) => s + d.messages, 0),
      totalActiveDays: emptyDays.filter((d) => d.messages > 0 || d.costUSD > 0).length,
    };

    return c.json({
      summary,
      breakdown: emptyDays,
      days,
      dataRange: null,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load usage stats' }, 500);
  }
});

// GET /api/usage/models - 获取可用模型列表
usage.get('/models', authMiddleware, async (c) => {
  try {
    return c.json({
      models: [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4.5', enabled: true },
        { id: 'claude-opus-4-20250514', name: 'Claude Opus 4.5', enabled: true },
        { id: 'claude-haiku-4-20251001', name: 'Claude Haiku 4.5', enabled: true },
      ],
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load models' }, 500);
  }
});

// GET /api/usage/users - 获取有使用数据的用户列表
usage.get('/users', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ users: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load users' }, 500);
  }
});

export default usage;
