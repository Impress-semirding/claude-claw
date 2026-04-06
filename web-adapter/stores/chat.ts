/**
 * HappyClaw Web 前端适配器 - Chat Store
 * 将 HappyClaw 的聊天 API 映射到 Claw 后端
 */

// @ts-ignore zustand is a dependency of the host project
import { create } from 'zustand';
import { api } from '../api/client.js';
import type { StreamEvent } from '../types.js';
import {
  wsSendMessage,
  wsSendAgentMessage,
  onWsNewMessage,
  onWsStreamEvent,
  onWsRunnerState,
  onWsTyping,
  onWsOpen,
  initWebSocket,
} from '../api/ws.js';

export interface Message {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  attachments?: string;
  token_usage?: string;
  turn_id?: string | null;
  session_id?: string | null;
  sdk_message_uuid?: string | null;
  source_kind?: string | null;
  finalization_reason?: string | null;
}

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

export interface AgentInfo {
  id: string;
  name: string;
  prompt: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  kind: 'task' | 'conversation' | 'spawn';
  created_at: string;
}

export interface StreamingState {
  turnId?: string;
  sessionId?: string;
  partialText: string;
  thinkingText: string;
  isThinking: boolean;
  activeTools: Array<{
    toolName: string;
    toolUseId: string;
    startTime: number;
    elapsedSeconds?: number;
    parentToolUseId?: string | null;
    isNested?: boolean;
    skillName?: string;
    toolInputSummary?: string;
  }>;
  activeHook: { hookName: string; hookEvent: string } | null;
  systemStatus: string | null;
  recentEvents: Array<{
    id: string;
    timestamp: number;
    text: string;
    kind: 'tool' | 'skill' | 'hook' | 'status';
  }>;
  interrupted?: boolean;
}

interface LoadMessagesOpts {
  before?: string;
  after?: string;
  limit?: number;
}

interface ChatState {
  groups: Record<string, GroupInfo>;
  currentGroup: string | null;
  messages: Record<string, Message[]>;
  waiting: Record<string, boolean>;
  hasMore: Record<string, boolean>;
  loading: boolean;
  error: string | null;
  streaming: Record<string, StreamingState>;
  wsInitialized: boolean;
  agents: Record<string, AgentInfo[]>;
  activeAgentTab: Record<string, string | null>;
  agentMessages: Record<string, Message[]>;
  agentWaiting: Record<string, boolean>;
  agentHasMore: Record<string, boolean>;
  agentStreaming: Record<string, StreamingState>;
  loadGroups: () => Promise<void>;
  selectGroup: (id: string) => void;
  loadMessages: (id: string, opts?: LoadMessagesOpts) => Promise<void>;
  sendMessage: (id: string, content: string, attachments?: unknown[]) => Promise<void>;
  createGroup: (name: string, description?: string) => Promise<{ id: string; folder: string } | null>;
  deleteGroup: (id: string) => Promise<void>;
  stopGroup: (id: string) => Promise<void>;
  interruptQuery: (id: string) => Promise<void>;
  resetSession: (id: string) => Promise<void>;
  clearHistory: (id: string) => Promise<void>;
  handleStreamEvent: (id: string, event: StreamEvent) => void;
  initWebSocket: () => void;
  restoreActiveState: () => Promise<void>;
  loadAgents: (groupId: string) => Promise<void>;
  selectAgentTab: (groupId: string, agentId: string | null) => void;
  loadAgentMessages: (groupId: string, agentId: string, opts?: LoadMessagesOpts) => Promise<void>;
  sendAgentMessage: (groupId: string, agentId: string, content: string, attachments?: unknown[]) => Promise<void>;
}

const DEFAULT_STREAMING_STATE: StreamingState = {
  partialText: '',
  thinkingText: '',
  isThinking: false,
  activeTools: [],
  activeHook: null,
  systemStatus: null,
  recentEvents: [],
};

