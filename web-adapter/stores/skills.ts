/**
 * HappyClaw Web 前端适配器 - Skills Store
 */

import { create } from 'zustand';
import { api } from '../api/client.js';

export interface Skill {
  id: string;
  name: string;
  description: string;
  source: string;
  enabled: boolean;
  content: string | null;
  config: Record<string, any>;
  created_at?: string;
}

export interface SyncStatus {
  lastSyncAt: string;
  status: string;
}

export interface SyncSettings {
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
}

interface SkillsState {
  skills: Skill[];
  loading: boolean;
  error: string | null;
  syncStatus: SyncStatus | null;
  syncSettings: SyncSettings | null;
  loadSkills: () => Promise<void>;
  loadSkill: (id: string) => Promise<Skill | null>;
  createSkill: (skill: Partial<Skill>) => Promise<boolean>;
  updateSkill: (id: string, skill: Partial<Skill>) => Promise<boolean>;
  deleteSkill: (id: string) => Promise<boolean>;
  installSkill: (data: any) => Promise<boolean>;
  reinstallSkill: (id: string) => Promise<boolean>;
  syncHost: () => Promise<boolean>;
  loadSyncStatus: () => Promise<void>;
  updateSyncSettings: (settings: Partial<SyncSettings>) => Promise<boolean>;
  searchSkills: (query: string) => Promise<{ id: string; name: string; description: string }[]>;
  getSkillDetail: (id: string) => Promise<Skill | null>;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  loading: false,
  error: null,
  syncStatus: null,
  syncSettings: null,

  loadSkills: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.get<{ skills: Skill[] }>('/api/skills');
      set({ skills: data.skills, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  loadSkill: async (id: string) => {
    try {
      const data = await api.get<{ skill: Skill }>(`/api/skills/${id}`);
      return data.skill;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  createSkill: async (skill) => {
    try {
      await api.post('/api/skills', skill);
      await get().loadSkills();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  updateSkill: async (id, skill) => {
    try {
      await api.patch(`/api/skills/${id}`, skill);
      await get().loadSkills();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  deleteSkill: async (id) => {
    try {
      await api.delete(`/api/skills/${id}`);
      set((s) => ({ skills: s.skills.filter((sk) => sk.id !== id), error: null }));
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  installSkill: async (data) => {
    try {
      await api.post('/api/skills/install', data);
      await get().loadSkills();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  reinstallSkill: async (id) => {
    try {
      await api.post(`/api/skills/${id}/reinstall`, {});
      await get().loadSkills();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  syncHost: async () => {
    try {
      await api.post('/api/skills/sync-host', {});
      await get().loadSkills();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  loadSyncStatus: async () => {
    try {
      const data = await api.get<SyncStatus>('/api/skills/sync-status');
      set({ syncStatus: data });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  updateSyncSettings: async (settings) => {
    try {
      const data = await api.put<SyncSettings>('/api/skills/sync-settings', settings);
      set({ syncSettings: data, error: null });
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  searchSkills: async (query) => {
    try {
      const data = await api.get<{ results: { id: string; name: string; description: string }[] }>(
        `/api/skills/search?q=${encodeURIComponent(query)}`
      );
      return data.results;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  },

  getSkillDetail: async (id) => {
    try {
      const data = await api.get<{ detail: Skill }>(`/api/skills/search/detail?id=${encodeURIComponent(id)}`);
      return data.detail;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },
}));
