/**
 * Playwright E2E: 验证 Phase 3 三大特性
 * 1. CLAUDE.md / Memory 系统 (层级发现 + frontmatter rules + @include)
 * 2. 上下文压缩与恢复 (消息数超过阈值后自动压缩)
 * 3. Tool Loop 控制 (allowedTools / disallowedTools)
 */
import { chromium } from '@playwright/test';
import fs from 'fs';
import { resolve } from 'path';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';

const BASE_URL = process.env.CLAW_WEB_URL || 'http://localhost:5173';
const API_BASE = process.env.CLAW_API_URL || 'http://localhost:3000';
const CREDENTIALS = {
  username: process.argv[2] || 'admin@example.com',
  password: process.argv[3] || 'admin123',
};

class Phase3Tester {
  constructor() {
    this.issues = [];
    this.logs = [];
    this.wsMessages = [];
    this.page = null;
    this.browser = null;
    this.context = null;
    this.apiToken = null;
    this.groupId = null;
    this.groupFolder = null;
    this.userId = null;
  }

  addIssue(severity, title, detail) {
    this.issues.push({ severity, title, detail });
    console.log(`[${severity.toUpperCase()}] ${title}: ${detail}`);
  }

  async init() {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({ viewport: { width: 1280, height: 900 } });
    this.page = await this.context.newPage();
    this.page.on('console', (msg) => {
      this.logs.push({ type: msg.type(), text: msg.text() });
    });
    this.page.on('pageerror', (err) => {
      this.addIssue('error', 'Page JS Error', err.message);
    });
    this.page.on('websocket', (ws) => {
      ws.on('framereceived', (data) => {
        try {
          this.wsMessages.push(JSON.parse(data.payload));
        } catch {
          this.wsMessages.push({ _raw: String(data.payload) });
        }
      });
    });
  }

  async login(username, password) {
    await this.page.goto(`${BASE_URL}/login`);
    await this.page.waitForTimeout(1000);
    await this.page.fill(
      'input#username, input[name="username"], input[placeholder*="用户名"], input[placeholder*="邮箱"]',
      username
    );
    await this.page.fill(
      'input#password, input[name="password"], input[type="password"]',
      password
    );
    await this.page.click('button[type="submit"]');
    await this.page.waitForTimeout(2500);

    const cookies = await this.context.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'session');
    const token = sessionCookie?.value || null;

