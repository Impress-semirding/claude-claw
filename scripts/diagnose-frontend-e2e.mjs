/**
 * Playwright 前端 E2E 诊断脚本
 * 自动化浏览器：登录、发消息、截图、收集 console errors
 */
import { chromium } from '@playwright/test';

const BASE_URL = process.env.CLAW_WEB_URL || 'http://localhost:5173';
const CREDENTIALS = {
  username: process.argv[2] || 'admin@example.com',
  password: process.argv[3] || 'admin123',
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const consoleLogs = [];
  const wsLogs = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    const text = msg.text();
    const type = msg.type();
    consoleLogs.push({ type, text });
    if (type === 'error' || text.includes('HOOK WS') || text.includes('sendMessage') || text.includes('mergeMessages') || text.includes('messages[')) {
      console.log(`[BROWSER ${type.toUpperCase()}]`, text.slice(0, 500));
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
    console.log('[BROWSER PAGE ERROR]', err.message);
  });

  // Inject WebSocket hook after load
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = function(...args) {
      const ws = new OriginalWebSocket(...args);
      ws.addEventListener('message', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'new_message' || data.type === 'stream_event' || data.type === 'runner_state' || data.type === 'typing') {
            console.log(`[HOOK WS] type=${data.type} chatJid=${data.chatJid}`, JSON.stringify(data));
          }
        } catch {}
      });
      return ws;
    };
    window.WebSocket.prototype = OriginalWebSocket.prototype;
    for (const k of Object.keys(OriginalWebSocket)) {
      if (!(k in window.WebSocket)) {
        window.WebSocket[k] = OriginalWebSocket[k];
      }
    }
  });

  console.log('=== Step 1: Open page ===');
  await page.goto(BASE_URL);
  await page.waitForTimeout(1500);

  // Determine if we need to login
  const currentPath = new URL(page.url()).pathname;
  console.log('Current path:', currentPath);

  if (currentPath.includes('/login') || currentPath === '/') {
    console.log('=== Step 2: Login ===');
    await page.fill('input#username, input[name="username"], input[placeholder*="用户名"], input[type="text"]', CREDENTIALS.username);
    await page.fill('input#password, input[name="password"], input[type="password"]', CREDENTIALS.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
  }

  // Navigate to a workspace if not already in one
  const afterLoginPath = new URL(page.url()).pathname;
  console.log('Path after login:', afterLoginPath);

  if (afterLoginPath === '/chat' || !afterLoginPath.includes('/chat/')) {
    console.log('=== Step 3: Navigate directly to known workspace ===');
    // Use the workspace we validated in the backend diagnostic
    const knownGroupFolder = 'group-6685800d';
    await page.goto(`${BASE_URL}/chat/${knownGroupFolder}`);
    await page.waitForTimeout(2000);
  }

  const chatPath = new URL(page.url()).pathname;
  console.log('Chat path:', chatPath);

  // Try to find textarea and send message
  console.log('=== Step 4: Send message ===');
  const testContent = `diag-${Date.now()}`;

  const textarea = await page.$('textarea[placeholder*="输入"], textarea[placeholder*="发送"], textarea, [contenteditable="true"]');
  if (!textarea) {
    console.error('❌ Cannot find message input textarea');
    await page.screenshot({ path: '/tmp/claw-diag-no-input.png', fullPage: true });
    await browser.close();
    process.exit(1);
  }

  await textarea.fill(testContent);
  await page.keyboard.press('Enter');
  console.log('Typed message:', testContent);

  // Wait for network + rendering
  await page.waitForTimeout(3000);

  // Check if message text appears in page
  const bodyText = await page.evaluate(() => document.body.innerText);
  const messageVisible = bodyText.includes(testContent);

  console.log('=== Step 5: Check visibility ===');
  if (messageVisible) {
    console.log('✅ Message text is visible in DOM immediately after sending');
  } else {
    console.warn('⚠️ Message text NOT visible in DOM after 3s. This reproduces the bug.');
  }

  // Screenshot
  const screenshotPath = '/tmp/claw-diag-after-send.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Screenshot saved to:', screenshotPath);

  // Dump relevant console lines
  console.log('\n=== Relevant Browser Console (last 30) ===');
  const relevant = consoleLogs.filter((l) =>
    l.type === 'error' ||
    l.text.includes('HOOK WS') ||
    l.text.includes('sendMessage') ||
    l.text.includes('mergeMessages') ||
    l.text.includes('messages[') ||
    l.text.includes('localeCompare') ||
    l.text.includes('undefined')
  );
  relevant.slice(-30).forEach((l) => console.log(`[${l.type}]`, l.text.slice(0, 300)));

  console.log('\n=== Summary ===');
  console.log('Message visible immediately:', messageVisible);
  console.log('Page errors count:', pageErrors.length);
  console.log('Total console logs:', consoleLogs.length);

  if (!messageVisible && relevant.length === 0) {
    console.log('\n🔍 No browser console errors. Problem may be in Zustand store update (not triggering re-render).');
  }

  await browser.close();
}

main().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
