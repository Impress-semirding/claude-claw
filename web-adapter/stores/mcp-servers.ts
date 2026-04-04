/**
 * HappyClaw Web 前端适配器 - MCP Servers Store
 * 将 HappyClaw 的 MCP 服务器 API 映射到 Claw 后端
 */

import { create } from 'zustand';
import { api } from '../api/client.js';

export interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  status: 'active' | 'inactive';
  created_at: string;
}

interface McpServersState {
  servers: McpServer[];
  loading: boolean;
  error: string | null;
  loadServers: () => Promise<void>;
  addServer: (server: Omit<McpServer, 'id' | 'created_at'>) => Promise<boolean>;
  updateServer: (id: string, server: Partial<McpServer>) => Promise<boolean>;
  deleteServer: (id: string) => Promise<boolean>;
  toggleServerStatus: (id: string) => Promise<boolean>;
  syncHost: () => Promise<{ added: number; updated: number; deleted: number; skipped: number } | null>;
}

export const useMcpServersStore = create<McpServersState>((set, get) => ({
  servers: [],
  loading: false,
  error: null,

  loadServers: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.get<{ servers: McpServer[] }>('/api/mcp-servers');
      set({ servers: data.servers, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  },

  addServer: async (server) => {
    try {
      const data = await api.post<{ success: boolean; id: string }>('/api/mcp-servers', server);
      await get().loadServers();
      return data.success;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  },

  updateServer: async (id, updates) => {
    try {
      await api.patch<{ success: boolean }>(`/api/mcp-servers/${id}`, updates);
      await get().loadServers();
      return true;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  },

  deleteServer: async (id) => {
    try {
      await api.delete(`/api/mcp-servers/${id}`);
      set((state) => ({
        servers: state.servers.filter((s) => s.id !== id),
        error: null,
      }));
      return true;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  },

  toggleServerStatus: async (id) => {
    const server = get().servers.find((s) => s.id === id);
    if (!server) return false;

    const newStatus = server.status === 'active' ? 'inactive' : 'active';
    return get().updateServer(id, { status: newStatus });
  },

  syncHost: async () => {
    try {
      const data = await api.post<{ added: number; updated: number; deleted: number; skipped: number }>(
        '/api/mcp-servers/sync-host'
      );
      await get().loadServers();
      return data;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },
}));
