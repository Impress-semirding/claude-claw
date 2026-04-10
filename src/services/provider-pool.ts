/**
 * Provider Pool – multi-key load balancing for Claude API providers.
 *
 * Supports:
 *   - round-robin
 *   - weighted-random
 *   - failover
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
  recoveryIntervalMs: number;
}

interface ProviderHealth {
  healthy: boolean;
  consecutiveErrors: number;
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
    recoveryIntervalMs: 300_000,
  };
}

const healthStates = new Map<string, ProviderHealth>();

function initHealth(providerId: string): ProviderHealth {
  if (!healthStates.has(providerId)) {
    healthStates.set(providerId, {
      healthy: true,
      consecutiveErrors: 0,
      lastErrorAt: null,
      lastSuccessAt: Date.now(),
      unhealthySince: null,
    });
  }
  return healthStates.get(providerId)!;
}

function isHealthy(health: ProviderHealth, recoveryIntervalMs: number): boolean {
  if (health.healthy) return true;
  if (health.unhealthySince && Date.now() - health.unhealthySince >= recoveryIntervalMs) {
    // Auto-recover after interval
    health.healthy = true;
    health.consecutiveErrors = 0;
    health.unhealthySince = null;
    return true;
  }
  return false;
}

export function getProviderHealth(providerId: string): ProviderHealth {
  return initHealth(providerId);
}

export function resetProviderHealth(providerId: string): void {
  healthStates.set(providerId, {
    healthy: true,
    consecutiveErrors: 0,
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
      if (!isHealthy(health, balancing.recoveryIntervalMs)) continue;
      if (excludeIds?.includes(p.id)) continue;
      candidates.push({ provider: p, secret: secrets[p.id] || {} });
    }

    // If strict filtering leaves nothing, fall back to enabled providers (ignoring health/exclude)
    if (candidates.length === 0) {
      for (const p of enabled) {
        candidates.push({ provider: p, secret: secrets[p.id] || {} });
      }
    }

    return candidates;
  }

  selectProvider(excludeIds?: string[]): { provider: ProviderRecord; secret: ProviderSecretRecord } | undefined {
    const candidates = this.getCandidates(excludeIds);
    if (candidates.length === 0) return undefined;

    const balancing = readJsonConfig('claude-balancing', getDefaultBalancing());

    if (balancing.strategy === 'weighted-random') {
      const totalWeight = candidates.reduce((sum, c) => sum + (c.provider.weight || 1), 0);
      let rnd = Math.random() * totalWeight;
      for (const c of candidates) {
        rnd -= c.provider.weight || 1;
        if (rnd <= 0) return c;
      }
      return candidates[candidates.length - 1];
    }

    if (balancing.strategy === 'failover') {
      return candidates[0];
    }

    // round-robin
    this.roundRobinIndex = (this.roundRobinIndex + 1) % Math.max(candidates.length, 1);
    return candidates[this.roundRobinIndex];
  }

  reportSuccess(providerId: string): void {
    const health = initHealth(providerId);
    health.healthy = true;
    health.consecutiveErrors = 0;
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
      health.healthy = false;
      if (!health.unhealthySince) {
        health.unhealthySince = Date.now();
      }
    }
  }
}

export const providerPool = new ProviderPool();
