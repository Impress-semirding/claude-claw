import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from './auth.js';

const billing = new Hono();

// GET /api/billing/status - 获取计费状态
billing.get('/status', authMiddleware, async (c) => {
  try {
    // Claw 暂不支持计费，返回禁用状态
    return c.json({
      enabled: false,
      mode: 'wallet_first',
      minStartBalanceUsd: 0.01,
      currency: 'USD',
      currencyRate: 1,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load billing status' }, 500);
  }
});

// GET /api/billing/my/subscription - 获取我的订阅
billing.get('/my/subscription', authMiddleware, async (c) => {
  try {
    return c.json({
      subscription: null,
      plan: null,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load subscription' }, 500);
  }
});

// GET /api/billing/my/balance - 获取我的余额
billing.get('/my/balance', authMiddleware, async (c) => {
  try {
    const user = c.get('user') as { userId: string };
    return c.json({
      user_id: user.userId,
      balance_usd: 0,
      total_deposited_usd: 0,
      total_consumed_usd: 0,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load balance' }, 500);
  }
});

// GET /api/billing/my/access - 获取我的访问权限
billing.get('/my/access', authMiddleware, async (c) => {
  try {
    return c.json({
      allowed: true,
      balanceUsd: 0,
      minBalanceUsd: 0,
      planId: null,
      planName: null,
      subscriptionStatus: 'default',
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load access' }, 500);
  }
});

// GET /api/billing/my/usage - 获取我的使用情况
billing.get('/my/usage', authMiddleware, async (c) => {
  try {
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    return c.json({
      currentMonth: month,
      usage: {
        user_id: (c.get('user') as { userId: string }).userId,
        month,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cost_usd: 0,
        message_count: 0,
        updated_at: now.toISOString(),
      },
      plan: null,
      history: [],
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load usage' }, 500);
  }
});

// GET /api/billing/my/transactions - 获取我的交易记录
billing.get('/my/transactions', authMiddleware, async (c) => {
  try {
    return c.json({
      transactions: [],
      total: 0,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load transactions' }, 500);
  }
});

// GET /api/billing/my/quota - 获取我的配额
billing.get('/my/quota', authMiddleware, async (c) => {
  try {
    return c.json({
      allowed: true,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load quota' }, 500);
  }
});

// POST /api/billing/my/redeem - 兑换码
billing.post('/my/redeem', authMiddleware, async (c) => {
  try {
    return c.json({ message: 'Redeem codes are not supported in this version' });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to redeem code' }, 400);
  }
});

// GET /api/billing/plans - 获取所有套餐
billing.get('/plans', authMiddleware, async (c) => {
  try {
    return c.json({ plans: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load plans' }, 500);
  }
});

// PATCH /api/billing/my/auto-renew - 切换自动续费
billing.patch('/my/auto-renew', authMiddleware, async (c) => {
  try {
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update auto-renew' }, 400);
  }
});

// POST /api/billing/my/cancel-subscription - 取消订阅
billing.post('/my/cancel-subscription', authMiddleware, async (c) => {
  try {
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to cancel subscription' }, 400);
  }
});

// GET /api/billing/my/usage/daily - 获取每日使用情况
billing.get('/my/usage/daily', authMiddleware, async (c) => {
  try {
    return c.json({ history: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load daily usage' }, 500);
  }
});

// Admin routes

// GET /api/billing/admin/plans - 获取所有套餐（管理员）
billing.get('/admin/plans', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ plans: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load plans' }, 500);
  }
});

// POST /api/billing/admin/plans - 创建套餐
billing.post('/admin/plans', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create plan' }, 400);
  }
});

// PATCH /api/billing/admin/plans/:id - 更新套餐
billing.patch('/admin/plans/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update plan' }, 400);
  }
});

// DELETE /api/billing/admin/plans/:id - 删除套餐
billing.delete('/admin/plans/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete plan' }, 500);
  }
});

// GET /api/billing/admin/users - 获取所有用户的计费信息
billing.get('/admin/users', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ users: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load users' }, 500);
  }
});

// POST /api/billing/admin/users/:userId/assign-plan - 分配套餐
billing.post('/admin/users/:userId/assign-plan', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to assign plan' }, 400);
  }
});

// POST /api/billing/admin/users/:userId/adjust-balance - 调整余额
billing.post('/admin/users/:userId/adjust-balance', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to adjust balance' }, 400);
  }
});

// GET /api/billing/admin/redeem-codes - 获取兑换码
billing.get('/admin/redeem-codes', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ codes: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load redeem codes' }, 500);
  }
});

// POST /api/billing/admin/redeem-codes - 创建兑换码
billing.post('/admin/redeem-codes', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ codes: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create redeem codes' }, 400);
  }
});

// DELETE /api/billing/admin/redeem-codes/:code - 删除兑换码
billing.delete('/admin/redeem-codes/:code', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete redeem code' }, 500);
  }
});

// GET /api/billing/admin/redeem-codes/:code/usage - 获取兑换码使用记录
billing.get('/admin/redeem-codes/:code/usage', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ details: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load usage' }, 500);
  }
});

// GET /api/billing/admin/audit-log - 获取审计日志
billing.get('/admin/audit-log', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ logs: [], total: 0, limit: 50, offset: 0 });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load audit logs' }, 500);
  }
});

// GET /api/billing/admin/revenue - 获取收入统计
billing.get('/admin/revenue', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({
      totalDeposited: 0,
      totalConsumed: 0,
      activeSubscriptions: 0,
      currentMonthRevenue: 0,
      blockedUsers: 0,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load revenue' }, 500);
  }
});

// POST /api/billing/admin/users/:userId/cancel-subscription - 取消用户订阅
billing.post('/admin/users/:userId/cancel-subscription', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to cancel subscription' }, 400);
  }
});

// POST /api/billing/admin/users/batch-assign-plan - 批量分配套餐
billing.post('/admin/users/batch-assign-plan', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to batch assign plan' }, 400);
  }
});

// GET /api/billing/admin/dashboard - 获取仪表板数据
billing.get('/admin/dashboard', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({
      activeUsers: 0,
      totalUsers: 0,
      planDistribution: [],
      todayCost: 0,
      monthCost: 0,
      activeSubscriptions: 0,
      blockedUsers: 0,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load dashboard' }, 500);
  }
});

// GET /api/billing/admin/revenue/trend - 获取收入趋势
billing.get('/admin/revenue/trend', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ trend: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load revenue trend' }, 500);
  }
});

// GET /api/billing/admin/users/:userId/subscription-history - 获取用户订阅历史
billing.get('/admin/users/:userId/subscription-history', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ history: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load subscription history' }, 500);
  }
});

export default billing;
