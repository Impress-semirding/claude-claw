export type RetryableErrorCategory = 'rate_limit' | 'server_error' | 'auth_failed' | 'max_tokens' | 'unknown';

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 32000;

export function categorizeError(error: unknown): RetryableErrorCategory {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  if (
    lower.includes('rate_limit') ||
    lower.includes('429') ||
    lower.includes('too many requests')
  ) {
    return 'rate_limit';
  }

  if (
    lower.includes('529') ||
    lower.includes('overloaded') ||
    lower.includes('server error') ||
    lower.includes('503') ||
    lower.includes('502') ||
    lower.includes('504')
  ) {
    return 'server_error';
  }

  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid token') ||
    lower.includes('authentication')
  ) {
    return 'auth_failed';
  }

  if (
    lower.includes('max_tokens') ||
    lower.includes('context limit') ||
    lower.includes('exceed context limit')
  ) {
    return 'max_tokens';
  }

  return 'unknown';
}

export function calculateRetryDelay(
  attempt: number,
  category: RetryableErrorCategory,
  retryAfterMs?: number
): number {
  let delay: number;

  if (category === 'rate_limit' && retryAfterMs !== undefined && retryAfterMs > 0) {
    delay = retryAfterMs;
  } else {
    delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
    delay = Math.min(delay, MAX_DELAY_MS);
  }

  // jitter ±20%
  const jitter = 0.8 + Math.random() * 0.4;
  delay = Math.floor(delay * jitter);

  return delay;
}

export function shouldRetry(
  category: RetryableErrorCategory,
  attempt: number,
  maxAttempts: number
): boolean {
  if (category === 'auth_failed') return false;
  // max_tokens retry is left to the caller to decide
  return attempt < maxAttempts;
}

export function extractRetryAfterMs(error: unknown): number | undefined {
  const msg = error instanceof Error ? error.message : String(error);
  // Look for Retry-After value in milliseconds or seconds
  const msMatch = msg.match(/retry[_\-]after[:\s]+(\d+)/i);
  if (msMatch) {
    const val = parseInt(msMatch[1], 10);
    // Heuristic: if value > 10000 treat as ms, else seconds
    return val > 10000 ? val : val * 1000;
  }
  return undefined;
}
