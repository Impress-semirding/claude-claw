import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const RESULTS_DIR = resolve('/Users/dingxue/Documents/claude/claw/test-results/ui-audit');
mkdirSync(RESULTS_DIR, { recursive: true });

interface Issue {
  category: 'api' | 'ui' | 'ws' | 'console' | 'navigation';
  message: string;
  details?: any;
  timestamp: string;
}

const issues: Issue[] = [];

function logIssue(category: Issue['category'], message: string, details?: any) {
  const issue = { category, message, details, timestamp: new Date().toISOString() };
  issues.push(issue);
  console.log(`[${category}] ${message}`, details ? JSON.stringify(details).slice(0, 200) : '');
}

async function runAudit() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Capture console and network errors
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      logIssue('console', msg.text(), { type: msg.type(), location: msg.location() });
    }
  });
  page.on('pageerror', err => logIssue('console', err.message, { name: err.name }));
  page.on('response', async res => {
    if (!res.ok() && res.url().includes('/api/')) {
      try {
        const body = await res.text();
        logIssue('api', `${res.request().method()} ${res.url()} -> ${res.status()}`, { status: res.status(), body: body.slice(0, 500) });
      } catch {
        logIssue('api', `${res.request().method()} ${res.url()} -> ${res.status()}`);
      }
    }
  });

  // Intercept WebSocket
  await page.addInitScript(() => {
    const orig = window.WebSocket;
    (window as any)._wsLog = [];
    class Ws extends orig {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', e => {
          ((window as any)._wsLog as any[]).push({ dir: 'in', data: e.data, ts: Date.now() });
        });
        this.addEventListener('error', e => {
          ((window as any)._wsLog as any[]).push({ dir: 'err', data: String(e), ts: Date.now() });
        });
      }
      send(data: any) {
        ((window as any)._wsLog as any[]).push({ dir: 'out', data: String(data), ts: Date.now() });
        return super.send(data);
      }
    }
    window.WebSocket = Ws as any;
  });

  // 1. Login page
  console.log('=== 1. Login page ===');
  await page.goto('http://localhost:5173/login');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: resolve(RESULTS_DIR, '01-login.png') });

  // 2. Login
  console.log('=== 2. Login ===');
  await page.locator('#username').fill('admin@example.com');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: /登录/ }).click();
  await page.waitForURL(/\/chat/, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: resolve(RESULTS_DIR, '02-chat.png') });

  // 3. Create workspace
  console.log('=== 3. Create workspace ===');
  const newWorkspaceBtn = page.getByRole('button', { name: '新工作区' });
  await newWorkspaceBtn.click();
  const dialog = page.locator('role=dialog');
  await dialog.locator('input[placeholder="输入工作区名称"]').fill(`Audit-${Date.now()}`);
  await dialog.getByRole('button', { name: '高级选项' }).click();
  await dialog.locator('input[type="radio"][value="host"]').check();
  await dialog.getByRole('button', { name: '创建' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {
    logIssue('ui', 'Create workspace dialog did not close');
  });
  await page.waitForURL(/\/chat\/.+/, { timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(RESULTS_DIR, '03-workspace-created.png') });

  // 4. Send message
  console.log('=== 4. Send message ===');
  const textarea = page.locator('textarea[placeholder="输入消息..."]');
  await textarea.fill('你好');
  await textarea.press('Enter');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: resolve(RESULTS_DIR, '04-message-sent.png') });

  // 5. Navigate to Settings
  console.log('=== 5. Settings page ===');
  await page.goto('http://localhost:5173/settings');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(RESULTS_DIR, '05-settings.png') });

  // 6. Test registration toggle in settings
  console.log('=== 6. Registration settings ===');
  // Find the "注册设置" or "Registration" section/tab
  const regTab = page.locator('button, a').filter({ hasText: /注册设置|用户注册|Registration/i }).first();
  if (await regTab.isVisible().catch(() => false)) {
    await regTab.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: resolve(RESULTS_DIR, '06-registration-tab.png') });
  }

  // 7. Test IM channels settings
  console.log('=== 7. IM channels settings ===');
  const imTab = page.locator('button, a').filter({ hasText: /消息通道|IM|渠道/i }).first();
  if (await imTab.isVisible().catch(() => false)) {
    await imTab.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: resolve(RESULTS_DIR, '07-im-channels.png') });

    // Try toggling feishu if there's a switch
    const feishuSwitch = page.locator('input[type="checkbox"]').filter({ has: page.locator('..').filter({ hasText: /飞书|Feishu/i }) }).first();
    if (await feishuSwitch.isVisible().catch(() => false)) {
      await feishuSwitch.click();
      await page.waitForTimeout(1000);
    }
  }

  // 8. Test Claude providers settings
  console.log('=== 8. Claude providers ===');
  const claudeTab = page.locator('button, a').filter({ hasText: /Claude|模型| Provider/i }).first();
  if (await claudeTab.isVisible().catch(() => false)) {
    await claudeTab.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: resolve(RESULTS_DIR, '08-claude-providers.png') });
  }

  // 9. Navigate to Tasks
  console.log('=== 9. Tasks page ===');
  await page.goto('http://localhost:5173/tasks');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(RESULTS_DIR, '09-tasks.png') });

  // 10. Navigate to Monitor
  console.log('=== 10. Monitor page ===');
  await page.goto('http://localhost:5173/monitor');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(RESULTS_DIR, '10-monitor.png') });

  // 11. Navigate to Skills
  console.log('=== 11. Skills page ===');
  await page.goto('http://localhost:5173/skills');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(RESULTS_DIR, '11-skills.png') });

  // 12. Navigate to MCP Servers
  console.log('=== 12. MCP Servers page ===');
  await page.goto('http://localhost:5173/mcp-servers');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(RESULTS_DIR, '12-mcp-servers.png') });

  // 13. Navigate to Users (admin)
  console.log('=== 13. Users page ===');
  await page.goto('http://localhost:5173/users');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(RESULTS_DIR, '13-users.png') });

  // 14. Navigate to Memory
  console.log('=== 14. Memory page ===');
  await page.goto('http://localhost:5173/memory');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(RESULTS_DIR, '14-memory.png') });

  // Collect WS log
  const wsLog = await page.evaluate(() => (window as any)._wsLog || []);

  // Save results
  const report = {
    issues,
    wsMessages: wsLog.slice(-50),
    timestamp: new Date().toISOString(),
  };
  writeFileSync(resolve(RESULTS_DIR, 'audit-report.json'), JSON.stringify(report, null, 2), 'utf-8');

  // Summary
  const summary = issues.map(i => `[${i.category}] ${i.message}`).join('\n');
  writeFileSync(resolve(RESULTS_DIR, 'audit-summary.txt'), summary || 'No issues detected.', 'utf-8');

  console.log('\n=== Audit complete ===');
  console.log(`Issues found: ${issues.length}`);
  for (const issue of issues) {
    console.log(`- [${issue.category}] ${issue.message}`);
  }

  await browser.close();
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
