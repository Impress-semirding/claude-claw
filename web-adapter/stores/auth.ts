/**
 * HappyClaw Web 前端适配器 - Auth Store
 * 将 HappyClaw 的认证 API 映射到 Claw 后端
 */

import { create } from 'zustand';
import { api } from '../api/client.js';

export type Permission = 'manage_system_config' | 'manage_users';

export interface UserPublic {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
  permissions: Permission[];
  created_at: string;
  last_login_at: string | null;
  avatar_emoji: string | null;
  avatar_color: string | null;
}

export interface AppearanceConfig {
  appName: string;
  aiName: string;
  aiAvatarEmoji: string;
  aiAvatarColor: string;
}

interface AuthState {
  authenticated: boolean;
  user: UserPublic | null;
  appearance: AppearanceConfig | null;
  initialized: boolean | null;
  checking: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (data: { username: string; password: string; display_name?: string }) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  updateProfile: (payload: { display_name?: string; avatar_emoji?: string | null }) => Promise<void>;
  hasPermission: (permission: Permission) => boolean;
}

// 将 Claw 用户格式转换为 HappyClaw 格式
function mapClawUserToHappyClaw(clawUser: any): UserPublic {
  return {
    id: clawUser.id,
    username: clawUser.username,
    display_name: clawUser.displayName || clawUser.username,
    role: clawUser.role || 'member',
    status: clawUser.status || 'active',
    permissions: clawUser.permissions || [],
    created_at: clawUser.createdAt,
    last_login_at: clawUser.lastLoginAt || null,
    avatar_emoji: clawUser.avatarEmoji || null,
    avatar_color: clawUser.avatarColor || null,
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  authenticated: false,
  user: null,
  appearance: null,
  initialized: null,
  checking: true,

  login: async (username: string, password: string) => {
    const data = await api.post<{ token: string; user: any }>('/api/auth/login', { username, password });
    // 保存 token
    localStorage.setItem('claw_token', data.token);
    const user = mapClawUserToHappyClaw(data.user);
    set({ authenticated: true, user, initialized: true });
  },

  register: async (payload) => {
    const data = await api.post<{ token: string; user: any }>('/api/auth/register', payload);
    localStorage.setItem('claw_token', data.token);
    const user = mapClawUserToHappyClaw(data.user);
    set({ authenticated: true, user, initialized: true });
  },

  logout: async () => {
    localStorage.removeItem('claw_token');
    set({ authenticated: false, user: null, initialized: true });
  },

  checkAuth: async () => {
    set({ checking: true });
    try {
      const token = localStorage.getItem('claw_token');
      if (!token) {
        set({ authenticated: false, user: null, initialized: true, checking: false });
        return;
      }
      const data = await api.get<{ user: any }>('/api/auth/me');
      const user = mapClawUserToHappyClaw(data.user);
      set({ authenticated: true, user, initialized: true, checking: false });
    } catch {
      localStorage.removeItem('claw_token');
      set({ authenticated: false, user: null, initialized: true, checking: false });
    }
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    await api.put('/api/auth/password', { current_password: currentPassword, new_password: newPassword });
  },

  updateProfile: async (payload) => {
    const data = await api.put<{ user: any }>('/api/auth/profile', payload);
    const user = mapClawUserToHappyClaw(data.user);
    set({ user });
  },

  hasPermission: (permission: Permission): boolean => {
    const user = get().user;
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.permissions.includes(permission);
  },
}));
