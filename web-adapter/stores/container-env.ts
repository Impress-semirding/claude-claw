/**
 * HappyClaw Web 前端适配器 - Container Env Store
 * Maps to /api/groups/:jid/env
 */

import { create } from 'zustand';
import { api } from '../api/client.js';

interface ContainerEnvState {
  envs: Record<string, Record<string, string>>;
  loading: boolean;
  error: string | null;
  loadEnv: (jid: string) => Promise<void>;
  updateEnv: (jid: string, env: Record<string, string>) => Promise<boolean>;
}

export const useContainerEnvStore = create<ContainerEnvState>((set, get) => ({
  envs: {},
  loading: false,
  error: null,

  loadEnv: async (jid: string) => {
    set({ loading: true, error: null });
    try {
      const data = await api.get<{ env: Record<string, string> }>(`/api/groups/${jid}/env`);
      set((s) => ({
        envs: { ...s.envs, [jid]: data.env || {} },
        loading: false,
      }));
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  updateEnv: async (jid: string, env: Record<string, string>) => {
    try {
      const data = await api.put<{ env: Record<string, string> }>(`/api/groups/${jid}/env`, { env });
      set((s) => ({
        envs: { ...s.envs, [jid]: data.env || env },
        error: null,
      }));
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },
}));
