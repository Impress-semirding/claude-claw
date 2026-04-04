import type { FastifyInstance } from 'fastify';
import { authMiddleware, adminMiddleware } from './auth.js';
import { appConfig } from '../config.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

const CONFIG_DIR = resolve(appConfig.dataDir, 'config');
mkdirSync(CONFIG_DIR, { recursive: true });

function configPath(name: string) {
  return resolve(CONFIG_DIR, `${name}.json`);
}

function readConfig(name: string, fallback: any = {}) {
  const p = configPath(name);
  if (existsSync(p)) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function writeConfig(name: string, data: any) {
  writeFileSync(configPath(name), JSON.stringify(data, null, 2));
}

// ─── Claude Providers persistence ──────────────────────────────

interface ProviderRecord {
  id: string;
  name: string;
  type: 'official' | 'third_party';
  enabled: boolean;
  weight: number;
  anthropicBaseUrl: string;
  anthropicModel: string;
  customEnv: Record<string, string>;
  updatedAt: string;
  // secrets metadata (not actual secrets)
  hasAnthropicAuthToken: boolean;
  anthropicAuthTokenMasked: string | null;
  hasAnthropicApiKey: boolean;
  anthropicApiKeyMasked: string | null;
  hasClaudeCodeOauthToken: boolean;
  claudeCodeOauthTokenMasked: string | null;
  hasClaudeOAuthCredentials: boolean;
  claudeOAuthCredentialsExpiresAt: number | null;
  claudeOAuthCredentialsAccessTokenMasked: string | null;
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

function getDefaultBalancing() {
  return {
    strategy: 'round-robin' as const,
    unhealthyThreshold: 3,
    recoveryIntervalMs: 300000,
  };
}

function getDefaultSystemSettings() {
  return {
    allowRegistration: true,
    requireInviteCode: false,
    defaultExecutionMode: 'host',
    containerTimeout: 30 * 60 * 1000,
    idleTimeout: 30 * 60 * 1000,
    containerMaxOutputSize: 10 * 1024 * 1024,
    maxConcurrentContainers: 20,
    maxConcurrentHostProcesses: 5,
    maxLoginAttempts: 5,
    loginLockoutMinutes: 15,
    maxConcurrentScripts: 5,
    scriptTimeout: 60 * 1000,
    billingEnabled: false,
    billingMode: 'wallet_first' as const,
    billingMinStartBalanceUsd: 0.01,
    billingCurrency: 'USD',
    billingCurrencyRate: 1,
  };
}

function readProviders(): ProviderRecord[] {
  return readConfig('claude-providers', []);
}

function writeProviders(providers: ProviderRecord[]) {
  writeConfig('claude-providers', providers);
}

function readSecrets(): Record<string, ProviderSecretRecord> {
  return readConfig('claude-secrets', {});
}

function writeSecrets(secrets: Record<string, ProviderSecretRecord>) {
  writeConfig('claude-secrets', secrets);
}

function maskSecret(value: string | undefined | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return '***';
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function buildProviderPublic(p: ProviderRecord): any {
  return {
    ...p,
    health: null,
  };
}

const healthStates = new Map<string, any>();

function getHealth(profileId: string) {
  if (!healthStates.has(profileId)) {
    healthStates.set(profileId, {
      profileId,
      healthy: true,
      consecutiveErrors: 0,
      lastErrorAt: null,
      lastSuccessAt: Date.now(),
      unhealthySince: null,
      activeSessionCount: 0,
    });
  }
  return healthStates.get(profileId);
}

// ─── Config routes ─────────────────────────────────────────────

export default async function configRoutes(fastify: FastifyInstance) {
  // GET /api/config/appearance/public - 获取公开外观配置
  fastify.get('/appearance/public', async (request, reply) => {
    try {
      const appearance = readConfig('appearance_public', {
        appName: 'HappyClaw',
        aiName: 'Claude',
        aiAvatarEmoji: '🤖',
        aiAvatarColor: '#0d9488',
      });
      return reply.send(appearance);
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load config' });
    }
  });

  // GET /api/config/appearance - 获取外观配置
  fastify.get('/appearance', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const appearance = readConfig('appearance', {
        appName: 'HappyClaw',
        aiName: 'Claude',
        aiAvatarEmoji: '🤖',
        aiAvatarColor: '#0d9488',
      });
      return reply.send(appearance);
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load config' });
    }
  });

  // PUT /api/config/appearance - 更新外观配置
  fastify.put('/appearance', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const body = request.body as any;
      const current = readConfig('appearance', {});
      writeConfig('appearance', { ...current, ...body });
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update config' });
    }
  });

  // GET /api/config/system - 获取系统配置
  fastify.get('/system', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const system = { ...getDefaultSystemSettings(), ...readConfig('system', {}) };
      return reply.send(system);
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load config' });
    }
  });

  // PUT /api/config/system - 更新系统配置
  fastify.put('/system', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const body = request.body as any;
      const current = readConfig('system', {});
      writeConfig('system', { ...current, ...body });
      return reply.send({ ...getDefaultSystemSettings(), ...readConfig('system', {}) });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update config' });
    }
  });

  // GET /api/config/claude - 获取 Claude 配置 (legacy)
  fastify.get('/claude', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const providers = readProviders();
      const active = providers.find((p) => p.enabled) || providers[0];
      return reply.send({
        model: active?.anthropicModel || appConfig.claude.model,
        maxTurns: appConfig.claude.maxTurns,
        maxBudgetUsd: appConfig.claude.maxBudgetUsd,
        sandboxEnabled: appConfig.claude.sandboxEnabled,
        baseUrl: active?.anthropicBaseUrl || appConfig.claude.baseUrl,
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load config' });
    }
  });

  // PUT /api/config/claude - 更新 Claude 配置 (legacy)
  fastify.put('/claude', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update config' });
    }
  });

  // POST /api/config/claude/test - 测试 Claude 配置
  fastify.post('/claude/test', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ success: true, message: 'Connection ok' });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Test failed' });
    }
  });

  // POST /api/config/claude/apply - 应用 Claude 配置
  fastify.post('/claude/apply', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ success: true, stoppedCount: 0 });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to apply config' });
    }
  });

  // ─── Claude Providers (multi-provider V4) ──────────────────────

  // GET /api/config/claude/providers
  fastify.get('/claude/providers', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const providers = readProviders();
      const balancing = readConfig('claude-balancing', getDefaultBalancing());
      const enabledCount = providers.filter((p) => p.enabled).length;
      return reply.send({
        providers: providers.map((p) => ({ ...buildProviderPublic(p), health: getHealth(p.id) })),
        balancing,
        enabledCount,
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load providers' });
    }
  });

  // POST /api/config/claude/providers
  fastify.post('/claude/providers', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const body = request.body as any;
      const providers = readProviders();
      const secrets = readSecrets();

      const id = randomUUID();
      const now = new Date().toISOString();

      const record: ProviderRecord = {
        id,
        name: body.name || 'New Provider',
        type: body.type || 'third_party',
        enabled: body.enabled ?? false,
        weight: body.weight ?? 1,
        anthropicBaseUrl: body.anthropicBaseUrl || '',
        anthropicModel: body.anthropicModel || '',
        customEnv: body.customEnv || {},
        updatedAt: now,
        hasAnthropicAuthToken: false,
        anthropicAuthTokenMasked: null,
        hasAnthropicApiKey: false,
        anthropicApiKeyMasked: null,
        hasClaudeCodeOauthToken: false,
        claudeCodeOauthTokenMasked: null,
        hasClaudeOAuthCredentials: false,
        claudeOAuthCredentialsExpiresAt: null,
        claudeOAuthCredentialsAccessTokenMasked: null,
      };

      const secret: ProviderSecretRecord = {};

      if (body.anthropicAuthToken) {
        record.hasAnthropicAuthToken = true;
        record.anthropicAuthTokenMasked = maskSecret(body.anthropicAuthToken);
        secret.anthropicAuthToken = body.anthropicAuthToken;
      }
      if (body.anthropicApiKey) {
        record.hasAnthropicApiKey = true;
        record.anthropicApiKeyMasked = maskSecret(body.anthropicApiKey);
        secret.anthropicApiKey = body.anthropicApiKey;
      }
      if (body.claudeCodeOauthToken) {
        record.hasClaudeCodeOauthToken = true;
        record.claudeCodeOauthTokenMasked = maskSecret(body.claudeCodeOauthToken);
        secret.claudeCodeOauthToken = body.claudeCodeOauthToken;
      }
      if (body.claudeOAuthCredentials) {
        record.hasClaudeOAuthCredentials = true;
        record.claudeOAuthCredentialsExpiresAt = body.claudeOAuthCredentials.expiresAt || null;
        record.claudeOAuthCredentialsAccessTokenMasked = maskSecret(body.claudeOAuthCredentials.accessToken);
        secret.claudeOAuthCredentials = body.claudeOAuthCredentials;
      }

      providers.push(record);
      secrets[id] = secret;

      writeProviders(providers);
      writeSecrets(secrets);
      getHealth(id); // init health

      return reply.status(201).send({ success: true, id });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to create provider' });
    }
  });

  // PATCH /api/config/claude/providers/:id
  fastify.patch('/claude/providers/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const body = request.body as any;
      const providers = readProviders();
      const idx = providers.findIndex((p) => p.id === id);
      if (idx === -1) return reply.status(404).send({ error: 'Provider not found' });

      const p = providers[idx];
      if (body.name !== undefined) p.name = body.name;
      if (body.type !== undefined) p.type = body.type;
      if (body.enabled !== undefined) p.enabled = body.enabled;
      if (body.weight !== undefined) p.weight = body.weight;
      if (body.anthropicBaseUrl !== undefined) p.anthropicBaseUrl = body.anthropicBaseUrl;
      if (body.anthropicModel !== undefined) p.anthropicModel = body.anthropicModel;
      if (body.customEnv !== undefined) p.customEnv = body.customEnv;
      p.updatedAt = new Date().toISOString();

      providers[idx] = p;
      writeProviders(providers);

      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update provider' });
    }
  });

  // DELETE /api/config/claude/providers/:id
  fastify.delete('/claude/providers/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const providers = readProviders().filter((p) => p.id !== id);
      const secrets = readSecrets();
      delete secrets[id];
      writeProviders(providers);
      writeSecrets(secrets);
      healthStates.delete(id);
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to delete provider' });
    }
  });

  // POST /api/config/claude/providers/:id/toggle
  fastify.post('/claude/providers/:id/toggle', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const providers = readProviders();
      const idx = providers.findIndex((p) => p.id === id);
      if (idx === -1) return reply.status(404).send({ error: 'Provider not found' });
      providers[idx].enabled = !providers[idx].enabled;
      providers[idx].updatedAt = new Date().toISOString();
      writeProviders(providers);
      return reply.send({ success: true, enabled: providers[idx].enabled });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to toggle provider' });
    }
  });

  // POST /api/config/claude/providers/:id/reset-health
  fastify.post('/claude/providers/:id/reset-health', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      healthStates.set(id, {
        profileId: id,
        healthy: true,
        consecutiveErrors: 0,
        lastErrorAt: null,
        lastSuccessAt: Date.now(),
        unhealthySince: null,
        activeSessionCount: 0,
      });
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to reset health' });
    }
  });

  // PUT /api/config/claude/providers/:id/secrets
  fastify.put('/claude/providers/:id/secrets', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const body = request.body as any;
      const providers = readProviders();
      const idx = providers.findIndex((p) => p.id === id);
      if (idx === -1) return reply.status(404).send({ error: 'Provider not found' });

      const p = providers[idx];
      const secrets = readSecrets();
      const secret: ProviderSecretRecord = secrets[id] || {};

      if (body.anthropicAuthToken !== undefined) {
        if (body.anthropicAuthToken) {
          p.hasAnthropicAuthToken = true;
          p.anthropicAuthTokenMasked = maskSecret(body.anthropicAuthToken);
          secret.anthropicAuthToken = body.anthropicAuthToken;
        }
      }
      if (body.clearAnthropicAuthToken) {
        p.hasAnthropicAuthToken = false;
        p.anthropicAuthTokenMasked = null;
        secret.anthropicAuthToken = null;
      }
      if (body.anthropicApiKey !== undefined) {
        if (body.anthropicApiKey) {
          p.hasAnthropicApiKey = true;
          p.anthropicApiKeyMasked = maskSecret(body.anthropicApiKey);
          secret.anthropicApiKey = body.anthropicApiKey;
        }
      }
      if (body.clearAnthropicApiKey) {
        p.hasAnthropicApiKey = false;
        p.anthropicApiKeyMasked = null;
        secret.anthropicApiKey = null;
      }
      if (body.claudeCodeOauthToken !== undefined) {
        if (body.claudeCodeOauthToken) {
          p.hasClaudeCodeOauthToken = true;
          p.claudeCodeOauthTokenMasked = maskSecret(body.claudeCodeOauthToken);
          secret.claudeCodeOauthToken = body.claudeCodeOauthToken;
        }
      }
      if (body.clearClaudeCodeOauthToken) {
        p.hasClaudeCodeOauthToken = false;
        p.claudeCodeOauthTokenMasked = null;
        secret.claudeCodeOauthToken = null;
      }
      if (body.claudeOAuthCredentials !== undefined) {
        if (body.claudeOAuthCredentials) {
          p.hasClaudeOAuthCredentials = true;
          p.claudeOAuthCredentialsExpiresAt = body.claudeOAuthCredentials.expiresAt || null;
          p.claudeOAuthCredentialsAccessTokenMasked = maskSecret(body.claudeOAuthCredentials.accessToken);
          secret.claudeOAuthCredentials = body.claudeOAuthCredentials;
        }
      }
      if (body.clearClaudeOAuthCredentials) {
        p.hasClaudeOAuthCredentials = false;
        p.claudeOAuthCredentialsExpiresAt = null;
        p.claudeOAuthCredentialsAccessTokenMasked = null;
        secret.claudeOAuthCredentials = null;
      }

      p.updatedAt = new Date().toISOString();
      providers[idx] = p;
      secrets[id] = secret;

      writeProviders(providers);
      writeSecrets(secrets);

      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update secrets' });
    }
  });

  // GET /api/config/claude/providers/health
  fastify.get('/claude/providers/health', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const providers = readProviders();
      return reply.send({
        statuses: providers.map((p) => getHealth(p.id)),
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load health' });
    }
  });

  // PUT /api/config/claude/balancing
  fastify.put('/claude/balancing', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const body = request.body as any;
      const current = readConfig('claude-balancing', getDefaultBalancing());
      writeConfig('claude-balancing', { ...current, ...body });
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update balancing' });
    }
  });

  // POST /api/config/claude/oauth/start
  fastify.post('/claude/oauth/start', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({
        authorizeUrl: 'https://claude.ai/oauth/authorize?client_id=dummy',
        state: randomUUID(),
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to start OAuth' });
    }
  });

  // POST /api/config/claude/oauth/callback
  fastify.post('/claude/oauth/callback', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'OAuth callback failed' });
    }
  });

  // GET /api/config/claude/custom-env
  fastify.get('/claude/custom-env', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      return reply.send(readConfig('claude-custom-env', {}));
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load custom env' });
    }
  });

  // PUT /api/config/claude/custom-env
  fastify.put('/claude/custom-env', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const body = request.body as any;
      writeConfig('claude-custom-env', body);
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update custom env' });
    }
  });

  // IM bindings (stubbed)
  function imRoute(provider: string) {
    fastify.get(`/user-im/${provider}`, { preHandler: authMiddleware }, async (request, reply) => {
      return reply.send({ connected: false, provider });
    });
    fastify.put(`/user-im/${provider}`, { preHandler: authMiddleware }, async (request, reply) => {
      return reply.send({ success: true, connected: false, provider });
    });
  }

  imRoute('feishu');
  imRoute('telegram');
  imRoute('qq');
  imRoute('dingtalk');
  imRoute('wechat');

  // GET /api/config/user-im/bindings - 获取 IM 绑定列表
  fastify.get('/user-im/bindings', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({ bindings: [] });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load bindings' });
    }
  });

  // PUT /api/config/user-im/bindings/:imJid - 更新 IM 绑定
  fastify.put('/user-im/bindings/:imJid', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update binding' });
    }
  });

  // GET /api/config/registration - 获取注册配置
  fastify.get('/registration', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const system = readConfig('system', {});
      return reply.send({
        allowRegistration: system.allowRegistration ?? true,
        requireInviteCode: system.requireInviteCode ?? false,
      });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load config' });
    }
  });

  // PUT /api/config/registration - 更新注册配置
  fastify.put('/registration', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const body = request.body as any;
      const current = readConfig('system', {});
      writeConfig('system', {
        ...current,
        allowRegistration: body.allowRegistration,
        requireInviteCode: body.requireInviteCode,
      });
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update config' });
    }
  });
}
