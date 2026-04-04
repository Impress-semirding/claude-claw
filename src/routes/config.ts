import { Hono } from 'hono';
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

const configRoutes = new Hono();

// GET /api/config/appearance/public - 获取公开外观配置
configRoutes.get('/appearance/public', async (c) => {
  try {
    const appearance = readConfig('appearance_public', {
      appName: 'HappyClaw',
      aiName: 'Claude',
      aiAvatarEmoji: '🤖',
      aiAvatarColor: '#0d9488',
    });
    return c.json(appearance);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load config' }, 500);
  }
});

// GET /api/config/appearance - 获取外观配置
configRoutes.get('/appearance', authMiddleware, async (c) => {
  try {
    const appearance = readConfig('appearance', {
      appName: 'HappyClaw',
      aiName: 'Claude',
      aiAvatarEmoji: '🤖',
      aiAvatarColor: '#0d9488',
    });
    return c.json(appearance);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load config' }, 500);
  }
});

// PUT /api/config/appearance - 更新外观配置
configRoutes.put('/appearance', authMiddleware, adminMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const current = readConfig('appearance', {});
    writeConfig('appearance', { ...current, ...body });
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update config' }, 500);
  }
});

// GET /api/config/system - 获取系统配置
configRoutes.get('/system', authMiddleware, async (c) => {
  try {
    const system = { ...getDefaultSystemSettings(), ...readConfig('system', {}) };
    return c.json(system);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load config' }, 500);
  }
});

// PUT /api/config/system - 更新系统配置
configRoutes.put('/system', authMiddleware, adminMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const current = readConfig('system', {});
    writeConfig('system', { ...current, ...body });
    return c.json({ ...getDefaultSystemSettings(), ...readConfig('system', {}) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update config' }, 500);
  }
});

// GET /api/config/claude - 获取 Claude 配置 (legacy)
configRoutes.get('/claude', authMiddleware, async (c) => {
  try {
    const providers = readProviders();
    const active = providers.find((p) => p.enabled) || providers[0];
    return c.json({
      model: active?.anthropicModel || appConfig.claude.model,
      maxTurns: appConfig.claude.maxTurns,
      maxBudgetUsd: appConfig.claude.maxBudgetUsd,
      sandboxEnabled: appConfig.claude.sandboxEnabled,
      baseUrl: active?.anthropicBaseUrl || appConfig.claude.baseUrl,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load config' }, 500);
  }
});

// PUT /api/config/claude - 更新 Claude 配置 (legacy)
configRoutes.put('/claude', authMiddleware, adminMiddleware, async (c) => {
  try {
    await c.req.json();
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update config' }, 500);
  }
});

// POST /api/config/claude/test - 测试 Claude 配置
configRoutes.post('/claude/test', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ success: true, message: 'Connection ok' });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Test failed' }, 500);
  }
});

// POST /api/config/claude/apply - 应用 Claude 配置
configRoutes.post('/claude/apply', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ success: true, stoppedCount: 0 });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to apply config' }, 500);
  }
});

// ─── Claude Providers (multi-provider V4) ──────────────────────

// GET /api/config/claude/providers
configRoutes.get('/claude/providers', authMiddleware, adminMiddleware, async (c) => {
  try {
    const providers = readProviders();
    const balancing = readConfig('claude-balancing', getDefaultBalancing());
    const enabledCount = providers.filter((p) => p.enabled).length;
    return c.json({
      providers: providers.map((p) => ({ ...buildProviderPublic(p), health: getHealth(p.id) })),
      balancing,
      enabledCount,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load providers' }, 500);
  }
});

// POST /api/config/claude/providers
configRoutes.post('/claude/providers', authMiddleware, adminMiddleware, async (c) => {
  try {
    const body = await c.req.json();
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

    return c.json({ success: true, id }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create provider' }, 500);
  }
});

// PATCH /api/config/claude/providers/:id
configRoutes.patch('/claude/providers/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const providers = readProviders();
    const idx = providers.findIndex((p) => p.id === id);
    if (idx === -1) return c.json({ error: 'Provider not found' }, 404);

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

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update provider' }, 500);
  }
});

// DELETE /api/config/claude/providers/:id
configRoutes.delete('/claude/providers/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const providers = readProviders().filter((p) => p.id !== id);
    const secrets = readSecrets();
    delete secrets[id];
    writeProviders(providers);
    writeSecrets(secrets);
    healthStates.delete(id);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete provider' }, 500);
  }
});

