import { chromium } from 'playwright';
import { resolve } from 'path';

const issues: string[] = [];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('__name is not defined')) {
      issues.push(msg.text());
      console.log('Console error:', msg.text());
    }
  });

  page.on('pageerror', (err) => {
    if (!err.message.includes('__name is not defined')) {
      issues.push(err.message);
      console.log('Page error:', err.message);
    }
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/auth/sessions')) {
      const text = await res.text();
      console.log('Sessions API:', text.slice(0, 500));
    }
  });

  // Login
  await page.goto('http://localhost:5173/login');
  await page.waitForLoadState('networkidle');
  await page.locator('#username').fill('admin@example.com');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: /登录/ }).click();
  await page.waitForURL(/\/chat/, { timeout: 15000 });

  // Go to settings and Security tab
  await page.goto('http://localhost:5173/settings');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  const secTab = page.locator('nav button', { hasText: '安全与设备' }).first();
  if (await secTab.isVisible().catch(() => false)) {
    await secTab.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: resolve('/Users/dingxue/Documents/claude/claw/test-results/ui-audit/security-tab.png') });
  }

  console.log('\nSecurity tab issues:', issues.length);
  for (const i of issues) console.log('-', i);

  await browser.close();
})().catch(console.error);
