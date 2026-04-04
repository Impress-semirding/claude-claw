/*
 * @Date: 2026-03-31 22:40:17
 * @Author: dingxue
 * @Description: 
 * @LastEditTime: 2026-03-31 22:50:32
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { existsSync } from 'fs';

// Load .env file if exists
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  config({ path: envPath });
}

export const appConfig = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  databaseUrl: process.env.DATABASE_URL || './data/claw.db',
  dataDir: process.env.DATA_DIR || './data',

  // Claude SDK
  claude: {
    baseUrl: process.env.CLAUDE_BASE_URL || 'http://127.0.0.1:3456',
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    maxTurns: parseInt(process.env.CLAUDE_MAX_TURNS || '100', 10),
    maxBudgetUsd: parseFloat(process.env.CLAUDE_MAX_BUDGET_USD || '10'),
    sandboxEnabled: process.env.CLAUDE_SANDBOX_ENABLED === 'true',
    baseDir: resolve(process.env.CLAUDE_BASE_DIR || './data/sessions'),
    templateDir: process.env.CLAUDE_TEMPLATE_DIR
      ? resolve(process.env.CLAUDE_TEMPLATE_DIR)
      : undefined,
    maxSessionsPerUser: parseInt(process.env.MAX_SESSIONS_PER_USER || '10', 10),
    maxIdleMs: parseInt(process.env.MAX_IDLE_MS || '30') * 60 * 1000, // 30 minutes
  },

  // Security
  jwtSecret: process.env.JWT_SECRET || 'change-this-in-production',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@example.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',

  // IM Integrations
  im: {
    feishu: {
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET,
      encryptKey: process.env.FEISHU_ENCRYPT_KEY,
      verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
    },
    qq: {
      appId: process.env.QQ_APP_ID,
      secret: process.env.QQ_SECRET,
    },
    dingtalk: {
      appKey: process.env.DINGTALK_APP_KEY,
      appSecret: process.env.DINGTALK_APP_SECRET,
    },
    wechat: {
      appId: process.env.WECHAT_APP_ID,
      secret: process.env.WECHAT_SECRET,
      token: process.env.WECHAT_TOKEN,
      encodingAesKey: process.env.WECHAT_ENCODING_AES_KEY,
    },
  },

  // Paths
  paths: {
    data: resolve('./data'),
    sessions: resolve('./data/sessions'),
    uploads: resolve('./data/uploads'),
    logs: resolve('./logs'),
  },
};

// Ensure directories exist
import { mkdirSync } from 'fs';
[appConfig.paths.data, appConfig.paths.sessions, appConfig.paths.uploads, appConfig.paths.logs].forEach(
  (dir) => {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }
);
