/**
 * Provider Pool – multi-key load balancing for Claude API providers.
 *
 * Supports:
 *   - round-robin
 *   - weighted-random
 *   - failover
 *   - circuit breaker (consecutive errors / consecutive slow requests)
 *   - p99 latency sliding window
 *   - priority fallback
 *
 * Health tracking marks providers unhealthy after consecutive errors and
 * excludes them from selection until recoveryIntervalMs has passed.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { appConfig } from '../config.js';

interface ProviderRecord {
  id: string;
  name: string;
  enabled: boolean;
  weight: number;
  priority?: number;
  anthropicBaseUrl: string;
  anthropicModel: string;
  customEnv?: Record<string, string>;
}

interface ProviderSecretRecord {
  anthropicAuthToken?: string | null;
  anthropicApiKey?: string | null;
  claudeCodeOauthToken?: string | null;
  claudeOAuthCredentials?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
  } | null;
}

interface BalancingConfig {
  strategy: 'round-robin' | 'weighted-random' | 'failover';
  unhealthyThreshold: number;
  slowThreshold: number;
  recoveryIntervalMs: number;
  latencyWindowMs: number;
  slowLatencyThresholdMs: number;
}

interface ProviderHealth {
  healthy: boolean;
  consecutiveErrors: number;
  consecutiveSlows: number;
  lastErrorAt: number | null;
  lastSuccessAt: number | null;
  unhealthySince: number | null;
}

const CONFIG_DIR = resolve(appConfig.dataDir, 'config');

function configPath(name: string): string {
  return resolve(CONFIG_DIR, `${name}.json`);
}

function readJsonConfig<T>(name: string, fallback: T): T {
  const p = configPath(name);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function readProviders(): ProviderRecord[] {
  return readJsonConfig('claude-providers', []);
}

function readSecrets(): Record<string, ProviderSecretRecord> {
  return readJsonConfig('claude-secrets', {});
}

function getDefaultBalancing(): BalancingConfig {
  return {
    strategy: 'round-robin',
    unhealthyThreshold: 3,
    slowThreshold: 3,
    recoveryIntervalMs: 300_000,
    latencyWindowMs: 600_000,
    slowLatencyThresholdMs: 30_000,
  };
}

const healthStates = new Map<string, ProviderHealth>();
const latencyHistory = new Map<string, Array<{ ts: number; ms: number }>>();

function initHealth(providerId: string): ProviderHealth {
  if (!healthStates.has(providerId)) {
    healthStates.set(providerId, {
      healthy: true,
      consecutiveErrors: 0,
      consecutiveSlows: 0,
      lastErrorAt: null,
      lastSuccessAt: Date.now(),
      unhealthySince: null,
    });
  }
  return healthStates.get(providerId)!;
}

function pruneLatency(providerId: string, windowMs: number) {
  const samples = latencyHistory.get(providerId);
  if (!samples) return;
  const cutoff = Date.now() - windowMs;
  const kept = samples.filter((s) => s.ts >= cutoff);
  if (kept.length === 0) {
    latencyHistory.delete(providerId);
  } else {
    latencyHistory.set(providerId, kept);
  }
}

function getP99Latency(providerId: string): number | null {
  const samples = latencyHistory.get(providerId);
  if (!samples || samples.length === 0) return null;
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.99) - 1;
  return sorted[Math.max(0, idx)];
}

function isHealthy(health: ProviderHealth, balancing: BalancingConfig): boolean {
  if (health.healthy) return true;
  if (health.unhealthySince && Date.now() - health.unhealthySince >= balancing.recoveryIntervalMs) {
    // Auto-recover after interval
    health.healthy = true;
    health.consecutiveErrors = 0;
    health.consecutiveSlows = 0;
    health.unhealthySince = null;
    return true;
  }
  return false;
}

function markUnhealthy(health: ProviderHealth): void {
  health.healthy = false;
  if (!health.unhealthySince) {
    health.unhealthySince = Date.now();
  }
}

export function getProviderHealth(providerId: string): ProviderHealth {
  return initHealth(providerId);
}

export function resetProviderHealth(providerId: string): void {
  healthStates.set(providerId, {
    healthy: true,
    consecutiveErrors: 0,
    consecutiveSlows: 0,
    lastErrorAt: null,
    lastSuccessAt: Date.now(),
    unhealthySince: null,
  });
}

export function listProviderHealth(): Array<ProviderHealth & { providerId: string }> {
  const result: Array<ProviderHealth & { providerId: string }> = [];
  for (const [id, health] of healthStates.entries()) {
    result.push({ providerId: id, ...health });
  }
  return result;
}

class ProviderPool {
  private roundRobinIndex = 0;

  private getCandidates(excludeIds?: string[]): Array<{ provider: ProviderRecord; secret: ProviderSecretRecord }> {
    const providers = readProviders();
    const secrets = readSecrets();
    const balancing = readJsonConfig('claude-balancing', getDefaultBalancing());

    const enabled = providers.filter((p) => p.enabled);
    const candidates: Array<{ provider: ProviderRecord; secret: ProviderSecretRecord }> = [];

    for (const p of enabled) {
      const health = initHealth(p.id);
      if (!isHealthy(health, balancing)) continue;
      if (health.consecutiveSlows >= balancing.slowThreshold) continue;
      pruneLatency(p.id, balancing.latencyWindowMs);
      const p99 = getP99Latency(p.id);
      if (p99 !== null && p99 > balancing.slowLatencyThresholdMs) continue;
      if (excludeIds?.includes(p.id)) continue;
      candidates.push({ provider: p, secret: secrets[p.id] || {} });
    }

    // If strict filtering leaves nothing, fall back to enabled providers (ignoring health/exclude)
    if (candidates.length === 0) {
      for (const p of enabled) {
        candidates.push({ provider: p, secret: secrets[p.id] || {} });
      }
    }

    // Priority fallback: lower number = higher priority
    candidates.sort((a, b) => (a.provider.priority ?? 100) - (b.provider.priority ?? 100));

    return candidates;
  }

  selectProvider(excludeIds?: string[]): { provider: ProviderRecord; secret: ProviderSecretRecord; providerId: string } | undefined {
    const candidates = this.getCandidates(excludeIds);
    if (candidates.length === 0) return undefined;

    const balancing = readJsonConfig('claude-balancing', getDefaultBalancing());

    let selected: { provider: ProviderRecord; secret: ProviderSecretRecord } | undefined;

    if (balancing.strategy === 'weighted-random') {
      const totalWeight = candidates.reduce((sum, c) => sum + (c.provider.weight || 1), 0);
      let rnd = Math.random() * totalWeight;
      for (const c of candidates) {
        rnd -= c.provider.weight || 1;
        if (rnd <= 0) {
          selected = c;
          break;
        }
      }
      if (!selected) selected = candidates[candidates.length - 1];
    } else if (balancing.strategy === 'failover') {
      selected = candidates[0];
    } else {
      // round-robin
      this.roundRobinIndex = (this.roundRobinIndex + 1) % Math.max(candidates.length, 1);
      selected = candidates[this.roundRobinIndex];
    }

    if (!selected) return undefined;
    return { provider: selected.provider, secret: selected.secret, providerId: selected.provider.id };
  }

  reportSuccess(providerId: string): void {
    const health = initHealth(providerId);
    health.healthy = true;
    health.consecutiveErrors = 0;
    health.consecutiveSlows = 0;
    health.lastErrorAt = null;
    health.lastSuccessAt = Date.now();
    health.unhealthySince = null;
  }

  reportError(providerId: string): void {
    const balancing = readJsonConfig('claude-balancing', getDefaultBalancing());
    const health = initHealth(providerId);
    health.consecutiveErrors += 1;
    health.lastErrorAt = Date.now();
    if (health.consecutiveErrors >= balancing.unhealthyThreshold) {
      markUnhealthy(health);
    }
  }

  reportLatency(providerId: string, latencyMs: number): void {
    const balancing = readJsonConfig('claude-balancing', getDefaultBalancing());
    let samples = latencyHistory.get(providerId);
    if (!samples) {
      samples = [];
      latencyHistory.set(providerId, samples);
    }
    samples.push({ ts: Date.now(), ms: latencyMs });
    pruneLatency(providerId, balancing.latencyWindowMs);

    const p99 = getP99Latency(providerId);
    if (p99 !== null && p99 > balancing.slowLatencyThresholdMs) {
      this.reportSlow(providerId);
    }
  }

  reportSlow(providerId: string): void {
    const balancing = readJsonConfig('claude-balancing', getDefaultBalancing());
    const health = initHealth(providerId);
    health.consecutiveSlows += 1;
    if (health.consecutiveSlows >= balancing.slowThreshold) {
      markUnhealthy(health);
    }
  }
}

export const providerPool = new ProviderPool();
