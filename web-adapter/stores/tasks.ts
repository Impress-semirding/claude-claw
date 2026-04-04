/**
 * HappyClaw Web 前端适配器 - Tasks Store
 */

import { create } from 'zustand';
import { api } from '../api/client.js';

export interface Task {
  id: string;
  name: string;
  description: string;
  cron: string;
  prompt: string;
  groupId: string | null;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  status?: 'idle' | 'running';
}

export interface TaskLog {
  id: string;
  taskId: string;
  status: string;
  result?: string;
  startedAt: number;
  endedAt?: number;
}

interface TasksState {
  tasks: Task[];
  runningTaskIds: string[];
  logs: Record<string, TaskLog[]>;
  loading: boolean;
  error: string | null;
  loadTasks: () => Promise<void>;
  createTask: (task: Partial<Task>) => Promise<boolean>;
  updateTask: (id: string, task: Partial<Task>) => Promise<boolean>;
  deleteTask: (id: string) => Promise<boolean>;
  runTask: (id: string) => Promise<boolean>;
  loadLogs: (id: string) => Promise<void>;
  createAiTask: (data: any) => Promise<Task | null>;
  parseTask: (text: string) => Promise<{ name: string; cron: string; prompt: string } | null>;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  runningTaskIds: [],
  logs: {},
  loading: false,
  error: null,

  loadTasks: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.get<{ tasks: Task[]; runningTaskIds: string[] }>('/api/tasks');
      set({ tasks: data.tasks, runningTaskIds: data.runningTaskIds, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  createTask: async (task) => {
    try {
      await api.post('/api/tasks', task);
      await get().loadTasks();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  updateTask: async (id, task) => {
    try {
      await api.patch(`/api/tasks/${id}`, task);
      await get().loadTasks();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  deleteTask: async (id) => {
    try {
      await api.delete(`/api/tasks/${id}`);
      set((s) => ({
        tasks: s.tasks.filter((t) => t.id !== id),
        runningTaskIds: s.runningTaskIds.filter((tid) => tid !== id),
        error: null,
      }));
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  runTask: async (id) => {
    try {
      await api.post(`/api/tasks/${id}/run`, {});
      set((s) => ({ runningTaskIds: [...s.runningTaskIds, id], error: null }));
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  loadLogs: async (id) => {
    try {
      const data = await api.get<{ logs: TaskLog[] }>(`/api/tasks/${id}/logs`);
      set((s) => ({ logs: { ...s.logs, [id]: data.logs }, error: null }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  createAiTask: async (data) => {
    try {
      const res = await api.post<{ task: Task }>('/api/tasks/ai', data);
      await get().loadTasks();
      return res.task;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  parseTask: async (text) => {
    try {
      const res = await api.post<{ parsed: { name: string; cron: string; prompt: string } }>('/api/tasks/parse', {
        text,
      });
      return res.parsed;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },
}));
