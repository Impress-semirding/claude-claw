/**
 * HappyClaw Web 前端适配器 - Users Store (Admin)
 */

import { create } from 'zustand';
import { api } from '../api/client.js';

export interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  role: string;
  status: string;
  created_at: string;
  avatar_emoji: string | null;
  avatar_color: string | null;
  avatar_url: string | null;
}

export interface Invite {
  code: string;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  user_id: string;
  event_type: string;
  ip_address: string;
  user_agent: string;
  details: string;
  created_at: string;
}

interface UsersState {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  invites: Invite[];
  auditLogs: AuditLogEntry[];
  auditTotal: number;
  loading: boolean;
  error: string | null;
  loadUsers: (page?: number, pageSize?: number) => Promise<void>;
  createUser: (data: any) => Promise<boolean>;
  updateUser: (id: string, data: any) => Promise<boolean>;
  deleteUser: (id: string) => Promise<boolean>;
  restoreUser: (id: string) => Promise<boolean>;
  revokeSessions: (id: string) => Promise<boolean>;
  loadInvites: () => Promise<void>;
  createInvite: (data: any) => Promise<string | null>;
  deleteInvite: (code: string) => Promise<boolean>;
  loadAuditLog: (limit?: number, offset?: number) => Promise<void>;
  loadPermissionTemplates: () => Promise<any>;
}

export const useUsersStore = create<UsersState>((set, get) => ({
  users: [],
  total: 0,
  page: 1,
  pageSize: 20,
  invites: [],
  auditLogs: [],
  auditTotal: 0,
  loading: false,
  error: null,

  loadUsers: async (page = 1, pageSize = 20) => {
    set({ loading: true, error: null });
    try {
      const data = await api.get<{ users: AdminUser[]; total: number; page: number; pageSize: number }>(
        `/api/admin/users?page=${page}&pageSize=${pageSize}`
      );
      set({
        users: data.users,
        total: data.total,
        page: data.page,
        pageSize: data.pageSize,
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  createUser: async (data) => {
    try {
      await api.post('/api/admin/users', data);
      await get().loadUsers(get().page, get().pageSize);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  updateUser: async (id, data) => {
    try {
      await api.patch(`/api/admin/users/${id}`, data);
      await get().loadUsers(get().page, get().pageSize);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  deleteUser: async (id) => {
    try {
      await api.delete(`/api/admin/users/${id}`);
      await get().loadUsers(get().page, get().pageSize);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  restoreUser: async (id) => {
    try {
      await api.post(`/api/admin/users/${id}/restore`, {});
      await get().loadUsers(get().page, get().pageSize);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  revokeSessions: async (id) => {
    try {
      await api.delete(`/api/admin/users/${id}/sessions`);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  loadInvites: async () => {
    try {
      const data = await api.get<{ invites: Invite[] }>('/api/admin/invites');
      set({ invites: data.invites });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  createInvite: async (data) => {
    try {
      const res = await api.post<{ code: string }>('/api/admin/invites', data);
      await get().loadInvites();
      return res.code;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  deleteInvite: async (code) => {
    try {
      await api.delete(`/api/admin/invites/${code}`);
      await get().loadInvites();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  loadAuditLog: async (limit = 50, offset = 0) => {
    try {
      const data = await api.get<{ logs: AuditLogEntry[]; total: number }>(
        `/api/admin/audit-log?limit=${limit}&offset=${offset}`
      );
      set({ auditLogs: data.logs, auditTotal: data.total });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  loadPermissionTemplates: async () => {
    try {
      return await api.get<any>('/api/admin/permission-templates');
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return { permissions: [], templates: [] };
    }
  },
}));
