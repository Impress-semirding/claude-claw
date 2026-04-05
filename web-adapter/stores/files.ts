/**
 * HappyClaw Web 前端适配器 - Files Store
 */

import { create } from 'zustand';
import { api } from '../api/client.js';

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified_at: string;
}

interface FilesState {
  files: Record<string, FileEntry[]>;
  currentPath: Record<string, string>;
  loading: boolean;
  error: string | null;
  loadFiles: (jid: string, path?: string) => Promise<void>;
  createDirectory: (jid: string, parentPath: string, name: string) => Promise<boolean>;
  readFile: (jid: string, filePath: string) => Promise<string>;
  writeFile: (jid: string, filePath: string, content: string) => Promise<boolean>;
  deleteFile: (jid: string, filePath: string) => Promise<boolean>;
}

function encodePath(filePath: string): string {
  return Buffer.from(filePath).toString('base64');
}

export const useFilesStore = create<FilesState>((set, get) => ({
  files: {},
  currentPath: {},
  loading: false,
  error: null,

  loadFiles: async (jid: string, path = '/') => {
    set({ loading: true, error: null });
    try {
      const data = await api.get<{ files: FileEntry[]; currentPath: string }>(
        `/api/groups/${jid}/files?path=${encodeURIComponent(path)}`
      );
      set((s) => ({
        files: { ...s.files, [jid]: data.files },
        currentPath: { ...s.currentPath, [jid]: data.currentPath },
        loading: false,
      }));
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  createDirectory: async (jid: string, parentPath: string, name: string) => {
    try {
      await api.post(`/api/groups/${jid}/files/directories`, { path: parentPath, name });
      await get().loadFiles(jid, parentPath);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  readFile: async (jid: string, filePath: string) => {
    try {
      const data = await api.get<{ content: string }>(
        `/api/groups/${jid}/files/content/${encodePath(filePath)}`
      );
      return data.content;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return '';
    }
  },

  writeFile: async (jid: string, filePath: string, content: string) => {
    try {
      await api.put(`/api/groups/${jid}/files/content/${encodePath(filePath)}`, { content });
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  deleteFile: async (jid: string, filePath: string) => {
    try {
      await api.delete(`/api/groups/${jid}/files/${encodePath(filePath)}`);
      const current = get().currentPath[jid] || '/';
      await get().loadFiles(jid, current);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },
}));
