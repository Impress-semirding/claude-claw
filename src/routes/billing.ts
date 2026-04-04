import type { FastifyInstance } from 'fastify';
import { authMiddleware, adminMiddleware } from './auth.js';

export default async function billingRoutes(fastify: FastifyInstance) {
  // GET /api/billing/status - 获取计费状态
  fastify.get('/status', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({
        enabled: false,
        mode: 'wallet_first',
        minStartBalanceUsd: 0.01,
        currency: 'USD',
        currencyRate: 1,
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load billing status' });
    }
  });

  // GET /api/billing/my/subscription - 获取我的订阅
  fastify.get('/my/subscription', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({
        subscription: null,
        plan: null,
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load subscription' });
    }
  });

  // GET /api/billing/my/balance - 获取我的余额
  fastify.get('/my/balance', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const user = request.user as { userId: string };
      return reply.send({
        user_id: user.userId,
        balance_usd: 0,
        total_deposited_usd: 0,
        total_consumed_usd: 0,
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load balance' });
    }
  });

  // GET /api/billing/my/access - 获取我的访问权限
  fastify.get('/my/access', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({
        allowed: true,
        balanceUsd: 0,
        minBalanceUsd: 0,
        planId: null,
        planName: null,
        subscriptionStatus: 'default',
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load access' });
    }
  });

  // GET /api/billing/my/usage - 获取我的使用情况
  fastify.get('/my/usage', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const now = new Date();
      const month = now.toISOString().slice(0, 7);
      return reply.send({
        currentMonth: month,
        usage: {
          user_id: (request.user as { userId: string }).userId,
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
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load usage' });
    }
  });

  // GET /api/billing/my/transactions - 获取我的交易记录
  fastify.get('/my/transactions', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({
        transactions: [],
        total: 0,
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load transactions' });
    }
  });

  // GET /api/billing/my/quota - 获取我的配额
  fastify.get('/my/quota', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({
        allowed: true,
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load quota' });
    }
  });

  // POST /api/billing/my/redeem - 兑换码
  fastify.post('/my/redeem', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({ message: 'Redeem codes are not supported in this version' });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to redeem code' });
    }
  });

  // GET /api/billing/plans - 获取所有套餐
  fastify.get('/plans', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({ plans: [] });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load plans' });
    }
  });

  // PATCH /api/billing/my/auto-renew - 切换自动续费
  fastify.patch('/my/auto-renew', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update auto-renew' });
    }
  });

  // POST /api/billing/my/cancel-subscription - 取消订阅
  fastify.post('/my/cancel-subscription', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to cancel subscription' });
    }
  });

  // GET /api/billing/my/usage/daily - 获取每日使用情况
  fastify.get('/my/usage/daily', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({ history: [] });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load daily usage' });
    }
  });

  // Admin routes

  // GET /api/billing/admin/plans - 获取所有套餐（管理员）
  fastify.get('/admin/plans', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ plans: [] });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load plans' });
    }
  });

  // POST /api/billing/admin/plans - 创建套餐
  fastify.post('/admin/plans', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create plan' });
    }
  });

  // PATCH /api/billing/admin/plans/:id - 更新套餐
  fastify.patch('/admin/plans/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update plan' });
    }
  });

  // DELETE /api/billing/admin/plans/:id - 删除套餐
  fastify.delete('/admin/plans/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to delete plan' });
    }
  });

  // GET /api/billing/admin/users - 获取所有用户的计费信息
  fastify.get('/admin/users', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ users: [] });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load users' });
    }
  });

  // POST /api/billing/admin/users/:userId/assign-plan - 分配套餐
  fastify.post('/admin/users/:userId/assign-plan', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to assign plan' });
    }
  });

  // POST /api/billing/admin/users/:userId/adjust-balance - 调整余额
  fastify.post('/admin/users/:userId/adjust-balance', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to adjust balance' });
    }
  });

  // GET /api/billing/admin/redeem-codes - 获取兑换码
  fastify.get('/admin/redeem-codes', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ codes: [] });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load redeem codes' });
    }
  });

  // POST /api/billing/admin/redeem-codes - 创建兑换码
  fastify.post('/admin/redeem-codes', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ codes: [] });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create redeem codes' });
    }
  });

  // DELETE /api/billing/admin/redeem-codes/:code - 删除兑换码
  fastify.delete('/admin/redeem-codes/:code', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to delete redeem code' });
    }
  });

  // GET /api/billing/admin/redeem-codes/:code/usage - 获取兑换码使用记录
  fastify.get('/admin/redeem-codes/:code/usage', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ details: [] });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load usage' });
    }
  });

  // GET /api/billing/admin/audit-log - 获取审计日志
  fastify.get('/admin/audit-log', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ logs: [], total: 0, limit: 50, offset: 0 });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load audit logs' });
    }
  });

  // GET /api/billing/admin/revenue - 获取收入统计
  fastify.get('/admin/revenue', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({
        totalDeposited: 0,
        totalConsumed: 0,
        activeSubscriptions: 0,
        currentMonthRevenue: 0,
        blockedUsers: 0,
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load revenue' });
    }
  });

  // POST /api/billing/admin/users/:userId/cancel-subscription - 取消用户订阅
  fastify.post('/admin/users/:userId/cancel-subscription', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to cancel subscription' });
    }
  });

  // POST /api/billing/admin/users/batch-assign-plan - 批量分配套餐
  fastify.post('/admin/users/batch-assign-plan', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to batch assign plan' });
    }
  });

  // GET /api/billing/admin/dashboard - 获取仪表板数据
  fastify.get('/admin/dashboard', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({
        activeUsers: 0,
        totalUsers: 0,
        planDistribution: [],
        todayCost: 0,
        monthCost: 0,
        activeSubscriptions: 0,
        blockedUsers: 0,
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load dashboard' });
    }
  });

  // GET /api/billing/admin/revenue/trend - 获取收入趋势
  fastify.get('/admin/revenue/trend', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ trend: [] });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load revenue trend' });
    }
  });

  // GET /api/billing/admin/users/:userId/subscription-history - 获取用户订阅历史
  fastify.get('/admin/users/:userId/subscription-history', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ history: [] });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load subscription history' });
    }
  });
}
