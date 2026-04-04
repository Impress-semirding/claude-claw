/**
 * HappyClaw Web 前端适配器 - Workspace Config Store
 */

import { create } from 'zustand';
import { api } from '../api/client.js';

export interface AppearanceConfig {
  appName: string;
  aiName: string;
  aiAvatarEmoji: string;
  aiAvatarColor: string;
}

export interface SystemConfig {
  allowRegistration: boolean;
  requireInviteCode: boolean;
  defaultExecutionMode: string;
}

export interface ClaudeConfig {
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
  sandboxEnabled: boolean;
  baseUrl: string;
}

export interface ImBinding {
  provider: string;
  connected: boolean;
}

export interface WorkspaceMcpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  status: 'active' | 'inactive';
}

export interface WorkspaceSkill {
  id: string;
  name: string;
  enabled: boolean;
}

interface WorkspaceConfigState {
  appearance: AppearanceConfig | null;
  system: SystemConfig | null;
  claude: ClaudeConfig | null;
  imBindings: ImBinding[];
  registration: { allowRegistration: boolean; requireInviteCode: boolean } | null;
  workspaceSkills: Record<string, WorkspaceSkill[]>;
  workspaceMcpServers: Record<string, WorkspaceMcpServer[]>;
  loading: boolean;
  error: string | null;
  loadAppearance: () => Promise<void>;
  updateAppearance: (config: Partial<AppearanceConfig>) => Promise<boolean>;
  loadSystem: () => Promise<void>;
  updateSystem: (config: Partial<SystemConfig>) => Promise<boolean>;
  loadClaude: () => Promise<void>;
  updateClaude: (config: Partial<ClaudeConfig>) => Promise<boolean>;
  testClaude: () => Promise<boolean>;
  applyClaude: () => Promise<boolean>;
  loadImBinding: (provider: string) => Promise<ImBinding | null>;
  updateImBinding: (provider: string, data: any) => Promise<boolean>;
  loadImBindings: () => Promise<void>;
  updateImBindingByJid: (imJid: string, data: any) => Promise<boolean>;
  loadRegistration: () => Promise<void>;
  updateRegistration: (data: Partial<{ allowRegistration: boolean; requireInviteCode: boolean }>) => Promise<boolean>;
  loadWorkspaceSkills: (jid: string) => Promise<void>;
  installWorkspaceSkill: (jid: string, data: any) => Promise<boolean>;
  updateWorkspaceSkill: (jid: string, id: string, data: any) => Promise<boolean>;
  deleteWorkspaceSkill: (jid: string, id: string) => Promise<boolean>;
  loadWorkspaceMcpServers: (jid: string) => Promise<void>;
  addWorkspaceMcpServer: (jid: string, data: any) => Promise<boolean>;
  updateWorkspaceMcpServer: (jid: string, id: string, data: any) => Promise<boolean>;
  deleteWorkspaceMcpServer: (jid: string, id: string) => Promise<boolean>;
}

export const useWorkspaceConfigStore = create<WorkspaceConfigState>((set, get) => ({
  appearance: null,
  system: null,
  claude: null,
  imBindings: [],
  registration: null,
  workspaceSkills: {},
  workspaceMcpServers: {},
  loading: false,
  error: null,

  loadAppearance: async () => {
    try {
      const data = await api.get<AppearanceConfig>('/api/config/appearance');
      set({ appearance: data });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  updateAppearance: async (config) => {
    try {
      await api.put('/api/config/appearance', config);
      await get().loadAppearance();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  loadSystem: async () => {
    try {
      const data = await api.get<SystemConfig>('/api/config/system');
      set({ system: data });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  updateSystem: async (config) => {
    try {
      await api.put('/api/config/system', config);
      await get().loadSystem();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  loadClaude: async () => {
    try {
      const data = await api.get<ClaudeConfig>('/api/config/claude');
      set({ claude: data });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  updateClaude: async (config) => {
    try {
      await api.put('/api/config/claude', config);
      await get().loadClaude();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  testClaude: async () => {
    try {
      await api.post('/api/config/claude/test', {});
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  applyClaude: async () => {
    try {
      await api.post('/api/config/claude/apply', {});
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  loadImBinding: async (provider) => {
    try {
      const data = await api.get<ImBinding>(`/api/config/user-im/${provider}`);
      return data;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  updateImBinding: async (provider, data) => {
    try {
      await api.put(`/api/config/user-im/${provider}`, data);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  loadImBindings: async () => {
    try {
      const data = await api.get<{ bindings: ImBinding[] }>('/api/config/user-im/bindings');
      set({ imBindings: data.bindings });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  updateImBindingByJid: async (imJid, data) => {
    try {
      await api.put(`/api/config/user-im/bindings/${imJid}`, data);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  loadRegistration: async () => {
    try {
      const data = await api.get<{ allowRegistration: boolean; requireInviteCode: boolean }>('/api/config/registration');
      set({ registration: data });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  updateRegistration: async (data) => {
    try {
      await api.put('/api/config/registration', data);
      await get().loadRegistration();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  loadWorkspaceSkills: async (jid) => {
    try {
      const data = await api.get<{ skills: WorkspaceSkill[] }>(`/api/groups/${jid}/workspace-config/skills`);
      set((s) => ({ workspaceSkills: { ...s.workspaceSkills, [jid]: data.skills } }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  installWorkspaceSkill: async (jid, data) => {
    try {
      await api.post(`/api/groups/${jid}/workspace-config/skills/install`, data);
      await get().loadWorkspaceSkills(jid);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  updateWorkspaceSkill: async (jid, id, data) => {
    try {
      await api.patch(`/api/groups/${jid}/workspace-config/skills/${id}`, data);
      await get().loadWorkspaceSkills(jid);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  deleteWorkspaceSkill: async (jid, id) => {
    try {
      await api.delete(`/api/groups/${jid}/workspace-config/skills/${id}`);
      await get().loadWorkspaceSkills(jid);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  loadWorkspaceMcpServers: async (jid) => {
    try {
      const data = await api.get<{ servers: WorkspaceMcpServer[] }>(`/api/groups/${jid}/workspace-config/mcp-servers`);
      set((s) => ({ workspaceMcpServers: { ...s.workspaceMcpServers, [jid]: data.servers } }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  addWorkspaceMcpServer: async (jid, data) => {
    try {
      await api.post(`/api/groups/${jid}/workspace-config/mcp-servers`, data);
      await get().loadWorkspaceMcpServers(jid);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  updateWorkspaceMcpServer: async (jid, id, data) => {
    try {
      await api.patch(`/api/groups/${jid}/workspace-config/mcp-servers/${id}`, data);
      await get().loadWorkspaceMcpServers(jid);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  deleteWorkspaceMcpServer: async (jid, id) => {
    try {
      await api.delete(`/api/groups/${jid}/workspace-config/mcp-servers/${id}`);
      await get().loadWorkspaceMcpServers(jid);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },
}));
