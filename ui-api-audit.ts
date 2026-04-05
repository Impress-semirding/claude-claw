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
  timestamp: string;
}

const apiCalls: ApiCall[] = [];
const issues: string[] = [];

function logIssue(msg: string) {
  issues.push(msg);
  console.log(`❌ ${msg}`);
}

async function runAudit() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Intercept all API calls
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
    apiCalls.push({
      method: req.method(),
      url,
      status: res.status(),
      requestBody: reqBody,
      responseBody: resBody,
      timestamp: new Date().toISOString(),
    });
    if (!res.ok() && res.status() !== 304) {
      logIssue(`${req.method()} ${url} -> ${res.status()}: ${JSON.stringify(resBody).slice(0, 200)}`);
    }
  });

  // 1. Login
  await page.goto('http://localhost:5173/login');
  await page.waitForLoadState('networkidle');
  await page.locator('#username').fill('admin@example.com');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: /登录/ }).click();
  await page.waitForURL(/\/chat/, { timeout: 15000 });

  // 2. Settings page
  await page.goto('http://localhost:5173/settings');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // 3. Registration tab
  console.log('=== Testing Registration settings ===');
  const regTab = page.locator('button, a').filter({ hasText: /注册设置|用户注册|Registration/i }).first();
  if (await regTab.isVisible().catch(() => false)) {
    await regTab.click();
    await page.waitForTimeout(1500);
    // Try toggling if there's a switch
    const toggle = page.locator('input[type="checkbox"]').first();
    if (await toggle.isVisible().catch(() => false)) {
      const before = apiCalls.length;
      await toggle.click();
      await page.waitForTimeout(1500);
      const after = apiCalls.length;
      if (after === before) {
        // Maybe switch didn't trigger API call (state change only)
      }
      // Toggle back
      await toggle.click();
      await page.waitForTimeout(1000);
    }
  }

  // 4. IM Channels tab
  console.log('=== Testing IM Channels settings ===');
  const imTab = page.locator('button, a').filter({ hasText: /消息通道|IM|渠道/i }).first();
  if (await imTab.isVisible().catch(() => false)) {
    await imTab.click();
    await page.waitForTimeout(1500);

    // Find feishu card and toggle
    const feishuToggle = page.locator('input[type="checkbox"]').filter({
      has: page.locator('xpath=../..').filter({ hasText: /飞书|Feishu/i })
    }).first();
    if (await feishuToggle.isVisible().catch(() => false)) {
      await feishuToggle.click();
      await page.waitForTimeout(1500);
      await feishuToggle.click();
      await page.waitForTimeout(1000);
    } else {
      // Try any visible toggle in IM section
      const anyToggle = page.locator('input[type="checkbox"]').first();
      if (await anyToggle.isVisible().catch(() => false)) {
        await anyToggle.click();
        await page.waitForTimeout(1500);
        await anyToggle.click();
        await page.waitForTimeout(1000);
      }
    }
  }

  // 5. Claude Providers tab
  console.log('=== Testing Claude Providers ===');
  const claudeTab = page.locator('button, a').filter({ hasText: /Claude|模型|Provider/i }).first();
  if (await claudeTab.isVisible().catch(() => false)) {
    await claudeTab.click();
    await page.waitForTimeout(2000);
  }

  // 6. System Settings tab
  console.log('=== Testing System Settings ===');
  const sysTab = page.locator('button, a').filter({ hasText: /系统设置|System|基本设置/i }).first();
  if (await sysTab.isVisible().catch(() => false)) {
    await sysTab.click();
    await page.waitForTimeout(1500);
  }

  // 7. Create workspace and test chat
  console.log('=== Testing Chat Flow ===');
  await page.goto('http://localhost:5173/chat');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

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

  // Save results
  const report = {
    apiCalls,
    issues,
    timestamp: new Date().toISOString(),
  };
  writeFileSync(resolve(RESULTS_DIR, 'api-audit-report.json'), JSON.stringify(report, null, 2), 'utf-8');

  console.log('\n=== API Audit complete ===');
  console.log(`API calls captured: ${apiCalls.length}`);
  console.log(`Issues found: ${issues.length}`);
  for (const issue of issues) {
    console.log(`- ${issue}`);
  }

  // Print interesting API calls
  console.log('\n=== Interesting API calls ===');
  for (const call of apiCalls) {
    console.log(`${call.method} ${call.url} -> ${call.status}`);
    if (call.responseBody && typeof call.responseBody === 'object') {
      console.log('  Response:', JSON.stringify(call.responseBody).slice(0, 300));
    }
  }

  await browser.close();
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