// POST /api/config/claude/providers/:id/toggle
configRoutes.post('/claude/providers/:id/toggle', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const providers = readProviders();
    const idx = providers.findIndex((p) => p.id === id);
    if (idx === -1) return c.json({ error: 'Provider not found' }, 404);
    providers[idx].enabled = !providers[idx].enabled;
    providers[idx].updatedAt = new Date().toISOString();
    writeProviders(providers);
    return c.json({ success: true, enabled: providers[idx].enabled });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to toggle provider' }, 500);
  }
});

// POST /api/config/claude/providers/:id/reset-health
configRoutes.post('/claude/providers/:id/reset-health', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    healthStates.set(id, {
      profileId: id,
      healthy: true,
      consecutiveErrors: 0,
      lastErrorAt: null,
      lastSuccessAt: Date.now(),
      unhealthySince: null,
      activeSessionCount: 0,
    });
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to reset health' }, 500);
  }
});

// PUT /api/config/claude/providers/:id/secrets
configRoutes.put('/claude/providers/:id/secrets', authMiddleware, adminMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const providers = readProviders();
    const idx = providers.findIndex((p) => p.id === id);
    if (idx === -1) return c.json({ error: 'Provider not found' }, 404);

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

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update secrets' }, 500);
  }
});

// GET /api/config/claude/providers/health
configRoutes.get('/claude/providers/health', authMiddleware, adminMiddleware, async (c) => {
  try {
    const providers = readProviders();
    return c.json({
      statuses: providers.map((p) => getHealth(p.id)),
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load health' }, 500);
  }
});

// PUT /api/config/claude/balancing
configRoutes.put('/claude/balancing', authMiddleware, adminMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const current = readConfig('claude-balancing', getDefaultBalancing());
    writeConfig('claude-balancing', { ...current, ...body });
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update balancing' }, 500);
  }
});

// POST /api/config/claude/oauth/start
configRoutes.post('/claude/oauth/start', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({
      authorizeUrl: 'https://claude.ai/oauth/authorize?client_id=dummy',
      state: randomUUID(),
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to start OAuth' }, 500);
  }
});

// POST /api/config/claude/oauth/callback
configRoutes.post('/claude/oauth/callback', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'OAuth callback failed' }, 500);
  }
});

// GET /api/config/claude/custom-env
configRoutes.get('/claude/custom-env', authMiddleware, adminMiddleware, async (c) => {
  try {
    return c.json(readConfig('claude-custom-env', {}));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load custom env' }, 500);
  }
});

// PUT /api/config/claude/custom-env
configRoutes.put('/claude/custom-env', authMiddleware, adminMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    writeConfig('claude-custom-env', body);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update custom env' }, 500);
  }
});

// IM bindings (stubbed)
function imRoute(provider: string) {
  configRoutes.get(`/user-im/${provider}`, authMiddleware, async (c) => {
    return c.json({ connected: false, provider });
  });
  configRoutes.put(`/user-im/${provider}`, authMiddleware, async (c) => {
    return c.json({ success: true, connected: false, provider });
  });
}

imRoute('feishu');
imRoute('telegram');
imRoute('qq');
imRoute('dingtalk');
imRoute('wechat');

// GET /api/config/user-im/bindings - 获取 IM 绑定列表
configRoutes.get('/user-im/bindings', authMiddleware, async (c) => {
  try {
    return c.json({ bindings: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load bindings' }, 500);
  }
});

// PUT /api/config/user-im/bindings/:imJid - 更新 IM 绑定
configRoutes.put('/user-im/bindings/:imJid', authMiddleware, async (c) => {
  try {
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update binding' }, 500);
  }
});

// GET /api/config/registration - 获取注册配置
configRoutes.get('/registration', authMiddleware, async (c) => {
  try {
    const system = readConfig('system', {});
    return c.json({
      allowRegistration: system.allowRegistration ?? true,
      requireInviteCode: system.requireInviteCode ?? false,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load config' }, 500);
  }
});

// PUT /api/config/registration - 更新注册配置
configRoutes.put('/registration', authMiddleware, adminMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const current = readConfig('system', {});
    writeConfig('system', {
      ...current,
      allowRegistration: body.allowRegistration,
      requireInviteCode: body.requireInviteCode,
    });
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update config' }, 500);
  }
});

export default configRoutes;
