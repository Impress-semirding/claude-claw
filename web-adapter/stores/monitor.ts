/**
 * HappyClaw Web 前端适配器 - Monitor Store
 * Maps to /api/status
 */

import { create } from 'zustand';
import { api } from '../api/client.js';

export interface GroupStatus {
  jid: string;
  name: string;
  status: 'idle' | 'running';
}

export interface SystemStatus {
  status: string;
  version: string;
  uptime: number;
  timestamp: string;
  activeContainers: number;
  activeHostProcesses: number;
  queueLength: number;
  groups: GroupStatus[];
}

interface MonitorState {
  status: SystemStatus | null;
  loading: boolean;
  error: string | null;
  loadStatus: () => Promise<void>;
}

export const useMonitorStore = create<MonitorState>((set) => ({
  status: null,
  loading: false,
  error: null,

  loadStatus: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.get<SystemStatus>('/api/status');
      set({ status: data, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
}));
