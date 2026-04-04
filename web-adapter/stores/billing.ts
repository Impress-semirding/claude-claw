/**
 * HappyClaw Web 前端适配器 - Billing Store
 */

import { create } from 'zustand';
import { api } from '../api/client.js';

export interface BillingStatus {
  enabled: boolean;
  mode: string;
  minStartBalanceUsd: number;
  currency: string;
  currencyRate: number;
}

export interface Balance {
  user_id: string;
  balance_usd: number;
  total_deposited_usd: number;
  total_consumed_usd: number;
  updated_at: string;
}

export interface AccessInfo {
  allowed: boolean;
  balanceUsd: number;
  minBalanceUsd: number;
  planId: string | null;
  planName: string | null;
  subscriptionStatus: string;
}

export interface DailyUsage {
  day: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  messages: number;
}

export interface BillingPlan {
  id: string;
  name: string;
  priceUsd: number;
}

export interface RedeemCode {
  code: string;
  balanceUsd: number;
}

export interface Transaction {
  id: string;
  type: string;
  amountUsd: number;
  createdAt: string;
}

export interface AdminDashboard {
  activeUsers: number;
  totalUsers: number;
  planDistribution: any[];
  todayCost: number;
  monthCost: number;
  activeSubscriptions: number;
  blockedUsers: number;
}

export interface RevenueStats {
  totalDeposited: number;
  totalConsumed: number;
  activeSubscriptions: number;
  currentMonthRevenue: number;
  blockedUsers: number;
}

interface BillingState {
  status: BillingStatus | null;
  balance: Balance | null;
  access: AccessInfo | null;
  dailyUsage: DailyUsage[];
  plans: BillingPlan[];
  transactions: Transaction[];
  adminDashboard: AdminDashboard | null;
  revenue: RevenueStats | null;
  loading: boolean;
  error: string | null;
  loadStatus: () => Promise<void>;
  loadBalance: () => Promise<void>;
  loadAccess: () => Promise<void>;
  loadDailyUsage: () => Promise<void>;
  loadPlans: () => Promise<void>;
  loadTransactions: () => Promise<void>;
  redeemCode: (code: string) => Promise<boolean>;
  toggleAutoRenew: () => Promise<boolean>;
  cancelSubscription: () => Promise<boolean>;
  // Admin
  loadAdminDashboard: () => Promise<void>;
  loadRevenue: () => Promise<void>;
  createPlan: (plan: Partial<BillingPlan>) => Promise<boolean>;
  updatePlan: (id: string, plan: Partial<BillingPlan>) => Promise<boolean>;
  deletePlan: (id: string) => Promise<boolean>;
  assignPlan: (userId: string, planId: string) => Promise<boolean>;
  adjustBalance: (userId: string, amountUsd: number) => Promise<boolean>;
  getRedeemCodes: () => Promise<{ codes: RedeemCode[] }>;
  createRedeemCodes: (codes: Partial<RedeemCode>[]) => Promise<boolean>;
  deleteRedeemCode: (code: string) => Promise<boolean>;
  getRedeemCodeUsage: (code: string) => Promise<any[]>;
  getAuditLog: (limit?: number, offset?: number) => Promise<{ logs: any[]; total: number }>;
  getRevenueTrend: () => Promise<any[]>;
  getSubscriptionHistory: (userId: string) => Promise<any[]>;
  batchAssignPlan: (userIds: string[], planId: string) => Promise<boolean>;
  cancelUserSubscription: (userId: string) => Promise<boolean>;
}

export const useBillingStore = create<BillingState>((set, get) => ({
  status: null,
  balance: null,
  access: null,
  dailyUsage: [],
  plans: [],
  transactions: [],
  adminDashboard: null,
  revenue: null,
  loading: false,
  error: null,

  loadStatus: async () => {
    try {
      const data = await api.get<BillingStatus>('/api/billing/status');
      set({ status: data });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  loadBalance: async () => {
    try {
      const data = await api.get<{ balance: Balance }>('/api/billing/my/balance');
      set({ balance: data.balance });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  loadAccess: async () => {
    try {
      const data = await api.get<AccessInfo>('/api/billing/my/access');
      set({ access: data });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  loadDailyUsage: async () => {
    try {
      const data = await api.get<{ history: DailyUsage[] }>('/api/billing/my/usage/daily');
      set({ dailyUsage: data.history });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  loadPlans: async () => {
    try {
      const data = await api.get<{ plans: BillingPlan[] }>('/api/billing/plans');
      set({ plans: data.plans });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  loadTransactions: async () => {
    try {
      const data = await api.get<{ transactions: Transaction[]; total: number }>('/api/billing/my/transactions');
      set({ transactions: data.transactions });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  redeemCode: async (code) => {
    try {
      await api.post('/api/billing/my/redeem', { code });
      await get().loadBalance();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  toggleAutoRenew: async () => {
    try {
      await api.patch('/api/billing/my/auto-renew', {});
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  cancelSubscription: async () => {
    try {
      await api.post('/api/billing/my/cancel-subscription', {});
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  loadAdminDashboard: async () => {
    try {
      const data = await api.get<AdminDashboard>('/api/billing/admin/dashboard');
      set({ adminDashboard: data });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  loadRevenue: async () => {
    try {
      const data = await api.get<RevenueStats>('/api/billing/admin/revenue');
      set({ revenue: data });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  createPlan: async (plan) => {
    try {
      await api.post('/api/billing/admin/plans', plan);
      await get().loadPlans();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  updatePlan: async (id, plan) => {
    try {
      await api.patch(`/api/billing/admin/plans/${id}`, plan);
      await get().loadPlans();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  deletePlan: async (id) => {
    try {
      await api.delete(`/api/billing/admin/plans/${id}`);
      await get().loadPlans();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  assignPlan: async (userId, planId) => {
    try {
      await api.post(`/api/billing/admin/users/${userId}/assign-plan`, { planId });
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  adjustBalance: async (userId, amountUsd) => {
    try {
      await api.post(`/api/billing/admin/users/${userId}/adjust-balance`, { amountUsd });
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  getRedeemCodes: async () => {
    try {
      return await api.get<{ codes: RedeemCode[] }>('/api/billing/admin/redeem-codes');
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return { codes: [] };
    }
  },

  createRedeemCodes: async (codes) => {
    try {
      await api.post('/api/billing/admin/redeem-codes', { codes });
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  deleteRedeemCode: async (code) => {
    try {
      await api.delete(`/api/billing/admin/redeem-codes/${code}`);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  getRedeemCodeUsage: async (code) => {
    try {
      const data = await api.get<{ details: any[] }>(`/api/billing/admin/redeem-codes/${code}/usage`);
      return data.details;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  },

  getAuditLog: async (limit = 50, offset = 0) => {
    try {
      return await api.get<{ logs: any[]; total: number }>(
        `/api/billing/admin/audit-log?limit=${limit}&offset=${offset}`
      );
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return { logs: [], total: 0 };
    }
  },

  getRevenueTrend: async () => {
    try {
      const data = await api.get<{ trend: any[] }>('/api/billing/admin/revenue/trend');
      return data.trend;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  },

  getSubscriptionHistory: async (userId) => {
    try {
      const data = await api.get<{ history: any[] }>(`/api/billing/admin/users/${userId}/subscription-history`);
      return data.history;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  },

  batchAssignPlan: async (userIds, planId) => {
    try {
      await api.post('/api/billing/admin/users/batch-assign-plan', { userIds, planId });
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  cancelUserSubscription: async (userId) => {
    try {
      await api.post(`/api/billing/admin/users/${userId}/cancel-subscription`, {});
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },
}));
