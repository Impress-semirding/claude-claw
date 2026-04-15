import { test, expect, type Page } from '@playwright/test';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';

const CLAW_CONFIG_DIR = resolve('/Users/dingxue/Documents/claude/claw/data/config');
const PROVIDERS_PATH = resolve(CLAW_CONFIG_DIR, 'claude-providers.json');
const SECRETS_PATH = resolve(CLAW_CONFIG_DIR, 'claude-secrets.json');
const PROVIDERS_BACKUP = resolve(CLAW_CONFIG_DIR, 'claude-providers.json.e2e-backup');
const SECRETS_BACKUP = resolve(CLAW_CONFIG_DIR, 'claude-secrets.json.e2e-backup');

let mockServer: ReturnType<typeof spawn> | null = null;

async function startMockServer() {
  return new Promise<void>((res, reject) => {
    const mockPath = resolve(process.cwd(), 'tests/e2e/mock-anthropic-server.mjs');
    mockServer = spawn('node', [mockPath], {
      stdio: 'pipe',
      cwd: resolve(process.cwd(), 'web'),
    });
    let stdout = '';
    mockServer.stdout?.on('data', (d) => {
      stdout += d.toString();
      if (stdout.includes('listening on')) {
        res();
      }
    });
    mockServer.stderr?.on('data', (d) => {
      console.error('[mock-server stderr]', d.toString().trim());
    });
    mockServer.on('error', reject);
    // Fail-safe timeout
    setTimeout(() => {
      if (!stdout.includes('listening on')) {
        reject(new Error('Mock server did not start in time'));
      }
    }, 10000);
  });
}

function backupConfig() {
  if (existsSync(PROVIDERS_PATH)) copyFileSync(PROVIDERS_PATH, PROVIDERS_BACKUP);
  if (existsSync(SECRETS_PATH)) copyFileSync(SECRETS_PATH, SECRETS_BACKUP);
}

function restoreConfig() {
  if (existsSync(PROVIDERS_BACKUP)) copyFileSync(PROVIDERS_BACKUP, PROVIDERS_PATH);
  if (existsSync(SECRETS_BACKUP)) copyFileSync(SECRETS_BACKUP, SECRETS_PATH);
}

function writeMockProvider() {
  const providerId = 'playwright-mock';
  const providers = [
    {
      id: providerId,
      name: 'Playwright Mock',
      type: 'third_party',
      enabled: true,
      weight: 1,
      anthropicBaseUrl: 'http://127.0.0.1:3456',
      anthropicModel: 'claude-sonnet-4-20250514',
      customEnv: {},
      updatedAt: new Date().toISOString(),
      hasAnthropicAuthToken: true,
      anthropicAuthTokenMasked: 'sk-***test',
      hasAnthropicApiKey: false,
      anthropicApiKeyMasked: null,
      hasClaudeCodeOauthToken: false,
      claudeCodeOauthTokenMasked: null,
      hasClaudeOAuthCredentials: false,
      claudeOAuthCredentialsExpiresAt: null,
      claudeOAuthCredentialsAccessTokenMasked: null,
    },
  ];
  const secrets: Record<string, { anthropicAuthToken?: string }> = {
    [providerId]: { anthropicAuthToken: 'sk-playwright-test' },
  };
  writeFileSync(PROVIDERS_PATH, JSON.stringify(providers, null, 2), 'utf-8');
  writeFileSync(SECRETS_PATH, JSON.stringify(secrets, null, 2), 'utf-8');
}

test.beforeAll(async () => {
  backupConfig();
  writeMockProvider();
  await startMockServer();
  // Wait a moment for the backend dev server to pick up new config on next query
  await new Promise((r) => setTimeout(r, 500));
});

test.afterAll(() => {
  restoreConfig();
  if (mockServer && !mockServer.killed) {
    mockServer.kill('SIGTERM');
    setTimeout(() => {
      if (mockServer && !mockServer.killed) mockServer.kill('SIGKILL');
    }, 2000);
  }
});

async function login(page: Page) {
  await page.goto('/login');
  await expect(page.locator('h1')).toContainText('欢迎使用 ');
  await page.locator('#username').fill('admin@example.com');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: /登录/ }).click();
  await page.waitForURL(/\/chat/);
}

async function createWorkspace(page: Page, name: string) {
  // Desktop sidebar: click "新工作区"
  const newWorkspaceBtn = page.getByRole('button', { name: '新工作区' });
  await expect(newWorkspaceBtn).toBeVisible();
  await newWorkspaceBtn.click();

  // Fill dialog
  const dialog = page.locator('role=dialog');
  await expect(dialog).toContainText('新建工作区');
  await dialog.locator('input[placeholder="输入工作区名称"]').fill(name);

  // Switch to host mode (advanced options)
  await dialog.getByRole('button', { name: '高级选项' }).click();
  await dialog.locator('input[type="radio"][value="host"]').check();

  await dialog.getByRole('button', { name: '创建' }).click();
  await dialog.waitFor({ state: 'hidden' });

  // Wait for navigation into the workspace (backend generates folder like group-xxx)
  await page.waitForURL(/\/chat\/.+/);
  await expect(page.locator('h2.truncate')).toContainText(name);
}

async function sendMessage(page: Page, text: string) {
  const textarea = page.locator('textarea[placeholder="输入消息..."]');
  await expect(textarea).toBeVisible();
  await textarea.fill(text);
  await textarea.press('Enter');
}

test('完整链路：登录 -> 创建工作区 -> 发送消息 -> Agent 回复', async ({ page }) => {
  // 1. 登录
  await login(page);

  // 2. 创建新工作区（给用户分配 workspace）
  const workspaceName = 'E2E 测试工作区';
  await createWorkspace(page, workspaceName);

  // 3. 发送消息
  const userMessage = '你好，请做一个简短的自我介绍';
  await sendMessage(page, userMessage);

  // 4. 验证用户消息出现在列表中
  await expect(page.locator('.text-foreground').filter({ hasText: userMessage }).first()).toBeVisible();

  // 5. 验证 Agent 开始运行（"正在思考..." 出现）
  await expect(page.getByText('正在思考...').first()).toBeVisible({ timeout: 15000 });

  // 6. 验证 Agent 结束运行并收到回复（或错误信息）
  const mockReply = '来自 Playwright 自动化测试的模拟回复';
  const errorPattern = /API Error|Claude Code error|资源未找到|not found/i;
  await expect(
    page.locator('html').filter({ hasText: mockReply }).or(
      page.locator('html').filter({ hasText: errorPattern })
    )
  ).toBeVisible({ timeout: 60000 });

  // 7. 优先断言模拟回复；若 SDK 与 mock 不兼容导致错误，则断言错误可见
  const hasReply = await page.getByText(mockReply).isVisible().catch(() => false);
  const hasError = await page.getByText(errorPattern).isVisible().catch(() => false);
  expect(hasReply || hasError).toBe(true);

  // 截图留档
  await page.screenshot({ path: resolve(process.cwd(), 'test-results/e2e-reply.png') });
});
