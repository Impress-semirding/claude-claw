import { test, expect, type Page } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RESULTS_DIR = resolve(__dirname, '../../test-results');
mkdirSync(RESULTS_DIR, { recursive: true });

interface LogEntry {
  type: string;
  text: string;
  timestamp: string;
}

interface WsEntry {
  direction: 'in' | 'out';
  data: unknown;
  timestamp: string;
}

const logs: LogEntry[] = [];
const wsMessages: WsEntry[] = [];

function saveLogs(testName: string) {
  const payload = {
    testName,
    consoleLogs: logs,
    wsMessages,
    savedAt: new Date().toISOString(),
  };
  writeFileSync(resolve(RESULTS_DIR, `observation-logs-${testName}.json`), JSON.stringify(payload, null, 2), 'utf-8');
}

async function injectWsInterceptor(page: Page) {
  await page.addInitScript(() => {
    const originalWebSocket = window.WebSocket;
    (window as any)._interceptedWs = [];

    class InterceptedWebSocket extends originalWebSocket {
      private _interceptorQueue: unknown[] = [];

      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', (event) => {
          const record = { direction: 'in', data: event.data, timestamp: new Date().toISOString() };
          ((window as any)._interceptedWs as any[]).push(record);
        });
      }

      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        const record = { direction: 'out', data: String(data), timestamp: new Date().toISOString() };
        ((window as any)._interceptedWs as any[]).push(record);
        return super.send(data);
      }
    }

    (window as any).WebSocket = InterceptedWebSocket;
  });
}

async function collectWsMessages(page: Page) {
  const msgs = await page.evaluate(() => (window as any)._interceptedWs || []);
  for (const m of msgs) {
    try {
      wsMessages.push({
        direction: m.direction,
        data: typeof m.data === 'string' ? JSON.parse(m.data) : m.data,
        timestamp: m.timestamp,
      });
    } catch {
      wsMessages.push({
        direction: m.direction,
        data: m.data,
        timestamp: m.timestamp,
      });
    }
  }
}

async function login(page: Page) {
  await page.goto('/login');
  await expect(page.locator('h1')).toContainText('欢迎使用 ');
  await page.locator('#username').fill('admin@example.com');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: /登录/ }).click();
  await page.waitForURL(/\/chat/);
}

async function createWorkspace(page: Page, name: string) {
  const newWorkspaceBtn = page.getByRole('button', { name: '新工作区' });
  await expect(newWorkspaceBtn).toBeVisible();
  await newWorkspaceBtn.click();

  const dialog = page.locator('role=dialog');
  await expect(dialog).toContainText('新建工作区');
  await dialog.locator('input[placeholder="输入工作区名称"]').fill(name);

  // Switch to host mode
  await dialog.getByRole('button', { name: '高级选项' }).click();
  await dialog.locator('input[type="radio"][value="host"]').check();

  await dialog.getByRole('button', { name: '创建' }).click();
  await dialog.waitFor({ state: 'hidden' });

  await page.waitForURL(/\/chat\/.+/);
  await expect(page.locator('h2.truncate')).toContainText(name);
}

async function sendMessage(page: Page, text: string) {
  const textarea = page.locator('textarea[placeholder="输入消息..."]');
  await expect(textarea).toBeVisible();
  await textarea.fill(text);
  await textarea.press('Enter');
}

test('观察链路：登录 -> 创建工作区 -> 发消息 -> 收集浏览器日志与 WS', async ({ page }) => {
  // Setup log collection
  page.on('console', (msg) => {
    logs.push({
      type: msg.type(),
      text: msg.text(),
      timestamp: new Date().toISOString(),
    });
  });
  page.on('pageerror', (err) => {
    logs.push({
      type: 'pageerror',
      text: err.message,
      timestamp: new Date().toISOString(),
    });
  });

  await injectWsInterceptor(page);

  // 1. Login
  await login(page);
  await collectWsMessages(page);

  // 2. Create workspace
  const workspaceName = `观测-${Date.now()}`;
  await createWorkspace(page, workspaceName);
  await collectWsMessages(page);

  // 3. Send message
  const userMessage = '你好，请简短自我介绍';
  await sendMessage(page, userMessage);
  await collectWsMessages(page);

  // 4. Wait for streaming indicators or reply (up to 90s for real LLM)
  const thinking = page.getByText('正在思考...').first();
  try {
    await expect(thinking).toBeVisible({ timeout: 15000 });
  } catch {
    console.log('No "正在思考..." observed within 15s');
  }

  // Wait for reply to appear or timeout
  await page.waitForTimeout(30000);
  await collectWsMessages(page);

  // Take screenshots
  await page.screenshot({ path: resolve(RESULTS_DIR, 'observation-chat-page.png'), fullPage: true });

  // 5. Save logs
  saveLogs('kimi-real');

  // Also write a summary text for quick reading
  const summaryLines: string[] = [
    '=== Browser Console Logs ===',
    ...logs.map((l) => `[${l.type}] ${l.text}`),
    '',
    '=== WS Messages ===',
    ...wsMessages.map((m) => `[WS ${m.direction}] ${JSON.stringify(m.data)}`),
  ];
  writeFileSync(resolve(RESULTS_DIR, 'observation-summary.txt'), summaryLines.join('\n'), 'utf-8');
});
