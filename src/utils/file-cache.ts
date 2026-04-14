import { readFileSync, statSync } from 'fs';

interface CacheEntry {
  content: string;
  size: number;
  mtimeMs: number;
  cachedAt: number;
}

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const DEFAULT_TTL_MS = 10_000;

class FileCache {
  private cache = new Map<string, CacheEntry>();
  private maxEntries: number;
  private maxBytes: number;
  private ttlMs: number;
  private currentBytes = 0;

  constructor(options?: { maxEntries?: number; maxBytes?: number; ttlMs?: number }) {
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  }

  get(path: string, ttlMs?: number): string | null {
    const entry = this.cache.get(path);
    if (!entry) return null;

    const effectiveTtl = ttlMs ?? this.ttlMs;
    if (Date.now() - entry.cachedAt > effectiveTtl) {
      this.invalidate(path);
      return null;
    }

    try {
      const stats = statSync(path);
      if (stats.mtimeMs !== entry.mtimeMs) {
        this.invalidate(path);
        return null;
      }
    } catch {
      this.invalidate(path);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(path);
    this.cache.set(path, entry);
    return entry.content;
  }

  set(path: string, content: string): void {
    const size = Buffer.byteLength(content, 'utf-8');

    // If single entry exceeds maxBytes, don't cache
    if (size > this.maxBytes) {
      return;
    }

    // Remove existing entry if present
    if (this.cache.has(path)) {
      this.invalidate(path);
    }

    // Evict oldest entries until we have room
    while (this.cache.size >= this.maxEntries || this.currentBytes + size > this.maxBytes) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey === undefined) break;
      this.invalidate(firstKey);
    }

    try {
      const stats = statSync(path);
      this.cache.set(path, {
        content,
        size,
        mtimeMs: stats.mtimeMs,
        cachedAt: Date.now(),
      });
      this.currentBytes += size;
    } catch {
      // If we can't stat the file, don't cache it
    }
  }

  invalidate(path: string): void {
    const entry = this.cache.get(path);
    if (entry) {
      this.currentBytes -= entry.size;
      this.cache.delete(path);
    }
  }

  clear(): void {
    this.cache.clear();
    this.currentBytes = 0;
  }
}

// Global singleton instance for the application
const globalFileCache = new FileCache();

export function getCachedFile(path: string, ttlMs?: number): string | null {
  return globalFileCache.get(path, ttlMs);
}

export function setCachedFile(path: string, content: string): void {
  globalFileCache.set(path, content);
}

export function invalidateCachedFile(path: string): void {
  globalFileCache.invalidate(path);
}

export function clearFileCache(): void {
  globalFileCache.clear();
}

export function readFileCached(path: string, ttlMs?: number): string | null {
  const cached = globalFileCache.get(path, ttlMs);
  if (cached !== null) {
    return cached;
  }

  try {
    const content = readFileSync(path, 'utf-8');
    globalFileCache.set(path, content);
    return content;
  } catch {
    return null;
  }
}

// Factory for tests or isolated caches
export function createFileCache(options?: { maxEntries?: number; maxBytes?: number; ttlMs?: number }): FileCache {
  return new FileCache(options);
}
