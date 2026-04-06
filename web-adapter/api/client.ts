/*
 * @Date: 2026-03-31 23:13:45
 * @Author: dingxue
 * @Description: 
 * @LastEditTime: 2026-03-31 23:14:06
 */
/**
 * HappyClaw Web 前端适配器 - API 客户端
 * 将 HappyClaw 的 API 调用映射到 Claw 后端
 */

// @ts-ignore
const API_BASE_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_CLAW_API_URL) || 'http://localhost:3000';
const REQUEST_TIMEOUT_MS = 8000;

export interface ApiError {
  status: number;
  message: string;
  body?: Record<string, unknown>;
}

export async function apiFetch<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const requestPath = path.startsWith('http') ? path : `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const { timeoutMs: customTimeout, ...fetchOptions } = options ?? {};
  const controller = new AbortController();
  const isFormData = fetchOptions.body instanceof FormData;
  const timeoutMs = customTimeout ?? (isFormData ? 120_000 : REQUEST_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('claw_token') : null;
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const hasBody = fetchOptions.body !== undefined && fetchOptions.body !== null;
  const headers = isFormData
    ? { ...authHeaders, ...fetchOptions.headers }
    : hasBody
      ? { 'Content-Type': 'application/json', ...authHeaders, ...fetchOptions.headers }
      : { ...authHeaders, ...fetchOptions.headers };

  let res: Response;
  try {
    res = await fetch(requestPath, {
      credentials: 'include',
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw { status: 408, message: 'Request timeout' } as ApiError;
    }
    throw { status: 0, message: 'Network error' } as ApiError;
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { status: res.status, message: body.error || res.statusText, body } as ApiError;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown, timeoutMs?: number) => 
    apiFetch<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined, ...(timeoutMs ? { timeoutMs } : {}) }),
  put: <T>(path: string, body?: unknown) => 
    apiFetch<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) => 
    apiFetch<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};
