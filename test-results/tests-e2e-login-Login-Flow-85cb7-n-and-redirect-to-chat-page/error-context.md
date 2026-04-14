# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/e2e/login.spec.ts >> Login Flow >> should login and redirect to chat page
- Location: tests/e2e/login.spec.ts:14:3

# Error details

```
Error: expect(received).toHaveLength(expected)

Expected length: 0
Received length: 1
Received array:  ["Failed to load resource: the server responded with a status of 401 (Unauthorized)"]
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - region "Notifications alt+T":
    - list:
      - listitem [ref=e3]:
        - img [ref=e5]
        - generic [ref=e9]: 已恢复连接
  - generic [ref=e10]:
    - generic [ref=e12]:
      - navigation [ref=e13]:
        - img "HappyClaw" [ref=e15]
        - button "工作台" [ref=e16]:
          - img [ref=e17]
          - generic [ref=e19]: 工作台
        - link "Skill" [ref=e20] [cursor=pointer]:
          - /url: /skills
          - img [ref=e21]
          - generic [ref=e23]: Skill
        - link "任务" [ref=e24] [cursor=pointer]:
          - /url: /tasks
          - img [ref=e25]
          - generic [ref=e28]: 任务
        - link "设置" [ref=e29] [cursor=pointer]:
          - /url: /settings
          - img [ref=e30]
          - generic [ref=e33]: 设置
        - button [ref=e34]:
          - img [ref=e35]
        - button "🐭" [ref=e44] [cursor=pointer]:
          - generic [ref=e46]: 🐭
      - generic [ref=e48]:
        - generic [ref=e49]:
          - img "HappyClaw" [ref=e50]
          - button [ref=e51] [cursor=pointer]:
            - img [ref=e52]
        - button "新工作区" [ref=e56]:
          - img
          - text: 新工作区
        - generic [ref=e58]:
          - generic [ref=e59]: 我的工作区
          - generic [ref=e60]:
            - generic [ref=e61]: 更早
            - generic [ref=e62]:
              - button "我的claw" [ref=e63] [cursor=pointer]:
                - generic [ref=e65]: 我的claw
              - button [ref=e67] [cursor=pointer]:
                - img [ref=e68]
    - main [ref=e73]
```

# Test source

```ts
  1  | /**
  2  |  * E2E Test: HappyClaw Web + Claw Backend Login Flow
  3  |  *
  4  |  * Run with: npx playwright test e2e/login.spec.ts --headed
  5  |  */
  6  | 
  7  | import { test, expect } from '@playwright/test';
  8  | 
  9  | const BASE_URL = 'http://localhost:5173';
  10 | const TEST_USER = 'admin@example.com';
  11 | const TEST_PASS = 'admin123';
  12 | 
  13 | test.describe('Login Flow', () => {
  14 |   test('should login and redirect to chat page', async ({ page }) => {
  15 |     // Collect console errors
  16 |     const consoleErrors: string[] = [];
  17 |     const consoleLogs: string[] = [];
  18 |     page.on('console', (msg) => {
  19 |       const text = msg.text();
  20 |       consoleLogs.push(`[${msg.type()}] ${text}`);
  21 |       if (msg.type() === 'error') {
  22 |         consoleErrors.push(text);
  23 |       }
  24 |     });
  25 |     page.on('pageerror', (err) => {
  26 |       consoleErrors.push(err.message);
  27 |     });
  28 | 
  29 |     // 1. Open web frontend
  30 |     await page.goto(BASE_URL);
  31 |     await page.waitForLoadState('networkidle');
  32 |     await page.screenshot({ path: '/Users/dingxue/Documents/claude/claw/e2e/screenshots/01-initial.png', fullPage: true });
  33 | 
  34 |     // 2. Ensure we're on the login page (if already logged in, logout first)
  35 |     const url = page.url();
  36 |     if (!url.includes('/login')) {
  37 |       // Already logged in or on some other page
  38 |       if (url.includes('/chat') || url.includes('/setup')) {
  39 |         // Logout via API then reload
  40 |         await page.evaluate(async () => {
  41 |           await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  42 |         });
  43 |         await page.goto(`${BASE_URL}/login`);
  44 |         await page.waitForLoadState('networkidle');
  45 |       }
  46 |     }
  47 | 
  48 |     await expect(page).toHaveURL(/\/login/);
  49 | 
  50 |     // 3. Fill in credentials
  51 |     const usernameInput = page.locator('input[name="username"], input[type="text"]').first();
  52 |     const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
  53 |     const loginButton = page.locator('button[type="submit"]').first();
  54 | 
  55 |     await usernameInput.fill(TEST_USER);
  56 |     await passwordInput.fill(TEST_PASS);
  57 |     await page.screenshot({ path: '/Users/dingxue/Documents/claude/claw/e2e/screenshots/02-filled.png', fullPage: true });
  58 | 
  59 |     // 4. Submit form
  60 |     await loginButton.click();
  61 | 
  62 |     // 5. Wait for navigation to dashboard/chat/setup
  63 |     await page.waitForURL(/\/(chat|setup|settings)/, { timeout: 15000 });
  64 |     await page.waitForLoadState('networkidle');
  65 |     await page.screenshot({ path: '/Users/dingxue/Documents/claude/claw/e2e/screenshots/03-logged-in.png', fullPage: true });
  66 | 
  67 |     // 6. Verify no critical console errors
  68 |     const criticalErrors = consoleErrors.filter(
  69 |       (e) => !e.includes('favicon') && !e.includes('Source map') && !e.includes('React Router Future')
  70 |     );
  71 | 
  72 |     console.log('=== Console Logs ===');
  73 |     consoleLogs.forEach((l) => console.log(l));
  74 |     console.log('=== Console Errors ===');
  75 |     consoleErrors.forEach((e) => console.error(e));
  76 | 
> 77 |     expect(criticalErrors).toHaveLength(0);
     |                            ^ Error: expect(received).toHaveLength(expected)
  78 |   });
  79 | });
  80 | 
```