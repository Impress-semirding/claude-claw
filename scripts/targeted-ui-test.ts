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

(async () => {
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
      logIssue(`${req.method()} ${url} -> ${res.status()}: ${JSON.stringify(resBody).slice(0, 200)}`);
    }
  });

  // Login
  await page.goto('http://localhost:5173/login');
  await page.waitForLoadState('networkidle');
  await page.locator('#username').fill('admin@example.com');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: /登录/ }).click();
  await page.waitForURL(/\/chat/, { timeout: 15000 });

  // Navigate to settings
  await page.goto('http://localhost:5173/settings');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Helper function
  async function clickTab(tabName: string) {
    const btn = page.locator('nav button', { hasText: tabName }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(1000);
      return true;
    }
    return false;
  }

  // 1. Registration tab
  console.log('=== Registration Tab ===');
  if (await clickTab('注册管理')) {
    await page.waitForTimeout(1000);
    // Find toggle switches
    const switches = page.locator('button[role="switch"]');
    const count = await switches.count();
    console.log(`Found ${count} toggle switches`);
    if (count >= 1) {
      await switches.nth(0).click();
      await page.waitForTimeout(1500);
      await switches.nth(0).click(); // toggle back
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: resolve(RESULTS_DIR, 'reg-tab.png') });
  }

  // 2. IM Channels tab
  console.log('=== IM Channels Tab ===');
  if (await clickTab('消息通道')) {
    await page.waitForTimeout(1500);
    // Radix UI Switch is a button[role="switch"]
    const switches = page.locator('button[role="switch"]');
    const count = await switches.count();
    console.log(`Found ${count} toggle switches`);
    // Try clicking the first visible one (Feishu)
    for (let i = 0; i < Math.min(count, 5); i++) {
      const el = switches.nth(i);
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        await page.waitForTimeout(1200);
        await el.click(); // toggle back
        await page.waitForTimeout(800);
        break; // only test one
      }
    }
    await page.screenshot({ path: resolve(RESULTS_DIR, 'im-tab.png') });
  }

  // 3. Claude Providers tab
  console.log('=== Claude Providers Tab ===');
  if (await clickTab('Claude 提供商')) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(RESULTS_DIR, 'claude-tab.png') });
  }

  // 4. System Settings tab
  console.log('=== System Settings Tab ===');
  if (await clickTab('系统参数')) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(RESULTS_DIR, 'system-tab.png') });
  }

  // Save report
  const report = { apiCalls, issues, timestamp: new Date().toISOString() };
  writeFileSync(resolve(RESULTS_DIR, 'targeted-audit-report.json'), JSON.stringify(report, null, 2), 'utf-8');

  console.log('\n=== Targeted Audit complete ===');
  console.log(`API calls: ${apiCalls.length}`);
  console.log(`Issues: ${issues.length}`);

  const configCalls = apiCalls.filter(c => c.url.includes('/api/config/'));
  console.log('\n=== Config API calls ===');
  for (const call of configCalls) {
    console.log(`${call.method} ${call.url} -> ${call.status}`);
    if (call.responseBody && typeof call.responseBody === 'object') {
      console.log('  Response:', JSON.stringify(call.responseBody).slice(0, 400));
    }
  }

  await browser.close();
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
