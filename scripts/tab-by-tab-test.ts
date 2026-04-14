import { chromium } from 'playwright';

const tabs = ['Claude 提供商', '注册管理', '全局外观', '系统参数', '个人偏好', '消息通道', '安全与设备', '会话管理', '记忆管理', '技能(Skill)管理', 'MCP 服务器', 'Agent', 'IM 绑定', '用量统计', '系统监控', '用户管理', '关于'];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('__name is not defined')) {
      console.log('Console error:', msg.text().slice(0, 200));
    }
  });

  page.on('pageerror', (err) => {
    if (!err.message.includes('__name is not defined')) {
      console.log('Page error:', err.message.slice(0, 200));
    }
  });

  // Login
  await page.goto('http://localhost:5173/login');
  await page.waitForLoadState('networkidle');
  await page.locator('#username').fill('admin@example.com');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: /登录/ }).click();
  await page.waitForURL(/\/chat/, { timeout: 15000 });

  await page.goto('http://localhost:5173/settings');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  for (const tab of tabs) {
    const btn = page.locator('nav button', { hasText: tab }).first();
    if (await btn.isVisible().catch(() => false)) {
      console.log(`\n=== Clicking tab: ${tab} ===`);
      await btn.click();
      await page.waitForTimeout(1500);
    }
  }

  await browser.close();
})().catch(console.error);
