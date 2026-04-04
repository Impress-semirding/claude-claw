/**
 * HappyClaw Web 前端适配器 - Usage Store
 */

import { create } from 'zustand';
import { api } from '../api/client.js';

export interface UsageDay {
  day: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUSD: number;
  messages: number;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUSD: number;
  totalMessages: number;
  totalActiveDays: number;
}

export interface UsageStats {
  summary: UsageSummary;
  breakdown: UsageDay[];
  days: number;
  dataRange: any;
}

export interface ModelInfo {
  id: string;
  name: string;
  enabled: boolean;
}

interface UsageState {
  stats: UsageStats | null;
  models: ModelInfo[];
  users: any[];
  loading: boolean;
  error: string | null;
  loadStats: (days?: number) => Promise<void>;
  loadModels: () => Promise<void>;
  loadUsers: () => Promise<void>;
}

export const useUsageStore = create<UsageState>((set) => ({
  stats: null,
  models: [],
  users: [],
  loading: false,
  error: null,

  loadStats: async (days = 7) => {
    set({ loading: true, error: null });
    try {
      const data = await api.get<UsageStats>(`/api/usage/stats?days=${days}`);
      set({ stats: data, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  loadModels: async () => {
    try {
      const data = await api.get<{ models: ModelInfo[] }>('/api/usage/models');
      set({ models: data.models });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  loadUsers: async () => {
    try {
      const data = await api.get<{ users: any[] }>('/api/usage/users');
      set({ users: data.users });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
}));
