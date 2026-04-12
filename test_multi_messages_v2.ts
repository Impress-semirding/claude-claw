import { chromium } from 'playwright';

interface PendingReply {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies([{
    name: 'session',
    value: 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiI4ZDQ4ZWM2ZS04MTBmLTRjOTctYjE3OS1jNDFiZDA4MzZkYjIiLCJlbWFpbCI6ImFkbWluQGV4YW1wbGUuY29tIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzc1NjU5NjMyLCJleHAiOjE3NzYyNjQ0MzJ9.8YcoqzhsPB2uwVD4oq1hee5uLYCiZKUffwoEBBM0Yhg',
    domain: 'localhost',
    path: '/',
    httpOnly: true,
  }]);
  const page = await context.newPage();

  page.on('console', msg => console.log(`[CONSOLE ${msg.type()}]`, msg.text()));
  page.on('pageerror', err => console.log(`[PAGE ERROR]`, err.message));

  let pendingReply: PendingReply | null = null;

  page.on('websocket', ws => {
    console.log(`[WS] connected: ${ws.url()}`);
    ws.on('framereceived', data => {
      try {
        const parsed = JSON.parse(data.payload as string);
        if (parsed.type === 'new_message' || parsed.type === 'runner_state' || parsed.type === 'stream_event' || parsed.type === 'error') {
          console.log(`[WS RECV] ${parsed.type}`, JSON.stringify(parsed).slice(0, 400));
        }
        if (parsed.type === 'new_message' && parsed.message?.is_from_me === true) {
          if (pendingReply) {
            clearTimeout(pendingReply.timer);
            pendingReply.resolve();
            pendingReply = null;
          }
        }
      } catch {}
    });
    ws.on('close', () => console.log(`[WS] closed`));
  });

  await page.goto('http://localhost:5173/chat');
  await page.waitForTimeout(3000);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  const input = page.locator('textarea, [contenteditable="true"]').first();
  await input.waitFor({ state: 'visible', timeout: 10000 });

  const sendMessage = async (text: string) => {
    console.log(`[TEST] Sending: ${text}`);
    await input.fill(text);
    await page.waitForTimeout(200);
    await input.press('Enter');
    await page.waitForTimeout(2000);

    const hasMessage = await page.locator('div').filter({ hasText: new RegExp(text) }).count() > 0;
    if (!hasMessage) {
      console.log(`[TEST] Enter didn't work, trying button click`);
      await input.fill(text);
      const btn = page.locator('button').filter({ has: page.locator('svg') }).last();
      await btn.click();
      await page.waitForTimeout(2000);
    }

    const appeared = await page.locator('div').filter({ hasText: new RegExp(text) }).count() > 0;
    console.log(`[TEST] Message appeared: ${appeared}`);
    return appeared;
  };

  const waitForReply = async (timeout = 120000): Promise<boolean> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Reply timeout'));
      }, timeout);
      pendingReply = { resolve: () => resolve(true), reject, timer };
    });
  };

  const messages = [
    '第一条消息-' + Date.now(),
    '第二条消息-' + Date.now(),
    '第三条消息-' + Date.now(),
    '第四条消息-' + Date.now(),
    '第五条消息-' + Date.now(),
  ];

  let allPassed = true;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const ok = await sendMessage(msg);
    if (!ok) {
      console.log(`[TEST] FAILED: message ${i + 1} did not appear in chat`);
      await page.screenshot({ path: `/tmp/chat_fail_msg${i + 1}.png`, fullPage: true });
      allPassed = false;
      break;
    }

    console.log(`[TEST] Waiting for reply ${i + 1}...`);
    try {
      await waitForReply(120000);
      console.log(`[TEST] Reply ${i + 1} received.`);
    } catch (e) {
      console.log(`[TEST] FAILED: reply ${i + 1} timeout`);
      await page.screenshot({ path: `/tmp/chat_fail_reply${i + 1}.png`, fullPage: true });
      allPassed = false;
      break;
    }

    // Small cooldown between messages
    await page.waitForTimeout(1500);
  }

  if (allPassed) {
    console.log('[TEST] ALL MESSAGES PASSED - E2E OK');
  } else {
    console.log('[TEST] E2E FAILED');
  }

  await page.screenshot({ path: '/tmp/chat_final.png', fullPage: true });
  await browser.close();
})();
