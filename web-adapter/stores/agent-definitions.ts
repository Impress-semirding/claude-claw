/**
 * HappyClaw Web 前端适配器 - Agent Definitions Store
 */

import { create } from 'zustand';
import { api } from '../api/client.js';

export interface AgentDefinition {
  id: string;
  group_id?: string;
  name: string;
  prompt: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  kind: 'task' | 'conversation' | 'spawn';
  created_at?: string;
  updated_at?: string;
}

interface AgentDefinitionsState {
  agents: AgentDefinition[];
  groupAgents: Record<string, AgentDefinition[]>;
  loading: boolean;
  error: string | null;
  loadAgents: () => Promise<void>;
  loadGroupAgents: (jid: string) => Promise<void>;
  createAgent: (data: Partial<AgentDefinition>) => Promise<AgentDefinition | null>;
  createGroupAgent: (jid: string, data: Partial<AgentDefinition>) => Promise<AgentDefinition | null>;
  updateAgent: (id: string, data: Partial<AgentDefinition>) => Promise<boolean>;
  updateGroupAgent: (jid: string, id: string, data: Partial<AgentDefinition>) => Promise<boolean>;
  deleteAgent: (id: string) => Promise<boolean>;
  deleteGroupAgent: (jid: string, id: string) => Promise<boolean>;
  bindIm: (jid: string, agentId: string, data: any) => Promise<boolean>;
  unbindIm: (jid: string, agentId: string) => Promise<boolean>;
  bindGroupIm: (jid: string, data: any) => Promise<boolean>;
  unbindGroupIm: (jid: string, imJid: string) => Promise<boolean>;
  loadImGroups: (jid: string) => Promise<any[]>;
}

export const useAgentDefinitionsStore = create<AgentDefinitionsState>((set, get) => ({
  agents: [],
  groupAgents: {},
  loading: false,
  error: null,

  loadAgents: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.get<{ agents: AgentDefinition[] }>('/api/agent-definitions');
      set({ agents: data.agents, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  loadGroupAgents: async (jid) => {
    try {
      const data = await api.get<{ agents: AgentDefinition[] }>(`/api/groups/${jid}/agents`);
      set((s) => ({ groupAgents: { ...s.groupAgents, [jid]: data.agents } }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  createAgent: async (data) => {
    try {
      const res = await api.post<{ success: boolean; id: string }>('/api/agent-definitions', data);
      await get().loadAgents();
      return { id: res.id, ...data } as AgentDefinition;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  createGroupAgent: async (jid, data) => {
    try {
      const res = await api.post<{ success: boolean; agent: AgentDefinition }>(`/api/groups/${jid}/agents`, data);
      await get().loadGroupAgents(jid);
      return res.agent;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  updateAgent: async (id, data) => {
    try {
      await api.put(`/api/agent-definitions/${id}`, data);
      await get().loadAgents();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  updateGroupAgent: async (jid, id, data) => {
    try {
      await api.patch(`/api/groups/${jid}/agents/${id}`, data);
      await get().loadGroupAgents(jid);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  deleteAgent: async (id) => {
    try {
      await api.delete(`/api/agent-definitions/${id}`);
      await get().loadAgents();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  deleteGroupAgent: async (jid, id) => {
    try {
      await api.delete(`/api/groups/${jid}/agents/${id}`);
      await get().loadGroupAgents(jid);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  bindIm: async (jid, agentId, data) => {
    try {
      await api.put(`/api/groups/${jid}/agents/${agentId}/im-binding`, data);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  unbindIm: async (jid, agentId) => {
    try {
      await api.delete(`/api/groups/${jid}/agents/${agentId}/im-binding`);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  bindGroupIm: async (jid, data) => {
    try {
      await api.put(`/api/groups/${jid}/im-binding`, data);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  unbindGroupIm: async (jid, imJid) => {
    try {
      await api.delete(`/api/groups/${jid}/im-binding/${imJid}`);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  loadImGroups: async (jid) => {
    try {
      const data = await api.get<{ groups: any[] }>(`/api/groups/${jid}/im-groups`);
      return data.groups;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  },
}));