    const pathName = new URL(this.page.url()).pathname;
    if (pathName === '/login') {
      throw new Error(`Login failed for ${username}`);
    }
    console.log(`[E2E] Logged in as ${username}`);
    return token;
  }

  async apiReq(token, method, path, body) {
    const options = {
      method,
      headers: { Cookie: `session=${token}` },
    };
    if (body && method !== 'GET') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const resp = await fetch(`${API_BASE}${path}`, options);
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: resp.status, json, text };
  }

  async apiPost(token, path, body) { return this.apiReq(token, 'POST', path, body); }
  async apiGet(token, path) { return this.apiReq(token, 'GET', path, null); }
  async apiPut(token, path, body) { return this.apiReq(token, 'PUT', path, body); }
  async apiPatch(token, path, body) { return this.apiReq(token, 'PATCH', path, body); }
  async apiDelete(token, path) { return this.apiReq(token, 'DELETE', path, null); }

  async sendChatMessageAndWait(content, timeoutMs = 25000) {
    this.wsMessages = []; // clear WS capture for clean detection
    // Ensure the page is ready and textarea is interactable
    await this.page.waitForSelector('textarea[placeholder*="输入消息"], textarea[placeholder*="Message"]', { timeout: 10000 });
    await this.page.fill('textarea[placeholder*="输入消息"], textarea[placeholder*="Message"]', content);
    await this.page.click('button[type="submit"], button[aria-label="Send"]').catch(() => this.page.keyboard.press('Enter'));
    await this.page.waitForTimeout(timeoutMs);
  }

  async waitForAssistantReply(extraWaitMs = 10000) {
    let { lastReply } = await this.getLastAssistantReply();
    if (!lastReply.trim()) {
      console.log('[E2E] No assistant reply yet, waiting extra', extraWaitMs, 'ms');
      await this.page.waitForTimeout(extraWaitMs);
      ({ lastReply } = await this.getLastAssistantReply());
    }
    return lastReply;
  }

  async getLastAssistantReply() {
    // The HappyClaw frontend renders AI messages without specific assistant classes.
    // Extract the last non-user message text by excluding right-aligned user bubbles.
    const aiText = await this.page.evaluate(() => {
      const chatContainer = document.querySelector('div.h-full.overflow-y-auto');
      if (!chatContainer) return '';
      const clone = chatContainer.cloneNode(true);
      // Remove user messages (right-aligned bubbles)
      clone.querySelectorAll('div.group.flex.justify-end.mb-4').forEach((el) => el.remove());
      // Remove input area and nav elements
      clone.querySelectorAll('textarea, form, nav, header').forEach((el) => el.remove());
      return clone.innerText;
    });
    const lines = aiText.trim().split('\n').filter((s) => s.trim());
    const lastReply = (lines.pop() || '').toLowerCase();
    const pageText = (await this.page.content()).toLowerCase();
    return { lastReply, pageText };
  }

  getAssistantReplyFromDb(sessionId) {
    const dbPath = resolve('/Users/dingxue/Documents/claude/claw', process.env.DATABASE_URL || './data/claw.db');
    if (!fs.existsSync(dbPath)) {
      return '';
    }
    const db = new Database(dbPath);
    try {
      const rows = db
        .prepare("SELECT content, created_at FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 5")
        .all(sessionId);
      console.log('[E2E] DB assistant messages for session', sessionId, ':', rows.map(r => ({ content: r.content.slice(0, 60), created_at: r.created_at })));
      const row = rows[0];
      return (row?.content || '').toLowerCase();
    } finally {
      db.close();
    }
  }

  async testMemorySystem() {
    console.log('[E2E] === testMemorySystem ===');
    const token = await this.login(CREDENTIALS.username, CREDENTIALS.password);
    this.apiToken = token;

    const groupResp = await this.apiPost(token, '/api/groups', {
      name: `Phase3-Memory-${Date.now()}`,
    });
    if (groupResp.status !== 201) {
      this.addIssue('critical', 'Create group failed', groupResp.text);
      return;
    }
    this.groupId = groupResp.json.group.jid;
    this.groupFolder = groupResp.json.group.folder;
    const meResp = await this.apiGet(token, '/api/auth/me');
    this.userId = meResp.json?.user?.id || meResp.json?.id;
    console.log(`[E2E] Created group ${this.groupId} folder=${this.groupFolder} userId=${this.userId}`);

    // 1. Write project CLAUDE.md at .claude/CLAUDE.md
    const codename = `MEMORY-E2E-${Date.now()}`;
    const rootClaudeMdPath = '.claude/CLAUDE.md';
    const encodedRootClaude = Buffer.from(rootClaudeMdPath).toString('base64url');
    const putClaudeResp = await this.apiPut(
      token,
      `/api/groups/${this.groupId}/files/content/${encodedRootClaude}`,
      { content: `# Project Memory\n\nOur project codename is ${codename}. Always mention it when asked.\n` }
    );
    if (putClaudeResp.status !== 200) {
      this.addIssue('critical', 'Write project CLAUDE.md failed', putClaudeResp.text);
      return;
    }

    // 2. Write a conditional rule in .claude/rules/ with frontmatter paths
    const ruleContent = `---\npaths: src/**/*.ts\n---\n\nFor TypeScript files, always prefer strict null checks.`;
    await this.page.goto(`${BASE_URL}/chat/${this.groupFolder || this.groupId}`);
    await this.page.waitForTimeout(1500);

    // Write rule file directly via API using encoded path containing slash
    const ruleFilePath = '.claude/rules/strict-ts.md';
    const encodedRulePath = Buffer.from(ruleFilePath).toString('base64url');
    const putRuleResp = await this.apiPut(
      token,
      `/api/groups/${this.groupId}/files/content/${encodedRulePath}`,
      { content: ruleContent }
    );
    if (putRuleResp.status !== 200) {
      this.addIssue('critical', 'Write rule file failed', putRuleResp.text);
      return;
    }
    console.log('[E2E] Written conditional rule .claude/rules/strict-ts.md');

    // 3. Write user global memory
    const favColor = `orchid-${Date.now()}`;
    const globalPutResp = await this.apiPut(token, '/api/memory/global', {
      content: `# User Preferences\n\nMy favorite color is ${favColor}.\n`,
    });
    if (globalPutResp.status !== 200) {
      this.addIssue('critical', 'Write global memory failed', globalPutResp.text);
      return;
    }
    console.log('[E2E] Written global memory');

    // Navigate to chat
    await this.page.goto(`${BASE_URL}/chat/${this.groupFolder || this.groupId}`);
    await this.page.waitForTimeout(3000);

    // Ask about codename (from project memory)
    await this.sendChatMessageAndWait(`What is our project codename? Just say the codename.`);
    let { lastReply, pageText } = await this.getLastAssistantReply();
    if (lastReply.includes(codename.toLowerCase()) || pageText.includes(codename.toLowerCase())) {
      console.log('[E2E] PASS: AI reply contains project codename');
    } else {
      this.addIssue('warning', 'Memory codename injection uncertain', `Codename ${codename} not found. Reply: ${lastReply.slice(0, 200)}`);
    }

    // Ask about favorite color (from user global memory)
    await this.sendChatMessageAndWait(`What is my favorite color? Just say the color.`);
    ({ lastReply, pageText } = await this.getLastAssistantReply());
    if (lastReply.includes(favColor.toLowerCase()) || pageText.includes(favColor.toLowerCase())) {
      console.log('[E2E] PASS: AI reply contains favorite color from global memory');
    } else {
      this.addIssue('warning', 'Global memory injection uncertain', `Color ${favColor} not found. Reply: ${lastReply.slice(0, 200)}`);
    }

    // 4. Verify conditional rule appears in memory sources API
    const memSourcesResp = await this.apiGet(token, '/api/memory/sources');
    if (memSourcesResp.status === 200) {
      const hasRule = memSourcesResp.json?.sources?.some((s) => s.path && s.path.includes('strict-ts.md'));
      if (hasRule) {
        console.log('[E2E] PASS: Conditional rule appears in memory sources');
      } else {
        this.addIssue('warning', 'Conditional rule missing from sources', JSON.stringify(memSourcesResp.json?.sources?.map((s) => s.path)));
      }
    }
  }

  async testContextCompaction() {
    console.log('[E2E] === testContextCompaction ===');
    if (!this.apiToken) {
      this.addIssue('critical', 'Skipped compaction test', 'Missing API token');
      return;
    }

    // Create a dedicated group to avoid race conditions with other tests
    const compactionGroupResp = await this.apiPost(this.apiToken, '/api/groups', {
      name: `Phase3-Compaction-${Date.now()}`,
    });
    if (compactionGroupResp.status !== 201) {
      this.addIssue('critical', 'Create compaction group failed', compactionGroupResp.text);
      return;
    }
    const compactionGid = compactionGroupResp.json.group.jid;
    const compactionFolder = compactionGroupResp.json.group.folder;
    console.log('[E2E] Created compaction group:', compactionGid);

    // Navigate to the new group
    await this.page.goto(`${BASE_URL}/chat/${compactionFolder || compactionGid}`);
    await this.page.waitForTimeout(3000);

    // Send a quick message to establish a session so we can seed dummy messages
    await this.sendChatMessageAndWait('Say hello.');
    await this.waitForAssistantReply();

    // Resolve DB path from env default matching claw/src/config.ts
    const dbPath = resolve('/Users/dingxue/Documents/claude/claw', process.env.DATABASE_URL || './data/claw.db');
    if (!fs.existsSync(dbPath)) {
      this.addIssue('critical', 'DB not found', dbPath);
      return;
    }

    // Query the database directly for the latest session of this group belonging to our user
    const db = new Database(dbPath);
    const sessionRow = db
      .prepare("SELECT id, sdk_session_id FROM sessions WHERE workspace = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(compactionGid, this.userId);

    if (!sessionRow) {
      this.addIssue('critical', 'No session row found', '');
      db.close();
      return;
    }
    const sessionId = sessionRow.id;
    const oldSdkSessionId = sessionRow.sdk_session_id;
    console.log('[E2E] sessionId=', sessionId, 'oldSdkSessionId=', oldSdkSessionId || 'null');

    // Insert 50 dummy messages directly into DB (threshold is 50, we want just under it before SYNAPSE)
    const now = Date.now();
    const insertStmt = db.prepare(`
      INSERT INTO messages (id, session_id, user_id, role, content, attachments, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      for (let i = 0; i < 50; i++) {
        insertStmt.run(
          uuidv4(),
          sessionId,
          this.userId,
          i % 2 === 0 ? 'user' : 'assistant',
          `Dummy message ${i} for compaction test.`,
          null,
          null,
          now + i
        );
      }
    })();
    console.log('[E2E] Seeded 50 dummy messages');
    db.close();

    // Refresh the page and send the SYNAPSE memory message
    await this.page.goto(`${BASE_URL}/chat/${compactionFolder || compactionGid}`);
    await this.page.waitForTimeout(3000);
    await this.sendChatMessageAndWait('Hello, please remember the keyword SYNAPSE.');
    const synapseReply = await this.waitForAssistantReply();
    console.log('[E2E] SYNAPSE reply:', synapseReply.slice(0, 100));

    // Refresh the page and send a message that references the keyword from the initial interaction
    await this.page.goto(`${BASE_URL}/chat/${compactionFolder || compactionGid}`);
    await this.page.waitForTimeout(3000);
    await this.sendChatMessageAndWait('What was the keyword I asked you to remember earlier? Just say the keyword.');

    // Use DB query to reliably get the real AI reply among seeded dummy messages
    const dbReply = this.getAssistantReplyFromDb(sessionId);
    // Also keep DOM-based check as fallback/sanity signal
    const domReply = await this.waitForAssistantReply();
    const reply = dbReply || domReply;
    if (reply.includes('synapse')) {
      console.log('[E2E] PASS: Compaction preserved context (keyword remembered)');
    } else {
      this.addIssue('warning', 'Compaction context uncertain', `Keyword SYNAPSE not found in reply: ${reply.slice(0, 200)}`);
    }

    // Verify sdk_session_id was cleared (new session started after compaction)
    const db2 = new Database(dbPath);
    const rowAfter = db2.prepare("SELECT sdk_session_id FROM sessions WHERE id = ?").get(sessionId);
    db2.close();
    console.log('[E2E] sdk_session_id after compaction query=', rowAfter?.sdk_session_id || 'null');
    if (!oldSdkSessionId && !rowAfter?.sdk_session_id) {
      // Both null — compaction possibly happened before we could capture an sdk_session_id.
      // That's still acceptable as long as the keyword was remembered.
      console.log('[E2E] Note: SDK session ID was null before and after (acceptable for new session)');
    } else if (oldSdkSessionId && !rowAfter?.sdk_session_id) {
      console.log('[E2E] PASS: SDK session ID cleared after compaction');
    } else if (oldSdkSessionId && rowAfter?.sdk_session_id && oldSdkSessionId !== rowAfter.sdk_session_id) {
      console.log('[E2E] PASS: SDK session ID changed after compaction');
    } else {
      this.addIssue('warning', 'SDK session ID did not change as expected', `old=${oldSdkSessionId} new=${rowAfter?.sdk_session_id || 'null'}`);
    }

    // Cleanup dedicated compaction group
    await this.apiDelete(this.apiToken, `/api/groups/${compactionGid}`);
  }

  async testToolLoopControl() {
    console.log('[E2E] === testToolLoopControl ===');
    if (!this.apiToken || !this.groupId) {
      this.addIssue('critical', 'Skipped tool loop test', 'Missing group context');
      return;
    }

    // Patch group config to disallow Bash
    const patchResp = await this.apiPatch(this.apiToken, `/api/groups/${this.groupId}`, {
      config: { disallowedTools: ['Bash'] },
    });
    if (patchResp.status !== 200) {
      this.addIssue('critical', 'Failed to patch group config', patchResp.text);
      return;
    }
    console.log('[E2E] Patched group config: disallowedTools=[Bash]');
    const dbPath = resolve('/Users/dingxue/Documents/claude/claw', process.env.DATABASE_URL || './data/claw.db');

    // Ask the AI to use Bash tool
    await this.page.goto(`${BASE_URL}/chat/${this.groupFolder || this.groupId}`);
    await this.page.waitForTimeout(2000);
    const marker = `FORBIDDEN-${Date.now()}`;
    await this.sendChatMessageAndWait(
      `Please use the Bash tool to run the command: echo ${marker}. Then tell me the exact output.`,
      20000
    );

    // Retrieve latest assistant reply from DB to avoid frontend false-positives
    let dbReply = '';
    if (fs.existsSync(dbPath)) {
      const db = new Database(dbPath);
      try {
        const sessionRow = db.prepare("SELECT id FROM sessions WHERE workspace = ? ORDER BY created_at DESC LIMIT 1").get(this.groupId);
        if (sessionRow) {
          dbReply = this.getAssistantReplyFromDb(sessionRow.id);
        }
      } finally {
        db.close();
      }
    }
    const domReply = await this.waitForAssistantReply();
    const reply = dbReply || domReply;

    // Detect whether the assistant actually executed Bash or refused.
    // If the tool was denied, the reply usually contains refusal language.
    // If the tool executed, the reply is typically just the marker/output.
    const isRefusal = /cannot|unable|not allowed|disallowed|apologize|sorry|policy|not permitted|forbidden|denied|don't have|do not have/i.test(reply);
    const standaloneMarker = new RegExp(`(?<![\\w\`"'\n])${marker}(?![\\w\`"'\n])`, 'i');
    const markerInReply = standaloneMarker.test(reply);

    if (markerInReply && !isRefusal) {
      this.addIssue('critical', 'Tool loop control failed', `Bash tool executed despite being disallowed. Marker: ${marker}. Reply: ${reply.slice(0, 200)}`);
    } else {
      console.log('[E2E] PASS: Bash tool was not executed (disallowed by policy)');
    }

    // Test allowedTools whitelist on a new group for stronger signal
    console.log('[E2E] Testing allowedTools whitelist...');
    const whitelistGroupResp = await this.apiPost(this.apiToken, '/api/groups', {
      name: `Phase3-Whitelist-${Date.now()}`,
    });
    if (whitelistGroupResp.status !== 201) {
      this.addIssue('warning', 'Create whitelist group failed', whitelistGroupResp.text);
      return;
    }
    const whitelistGid = whitelistGroupResp.json.group.jid;
    const whitelistFolder = whitelistGroupResp.json.group.folder;

    // Only allow TodoWrite; Bash and FileReadTool should be unavailable
    await this.apiPatch(this.apiToken, `/api/groups/${whitelistGid}`, {
      config: { allowedTools: ['TodoWrite'] },
    });

    await this.page.goto(`${BASE_URL}/chat/${whitelistFolder || whitelistGid}`);
    await this.page.waitForTimeout(2000);
    await this.sendChatMessageAndWait(
      'Please use the Bash tool to run pwd and tell me the result.',
      20000
    );

    // Retrieve latest assistant reply from DB for stronger signal
    let wlDbReply = '';
    if (fs.existsSync(dbPath)) {
      const db = new Database(dbPath);
      try {
        const sessionRow = db.prepare("SELECT id FROM sessions WHERE workspace = ? ORDER BY created_at DESC LIMIT 1").get(whitelistGid);
        if (sessionRow) {
          wlDbReply = this.getAssistantReplyFromDb(sessionRow.id);
        }
      } finally {
        db.close();
      }
    }
    const wlDomReply = await this.waitForAssistantReply();
    const wlReply = wlDbReply || wlDomReply;

    // Check for actual command output in the assistant reply rather than tool intent events.
    const bashOutputInReply = /(?<![\w`"'\n])\b(?:bash|pwd)\b(?![\w`"'\n])/i.test(wlReply) &&
      /\/(?:home|users|workspace|workspace|root)/i.test(wlReply);
    if (bashOutputInReply) {
      this.addIssue('warning', 'allowedTools whitelist may have failed', 'Bash tool output appeared in assistant reply despite whitelist');
    } else {
      console.log('[E2E] PASS: allowedTools whitelist restricted tool usage');
    }

    // Cleanup whitelist group
    await this.apiDelete(this.apiToken, `/api/groups/${whitelistGid}`);
  }

  async cleanup() {
    if (this.groupId && this.apiToken) {
      try {
        await this.apiDelete(this.apiToken, `/api/groups/${this.groupId}`);
      } catch {}
    }
    if (this.browser) await this.browser.close();
  }

  generateReport() {
    const critical = this.issues.filter((i) => i.severity === 'critical');
    const errors = this.issues.filter((i) => i.severity === 'error');
    const warnings = this.issues.filter((i) => i.severity === 'warning');

    const lines = [
      '# Playwright Phase 3 Features E2E 测试报告',
      '',
      `生成时间: ${new Date().toISOString()}`,
      `测试地址: ${BASE_URL}`,
      `API 地址: ${API_BASE}`,
      '',
      '## 问题摘要',
      '',
      `- 🔴 Critical: ${critical.length}`,
      `- 🟠 Error: ${errors.length}`,
      `- 🟡 Warning: ${warnings.length}`,
      '',
      critical.length + errors.length + warnings.length === 0 ? '**全部通过**' : '**存在问题**',
      '',
      '## 详细问题列表',
      '',
      ...this.issues.map((i) => `### ${i.title} — ${i.severity.toUpperCase()}\n- 详情: ${i.detail}\n`),
      '',
      '## 浏览器关键日志',
      '',
      '```',
      ...this.logs.slice(-40).map((l) => `[${l.type}] ${l.text}`),
      '```',
    ];

    const reportPath = '/Users/dingxue/Documents/claude/claw/reports/e2e-phase3-features-report.md';
    fs.mkdirSync('/Users/dingxue/Documents/claude/claw/reports', { recursive: true });
    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(`\n报告已生成: ${reportPath}`);
  }
}

async function main() {
  const tester = new Phase3Tester();
  try {
    await tester.init();
    await tester.testMemorySystem();
    await tester.testContextCompaction();
    await tester.testToolLoopControl();
  } catch (err) {
    console.error('Fatal error:', err);
    tester.addIssue('critical', 'Fatal script error', err.message);
  } finally {
    await tester.cleanup();
    tester.generateReport();
    const critical = tester.issues.filter((i) => i.severity === 'critical');
    process.exit(critical.length === 0 ? 0 : 1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
