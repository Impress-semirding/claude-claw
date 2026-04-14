import { chromium } from 'playwright';

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
  
  page.on('websocket', ws => {
    console.log(`[WS] connected: ${ws.url()}`);
    ws.on('framereceived', data => {
      try {
        const parsed = JSON.parse(data.payload as string);
        if (parsed.type === 'new_message' || parsed.type === 'runner_state' || parsed.type === 'stream_event' || parsed.type === 'error') {
          console.log(`[WS RECV] ${parsed.type}`, JSON.stringify(parsed).slice(0, 400));
        }
      } catch {}
    });
    ws.on('framesent', data => {
      try {
        const parsed = JSON.parse(data.payload as string);
        console.log(`[WS SENT] ${parsed.type}`);
      } catch {}
    });
    ws.on('close', () => console.log(`[WS] closed`));
  });

  await page.goto('http://localhost:5173/chat');
  await page.waitForTimeout(3000);
  
  // Try to dismiss any file manager modal or overlay by pressing Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  
  // Find the textarea - use contenteditable or textarea
  const input = page.locator('textarea, [contenteditable="true"]').first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  
  // Helper to send message and confirm it appears
  const sendMessage = async (text: string) => {
    console.log(`[TEST] Sending: ${text}`);
    await input.fill(text);
    await page.waitForTimeout(200);
    // Try pressing Enter first
    await input.press('Enter');
    await page.waitForTimeout(2000);
    
    // Check if message appeared in chat
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
  
  const ok1 = await sendMessage('测试-A-' + Date.now());
  if (!ok1) {
    console.log('[TEST] Failed to send message 1');
    await page.screenshot({ path: '/tmp/chat_fail1.png', fullPage: true });
    await browser.close();
    return;
  }
  
  await page.screenshot({ path: '/tmp/chat_sent1.png', fullPage: true });
  
  // Wait for assistant reply - look for a new Claude message after our message
  console.log('[TEST] Waiting for first reply...');
  const beforeReplyCount = await page.locator('text=/Claude/').count();
  console.log(`[TEST] Existing Claude messages: ${beforeReplyCount}`);
  
  try {
    await page.waitForFunction(
      (prev) => document.body.innerText.match(/Claude/g)?.length > prev,
      beforeReplyCount,
      { timeout: 60000 }
    );
    console.log('[TEST] First reply received');
  } catch (e) {
    console.log('[TEST] First reply timeout:', (e as Error).message);
  }
  
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/chat_after_reply1.png', fullPage: true });
  
  // Send second message
  const ok2 = await sendMessage('测试-B-' + Date.now());
  if (!ok2) {
    console.log('[TEST] Failed to send message 2');
    await page.screenshot({ path: '/tmp/chat_fail2.png', fullPage: true });
    await browser.close();
    return;
  }
  
  console.log('[TEST] Waiting for second reply...');
  const afterReply1Count = await page.evaluate(() => document.body.innerText.match(/Claude/g)?.length || 0);
  try {
    await page.waitForFunction(
      (prev) => (document.body.innerText.match(/Claude/g)?.length || 0) > prev,
      afterReply1Count,
      { timeout: 60000 }
    );
    console.log('[TEST] Second reply received');
  } catch (e) {
    console.log('[TEST] Second reply timeout:', (e as Error).message);
  }
  
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/chat_after_reply2.png', fullPage: true });
  
  await browser.close();
})();
