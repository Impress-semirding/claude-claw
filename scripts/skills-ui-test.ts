import { chromium } from 'playwright';
import { resolve } from 'path';

const issues: string[] = [];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('__name is not defined')) {
      issues.push(msg.text());
      console.log('Console error:', msg.text().slice(0, 200));
    }
  });

  page.on('pageerror', (err) => {
    if (!err.message.includes('__name is not defined')) {
      issues.push(err.message);
      console.log('Page error:', err.message.slice(0, 200));
    }
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/skills')) {
      const text = await res.text();
      console.log('Skills API response:', text.slice(0, 500));
    }
  });

  // Login
  await page.goto('http://localhost:5173/login');
  await page.waitForLoadState('networkidle');
  await page.locator('#username').fill('admin@example.com');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: /登录/ }).click();
  await page.waitForURL(/\/chat/, { timeout: 15000 });

  // Navigate to skills page
  await page.goto('http://localhost:5173/skills');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Take screenshot
  await page.screenshot({ path: resolve('/Users/dingxue/Documents/claude/claw/test-results/ui-audit/skills-page.png') });

  // Check if any skill cards are visible
  const cards = page.locator('button').filter({ has: page.locator('h3') });
  const count = await cards.count();
  console.log(`Found ${count} skill cards`);

  // Check for empty state
  const emptyState = page.locator('text=暂无技能');
  const hasEmpty = await emptyState.isVisible().catch(() => false);
  console.log('Empty state visible:', hasEmpty);

  // Check skill names
  for (let i = 0; i < Math.min(count, 5); i++) {
    const name = await cards.nth(i).locator('h3').textContent().catch(() => null);
    console.log(`Skill ${i}: ${name}`);
  }

  console.log('\nIssues:', issues.length);
  for (const i of issues) console.log('-', i);

  await browser.close();
})().catch(console.error);