const STREAMING_STORAGE_KEY = 'claw_streaming';
const streamingSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function saveStreamingToSession(chatJid: string, state: StreamingState | undefined): void {
  const existing = streamingSaveTimers.get(chatJid);
  if (existing) clearTimeout(existing);
  streamingSaveTimers.set(chatJid, setTimeout(() => {
    streamingSaveTimers.delete(chatJid);
    try {
      const stored = JSON.parse(sessionStorage.getItem(STREAMING_STORAGE_KEY) || '{}');
      if (state && (state.partialText || state.activeTools.length > 0 || state.recentEvents.length > 0)) {
        stored[chatJid] = {
          partialText: state.partialText.slice(-4000),
          thinkingText: '',
          isThinking: false,
          activeTools: state.activeTools,
          recentEvents: state.recentEvents.slice(-10),
          systemStatus: state.systemStatus,
          turnId: state.turnId,
          ts: Date.now(),
        };
      } else {
        delete stored[chatJid];
      }
      sessionStorage.setItem(STREAMING_STORAGE_KEY, JSON.stringify(stored));
    } catch { /* quota exceeded or SSR */ }
  }, 500));
}

function clearStreamingFromSession(chatJid: string): void {
  const timer = streamingSaveTimers.get(chatJid);
  if (timer) { clearTimeout(timer); streamingSaveTimers.delete(chatJid); }
  try {
    const stored = JSON.parse(sessionStorage.getItem(STREAMING_STORAGE_KEY) || '{}');
    delete stored[chatJid];
    sessionStorage.setItem(STREAMING_STORAGE_KEY, JSON.stringify(stored));
  } catch { /* SSR */ }
}

function restoreStreamingFromSession(chatJid: string): StreamingState | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STREAMING_STORAGE_KEY) || '{}');
    const entry = stored[chatJid];
    if (!entry) return null;
    if (Date.now() - (entry.ts || 0) > 5 * 60 * 1000) {
      delete stored[chatJid];
      sessionStorage.setItem(STREAMING_STORAGE_KEY, JSON.stringify(stored));
      return null;
    }
    return {
      ...DEFAULT_STREAMING_STATE,
      partialText: entry.partialText || '',
      activeTools: entry.activeTools || [],
      recentEvents: entry.recentEvents || [],
      systemStatus: entry.systemStatus || null,
      turnId: entry.turnId,
    };
  } catch { return null; }
}

function mapGroup(data: any): GroupInfo {
  return {
    id: data.jid || data.id,
    jid: data.jid || data.id,
    name: data.name,
    folder: data.folder || data.jid || data.id,
    description: data.description || '',
    is_my_home: data.is_my_home || false,
    pinned_at: data.pinned_at || null,
    member_count: data.member_count || 1,
    is_owner: data.is_owner ?? true,
    is_member: data.is_member ?? true,
    role: data.role || 'owner',
    created_at: data.created_at,
    execution_mode: data.execution_mode || 'host',
    custom_cwd: data.custom_cwd || null,
    linked_im_groups: data.linked_im_groups || [],
    mcp_mode: data.mcp_mode,
  };
}

function mapMessage(msg: any): Message {
  return {
    id: msg.id,
    chat_jid: msg.chat_jid,
    sender: msg.sender,
    sender_name: msg.sender_name,
    content: msg.content,
    timestamp: msg.timestamp,
    is_from_me: msg.is_from_me,
    attachments: msg.attachments,
    token_usage: msg.token_usage,
    turn_id: msg.turn_id || null,
    session_id: msg.session_id || null,
    sdk_message_uuid: msg.sdk_message_uuid || null,
    source_kind: msg.source_kind || null,
    finalization_reason: msg.finalization_reason || null,
  };
}

function reduceStreamEvent(prev: StreamingState, event: StreamEvent): StreamingState {
  const next = { ...prev };
  switch (event.eventType) {
    case 'text_delta':
      next.partialText += event.text || '';
      next.isThinking = false;
      break;
    case 'thinking_delta':
      next.thinkingText += event.text || '';
      next.isThinking = true;
      break;
    case 'tool_use_start':
      next.activeTools.push({
        toolName: event.toolName || 'unknown',
        toolUseId: event.toolUseId || '',
        startTime: Date.now(),
        parentToolUseId: event.parentToolUseId,
        isNested: event.isNested,
        skillName: event.skillName,
        toolInputSummary: event.toolInputSummary,
      });
      next.recentEvents.push({
        id: `${Date.now()}-${Math.random()}`,
        timestamp: Date.now(),
        text: `Tool: ${event.toolName}`,
        kind: 'tool',
      });
      break;
    case 'tool_use_end':
      next.activeTools = next.activeTools.filter((t: any) => t.toolUseId !== event.toolUseId);
      break;
    case 'status':
      next.systemStatus = event.statusText || null;
      break;
    case 'complete':
      break;
    case 'error':
      next.systemStatus = event.error || 'Error';
      break;
  }
  return next;
}

