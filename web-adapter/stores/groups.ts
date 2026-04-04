/**
 * HappyClaw Web 前端适配器 - Groups Store
 */

// @ts-ignore zustand is a dependency of the host project
import { create } from 'zustand';
import { api } from '../api/client.js';
import { useChatStore } from './chat.js';

export interface GroupInfo {
  id: string;
  jid: string;
  name: string;
  folder: string;
  description: string;
  is_my_home: boolean;
  pinned_at: string | null;
  member_count: number;
  is_owner: boolean;
  is_member: boolean;
  role: 'owner' | 'member' | 'none';
  created_at: string;
  execution_mode: string;
  custom_cwd: string | null;
  linked_im_groups: any[];
  mcp_mode?: string;
}

export interface GroupMember {
  user_id: string;
  username: string;
  display_name: string;
  role: 'owner' | 'member';
  joined_at: string;
}

interface GroupsState {
  groups: Record<string, GroupInfo>;
  loading: boolean;
  error: string | null;
  members: Record<string, GroupMember[]>;
  membersLoading: boolean;
  runnerStates: Record<string, 'idle' | 'running'>;
  loadGroups: () => Promise<void>;
  loadMembers: (jid: string) => Promise<void>;
  addMember: (jid: string, userId: string) => Promise<void>;
  removeMember: (jid: string, userId: string) => Promise<void>;
  setRunnerState: (chatJid: string, state: 'idle' | 'running') => void;
}

export const useGroupsStore = create<GroupsState>((set, get) => ({
  groups: {},
  loading: false,
  error: null,
  members: {},
  membersLoading: false,
  runnerStates: {},

  loadGroups: async () => {
    set({ loading: true });
    try {
      const data = await api.get<{ groups: Record<string, GroupInfo> }>('/api/groups');
      set({ groups: data.groups, loading: false, error: null });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  loadMembers: async (jid: string) => {
    set({ membersLoading: true });
    try {
      const data = await api.get<{ members: GroupMember[] }>(`/api/groups/${encodeURIComponent(jid)}/members`);
      set((state) => ({
        members: { ...state.members, [jid]: data.members },
        membersLoading: false,
      }));
    } catch (err) {
      set({ membersLoading: false });
      throw err;
    }
  },

  addMember: async (jid: string, userId: string) => {
    const data = await api.post<{ members: GroupMember[] }>(
      `/api/groups/${encodeURIComponent(jid)}/members`,
      { user_id: userId },
    );
    set((state) => ({
      members: { ...state.members, [jid]: data.members },
    }));
    get().loadGroups();
    useChatStore.getState().loadGroups();
  },

  removeMember: async (jid: string, userId: string) => {
    const data = await api.delete<{ members: GroupMember[] }>(
      `/api/groups/${encodeURIComponent(jid)}/members/${encodeURIComponent(userId)}`,
    );
    set((state) => ({
      members: { ...state.members, [jid]: data.members },
    }));
    get().loadGroups();
    useChatStore.getState().loadGroups();
  },

  setRunnerState: (chatJid: string, state: 'idle' | 'running') => {
    set((s) => {
      if (state === 'idle') {
        const { [chatJid]: _, ...rest } = s.runnerStates;
        return { runnerStates: rest };
      }
      return { runnerStates: { ...s.runnerStates, [chatJid]: state } };
    });
  },
}));
