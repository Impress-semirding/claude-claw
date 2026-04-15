/**
 * E2E Test: HappyClaw Web + Claw Backend Login Flow
 *
 * Run with: npx playwright test e2e/login.spec.ts --headed
 */

import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = 'http://localhost:5173';
const TEST_USER = 'admin@example.com';
const TEST_PASS = 'admin123';

test.describe('Login Flow', () => {
  test('should login and redirect to chat page', async ({ page }) => {
    // Collect console errors
    const consoleErrors: string[] = [];
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      consoleLogs.push(`[${msg.type()}] ${text}`);
      if (msg.type() === 'error') {
        consoleErrors.push(text);
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });

    // 1. Open web frontend
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: resolve(__dirname, '../../e2e/screenshots/01-initial.png'), fullPage: true });

    // 2. Ensure we're on the login page (if already logged in, logout first)
    const url = page.url();
    if (!url.includes('/login')) {
      // Already logged in or on some other page
      if (url.includes('/chat') || url.includes('/setup')) {
        // Logout via API then reload
        await page.evaluate(async () => {
          await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        });
        await page.goto(`${BASE_URL}/login`);
        await page.waitForLoadState('networkidle');
      }
    }

    await expect(page).toHaveURL(/\/login/);

    // 3. Fill in credentials
    const usernameInput = page.locator('input[name="username"], input[type="text"]').first();
    const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
    const loginButton = page.locator('button[type="submit"]').first();

    await usernameInput.fill(TEST_USER);
    await passwordInput.fill(TEST_PASS);
    await page.screenshot({ path: resolve(__dirname, '../../e2e/screenshots/02-filled.png'), fullPage: true });

    // 4. Submit form
    await loginButton.click();

    // 5. Wait for navigation to dashboard/chat/setup
    await page.waitForURL(/\/(chat|setup|settings)/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: resolve(__dirname, '../../e2e/screenshots/03-logged-in.png'), fullPage: true });

    // 6. Verify no critical console errors
    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('Source map') && !e.includes('React Router Future') && !e.includes('401 (Unauthorized)')
    );

    console.log('=== Console Logs ===');
    consoleLogs.forEach((l) => console.log(l));
    console.log('=== Console Errors ===');
    consoleErrors.forEach((e) => console.error(e));

    expect(criticalErrors).toHaveLength(0);
  });
});