export const useChatStore = create<ChatState>((set, get) => ({
  groups: {},
  currentGroup: null,
  messages: {},
  waiting: {},
  hasMore: {},
  loading: false,
  error: null,
  streaming: {},
  wsInitialized: false,
  agents: {},
  activeAgentTab: {},
  agentMessages: {},
  agentWaiting: {},
  agentHasMore: {},
  agentStreaming: {},

  loadGroups: async () => {
    set({ loading: true });
    try {
      const data = await api.get<{ groups: Record<string, any> }>('/api/groups');
      const groups: Record<string, GroupInfo> = {};
      for (const key of Object.keys(data.groups)) {
        const group = mapGroup(data.groups[key]);
        groups[group.id] = group;
      }

      const firstGroupId = Object.keys(groups)[0] || null;

      set({
        groups,
        currentGroup: get().currentGroup || firstGroupId,
        loading: false,
        error: null,
      });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  selectGroup: (id: string) => {
    set({ currentGroup: id });
    const state = get();
    if (!state.messages[id]) {
      get().loadMessages(id);
    }
  },

  loadMessages: async (id: string, opts?: LoadMessagesOpts) => {
    try {
      const opt = opts || {};
      const limit = opt.limit || 50;
      const before = opt.before || '';
      const after = opt.after || '';
      let url = `/api/groups/${id}/messages?limit=${limit}`;
      if (before) url += `&before=${encodeURIComponent(before)}`;
      if (after) url += `&after=${encodeURIComponent(after)}`;
      const data = await api.get<{ messages: any[]; hasMore: boolean }>(url);
      const msgs = data.messages.map(mapMessage);

      set((s: ChatState) => {
        const latest = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        const shouldWait =
          !!latest &&
          latest.sender !== '__system__' &&
          (latest.is_from_me === false || latest.source_kind === 'sdk_send_message');
        const nextWaiting = { ...s.waiting };
        if (shouldWait) {
          nextWaiting[id] = true;
        } else {
          delete nextWaiting[id];
        }
        return {
          messages: { ...s.messages, [id]: msgs },
          waiting: nextWaiting,
          hasMore: { ...s.hasMore, [id]: data.hasMore },
          error: null,
        };
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  sendMessage: async (id: string, content: string, attachments?: unknown[]) => {
    try {
      const userMsg: Message = {
        id: `temp-${Date.now()}`,
        chat_jid: id,
        sender: 'me',
        sender_name: 'Me',
        content,
        timestamp: new Date().toISOString(),
        is_from_me: false,
      };

      set((s: ChatState) => ({
        messages: {
          ...s.messages,
          [id]: [...(s.messages[id] || []), userMsg],
        },
        waiting: { ...s.waiting, [id]: true },
        streaming: {
          ...s.streaming,
          [id]: { ...DEFAULT_STREAMING_STATE },
        },
      }));

      wsSendMessage(id, content, attachments);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        waiting: { ...get().waiting, [id]: false },
      });
    }
  },

  createGroup: async (name: string, description?: string) => {
    try {
      const data = await api.post<{ success: boolean; jid: string; group: any }>('/api/groups', {
        name,
        description,
      });
      const group = mapGroup(data.group);

      set((s: ChatState) => ({
        groups: { ...s.groups, [group.id]: group },
        currentGroup: group.id,
        error: null,
      }));

      return { id: group.id, folder: group.folder };
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  deleteGroup: async (id: string) => {
    try {
      await api.delete(`/api/groups/${id}`);

      set((s: ChatState) => {
        const nextGroups = { ...s.groups };
        delete nextGroups[id];

        const remainingIds = Object.keys(nextGroups);
        const nextCurrent = s.currentGroup === id ? remainingIds[0] || null : s.currentGroup;

        return {
          groups: nextGroups,
          currentGroup: nextCurrent,
          error: null,
        };
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  stopGroup: async (id: string) => {
    try {
      await api.post(`/api/groups/${id}/stop`, {});
      clearStreamingFromSession(id);
      set((s: ChatState) => {
        const nextStreaming = { ...s.streaming };
        delete nextStreaming[id];
        return {
          waiting: { ...s.waiting, [id]: false },
          streaming: nextStreaming,
        };
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  interruptQuery: async (id: string) => {
    try {
      await api.post(`/api/groups/${id}/interrupt`, {});
      clearStreamingFromSession(id);
      set((s: ChatState) => ({
        waiting: { ...s.waiting, [id]: false },
        streaming: {
          ...s.streaming,
          [id]: { ...(s.streaming[id] || DEFAULT_STREAMING_STATE), interrupted: true },
        },
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  resetSession: async (id: string) => {
    try {
      await api.post(`/api/groups/${id}/reset-session`, {});
      clearStreamingFromSession(id);
      set((s: ChatState) => {
        const nextStreaming = { ...s.streaming };
        delete nextStreaming[id];
        return {
          messages: { ...s.messages, [id]: [] },
          waiting: { ...s.waiting, [id]: false },
          streaming: nextStreaming,
          error: null,
        };
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  clearHistory: async (id: string) => {
    try {
      await api.post(`/api/groups/${id}/clear-history`, {});
      clearStreamingFromSession(id);
      set((s: ChatState) => {
        const nextStreaming = { ...s.streaming };
        delete nextStreaming[id];
        return {
          messages: { ...s.messages, [id]: [] },
          waiting: { ...s.waiting, [id]: false },
          streaming: nextStreaming,
          error: null,
        };
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  handleStreamEvent: (id: string, event: StreamEvent) => {
    set((s: ChatState) => {
      const prev = s.streaming[id] || { ...DEFAULT_STREAMING_STATE };
      const next = reduceStreamEvent(prev, event);
      saveStreamingToSession(id, next);
      return {
        streaming: { ...s.streaming, [id]: next },
        waiting: { ...s.waiting, [id]: true },
      };
    });
  },

  restoreActiveState: async () => {
    try {
      const data = await api.get<{
        groups: Array<{ jid: string; status: 'running' | 'idle'; pendingMessages?: boolean }>;
      }>('/api/status');
      set((s: ChatState) => {
        const nextWaiting = { ...s.waiting };
        const nextStreaming = { ...s.streaming };
        const knownJids = new Set(data.groups.map((g) => g.jid));

        for (const jid of Object.keys(nextWaiting)) {
          if (!knownJids.has(jid)) {
            delete nextWaiting[jid];
            delete nextStreaming[jid];
            clearStreamingFromSession(jid);
          }
        }

        for (const g of data.groups) {
          if (g.pendingMessages) {
            nextWaiting[g.jid] = true;
            continue;
          }
          if (g.status !== 'running') {
            delete nextWaiting[g.jid];
            delete nextStreaming[g.jid];
            clearStreamingFromSession(g.jid);
            continue;
          }
          const msgs = s.messages[g.jid] || [];
          const latest = msgs.length > 0 ? msgs[msgs.length - 1] : null;
          const inferredWaiting =
            !!latest &&
            latest.sender !== '__system__' &&
            (latest.is_from_me === false || latest.source_kind === 'sdk_send_message');
          if (inferredWaiting) {
            nextWaiting[g.jid] = true;
            if (!nextStreaming[g.jid]) {
              const restored = restoreStreamingFromSession(g.jid);
              if (restored) {
                nextStreaming[g.jid] = restored;
              }
            }
          } else {
            delete nextWaiting[g.jid];
            clearStreamingFromSession(g.jid);
          }
        }
        return { waiting: nextWaiting, streaming: nextStreaming };
      });
    } catch {
      // silent fail
    }
  },

  initWebSocket: () => {
    if (get().wsInitialized) return;
    set({ wsInitialized: true });

    initWebSocket();

    // Restore waiting/streaming state on initial load and WS reconnect
    get().restoreActiveState();
    onWsOpen(() => {
      get().restoreActiveState();
    });

    onWsNewMessage((data: any) => {
      const { chatJid, message, agentId } = data;
      if (agentId) {
        const key = `${chatJid}:${agentId}`;
        set((s: ChatState) => {
          const list = s.agentMessages[key] || [];
          const mapped = mapMessage(message);
          const isAssistant = mapped.is_from_me;
          return {
            agentMessages: {
              ...s.agentMessages,
              [key]: [...list, mapped],
            },
            agentWaiting: { ...s.agentWaiting, [key]: isAssistant ? false : s.agentWaiting[key] },
          };
        });
      } else {
        set((s: ChatState) => {
          const list = s.messages[chatJid] || [];
          const mapped = mapMessage(message);
          const isAssistant = mapped.is_from_me;
          return {
            messages: {
              ...s.messages,
              [chatJid]: [...list, mapped],
            },
            waiting: { ...s.waiting, [chatJid]: isAssistant ? false : s.waiting[chatJid] },
          };
        });
      }
    });

    onWsStreamEvent((data: any) => {
      const { chatJid, event, agentId } = data;
      if (agentId) {
        const key = `${chatJid}:${agentId}`;
        set((s: ChatState) => {
          const prev = s.agentStreaming[key] || { ...DEFAULT_STREAMING_STATE };
          const next = reduceStreamEvent(prev, event);
          return {
            agentStreaming: { ...s.agentStreaming, [key]: next },
            agentWaiting: { ...s.agentWaiting, [key]: true },
          };
        });
      } else {
        get().handleStreamEvent(chatJid, event);
      }
    });

    onWsRunnerState((data: any) => {
      const { chatJid, state, agentId } = data;
      if (agentId) {
        const key = `${chatJid}:${agentId}`;
        if (state === 'idle') {
          set((s: ChatState) => ({
            agentWaiting: { ...s.agentWaiting, [key]: false },
          }));
        }
      } else {
        if (state === 'idle') {
          clearStreamingFromSession(chatJid);
          set((s: ChatState) => ({
            waiting: { ...s.waiting, [chatJid]: false },
          }));
        }
      }
    });

    onWsTyping((data: any) => {
      const { chatJid, isTyping, agentId } = data;
      if (agentId) {
        const key = `${chatJid}:${agentId}`;
        set((s: ChatState) => ({
          agentWaiting: { ...s.agentWaiting, [key]: isTyping },
        }));
      } else {
        set((s: ChatState) => ({
          waiting: { ...s.waiting, [chatJid]: isTyping },
        }));
      }
    });
  },

  loadAgents: async (groupId: string) => {
    try {
      const data = await api.get<{ agents: AgentInfo[] }>(`/api/groups/${groupId}/agents`);
      set((s: ChatState) => ({
        agents: { ...s.agents, [groupId]: data.agents || [] },
        error: null,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  selectAgentTab: (groupId: string, agentId: string | null) => {
    set((s: ChatState) => ({
      activeAgentTab: { ...s.activeAgentTab, [groupId]: agentId },
    }));
  },

  loadAgentMessages: async (groupId: string, agentId: string, opts?: LoadMessagesOpts) => {
    try {
      const opt = opts || {};
      const limit = opt.limit || 50;
      const before = opt.before || '';
      const after = opt.after || '';
      let url = `/api/groups/${groupId}/messages?agentId=${encodeURIComponent(agentId)}&limit=${limit}`;
      if (before) url += `&before=${encodeURIComponent(before)}`;
      if (after) url += `&after=${encodeURIComponent(after)}`;
      const data = await api.get<{ messages: any[]; hasMore: boolean }>(url);
      const msgs = data.messages.map(mapMessage);
      const key = `${groupId}:${agentId}`;
      set((s: ChatState) => ({
        agentMessages: { ...s.agentMessages, [key]: msgs },
        agentHasMore: { ...s.agentHasMore, [key]: data.hasMore },
        error: null,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  sendAgentMessage: async (groupId: string, agentId: string, content: string, attachments?: unknown[]) => {
    try {
      const userMsg: Message = {
        id: `temp-${Date.now()}`,
        chat_jid: groupId,
        sender: 'me',
        sender_name: 'Me',
        content,
        timestamp: new Date().toISOString(),
        is_from_me: false,
      };
      const key = `${groupId}:${agentId}`;
      set((s: ChatState) => ({
        agentMessages: {
          ...s.agentMessages,
          [key]: [...(s.agentMessages[key] || []), userMsg],
        },
        agentWaiting: { ...s.agentWaiting, [key]: true },
        agentStreaming: {
          ...s.agentStreaming,
          [key]: { ...DEFAULT_STREAMING_STATE },
        },
      }));
      wsSendAgentMessage(groupId, agentId, content, attachments);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        agentWaiting: { ...get().agentWaiting, [key]: false },
      });
    }
  },
}));
