import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const RESULTS_DIR = resolve('/Users/dingxue/Documents/claude/claw/test-results/ui-audit');
mkdirSync(RESULTS_DIR, { recursive: true });

interface ApiCall {
  method: string;
  url: string;
  status: number;
  requestBody?: any;
  responseBody?: any;
}

const apiCalls: ApiCall[] = [];
const issues: string[] = [];

function logIssue(msg: string) {
  issues.push(msg);
  console.log(`❌ ${msg}`);
}

async function runAudit() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('/api/')) return;
    const req = res.request();
    let reqBody: any;
    let resBody: any;
    try {
      const postData = req.postData();
      if (postData) reqBody = JSON.parse(postData);
    } catch {}
    try {
      const text = await res.text();
      try { resBody = JSON.parse(text); } catch { resBody = text; }
    } catch {}
    apiCalls.push({ method: req.method(), url, status: res.status(), requestBody: reqBody, responseBody: resBody });
    if (!res.ok() && res.status() !== 304) {
      logIssue(`${req.method()} ${url} -> ${res.status()}: ${JSON.stringify(resBody).slice(0, 300)}`);
    }
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('__name is not defined')) {
        logIssue(`Console error: ${text}`);
      }
    }
  });

  page.on('pageerror', (err) => {
    if (!err.message.includes('__name is not defined')) {
      logIssue(`Page error: ${err.message}`);
    }
  });

  // Login
  console.log('=== 1. Login ===');
  await page.goto('http://localhost:5173/login');
  await page.waitForLoadState('networkidle');
  await page.locator('#username').fill('admin@example.com');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: /登录/ }).click();
  await page.waitForURL(/\/chat/, { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Chat: Create workspace and send message
  console.log('=== 2. Chat: Create workspace & send message ===');
  const newWorkspaceBtn = page.getByRole('button', { name: '新工作区' });
  if (await newWorkspaceBtn.isVisible().catch(() => false)) {
    await newWorkspaceBtn.click();
    const dialog = page.locator('role=dialog');
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.locator('input[placeholder="输入工作区名称"]').fill(`Audit-${Date.now()}`);
      await dialog.getByRole('button', { name: '创建' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const textarea = page.locator('textarea[placeholder="输入消息..."], textarea[placeholder="发送消息..."]').first();
      if (await textarea.isVisible().catch(() => false)) {
        await textarea.fill('你好');
        await textarea.press('Enter');
        await page.waitForTimeout(4000);
      }
    }
  }

  // Settings: navigate through all tabs
  console.log('=== 3. Settings: all tabs ===');
  await page.goto('http://localhost:5173/settings');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  const tabs = ['Claude 提供商', '注册管理', '全局外观', '系统参数', '个人偏好', '消息通道', '安全与设备', '会话管理', '记忆管理', '技能(Skill)管理', 'MCP 服务器', 'Agent', 'IM 绑定', '用量统计', '系统监控', '用户管理', '关于'];
  for (const tab of tabs) {
    const btn = page.locator('nav button', { hasText: tab }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(1200);
    }
  }

  // Tasks
  console.log('=== 4. Tasks page ===');
  await page.goto('http://localhost:5173/tasks');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Monitor
  console.log('=== 5. Monitor page ===');
  await page.goto('http://localhost:5173/monitor');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Skills
  console.log('=== 6. Skills page ===');
  await page.goto('http://localhost:5173/skills');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // MCP Servers
  console.log('=== 7. MCP Servers page ===');
  await page.goto('http://localhost:5173/mcp-servers');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Users
  console.log('=== 8. Users page ===');
  await page.goto('http://localhost:5173/users');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Memory
  console.log('=== 9. Memory page ===');
  await page.goto('http://localhost:5173/memory');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Save report
  const report = { apiCalls, issues, timestamp: new Date().toISOString() };
  writeFileSync(resolve(RESULTS_DIR, 'full-audit-report.json'), JSON.stringify(report, null, 2), 'utf-8');

  // Summary
  console.log('\n=== Full Audit complete ===');
  console.log(`API calls captured: ${apiCalls.length}`);
  console.log(`Issues found: ${issues.length}`);
  for (const issue of issues) {
    console.log(`- ${issue}`);
  }

  // Print unique failing endpoints
  const failing = apiCalls.filter(c => !c.ok && c.status !== 304);
  const uniqueFailing = [...new Map(failing.map(c => [`${c.method} ${new URL(c.url).pathname}`, c])).values()];
  if (uniqueFailing.length > 0) {
    console.log('\n=== Unique failing endpoints ===');
    for (const c of uniqueFailing) {
      console.log(`${c.method} ${new URL(c.url).pathname} -> ${c.status}`);
    }
  }

  await browser.close();
}

runAudit().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
