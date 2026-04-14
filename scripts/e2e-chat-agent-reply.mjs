/**
 * Playwright E2E: 验证用户在 Web Chat 中能正确接收 Agent 消息
 * 覆盖：Agent 消息出现在 Agent Tab、不出现在主对话 Tab
 */
import { chromium } from '@playwright/test';
import fs from 'fs';

const BASE_URL = process.env.CLAW_WEB_URL || 'http://localhost:5173';
const API_BASE = process.env.CLAW_API_URL || 'http://localhost:3000';
const CREDENTIALS = {
  username: process.argv[2] || 'admin@example.com',
  password: process.argv[3] || 'admin123',
};

class ChatAgentTester {
  constructor() {
    this.issues = [];
    this.logs = [];
    this.page = null;
    this.browser = null;
    this.context = null;
    this.apiToken = null;
    this.groupId = null;
    this.agentId = null;
    this.agentName = null;
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

    // Hook WebSocket to observe agentId routing
    await this.page.addInitScript(() => {
      const OriginalWebSocket = window.WebSocket;
      window.WebSocket = function (...args) {
        const ws = new OriginalWebSocket(...args);
        ws.addEventListener('message', (e) => {
          try {
            const data = JSON.parse(e.data);
            if (['new_message', 'stream_event', 'runner_state', 'typing'].includes(data.type)) {
              console.log(
                `[HOOK WS] type=${data.type} chatJid=${data.chatJid} agentId=${data.agentId || ''}`,
                JSON.stringify(data).slice(0, 600)
              );
            }
            window.__wsMessages = window.__wsMessages || [];
            window.__wsMessages.push(data);
          } catch {}
        });
        return ws;
      };
      window.WebSocket.prototype = OriginalWebSocket.prototype;
      for (const k of Object.keys(OriginalWebSocket)) {
        if (!(k in window.WebSocket)) window.WebSocket[k] = OriginalWebSocket[k];
      }
    });
  }

  async login() {
    await this.page.goto(`${BASE_URL}/login`);
    await this.page.waitForTimeout(1000);
    await this.page.fill(
      'input#username, input[name="username"], input[placeholder*="用户名"], input[placeholder*="邮箱"]',
      CREDENTIALS.username
    );
    await this.page.fill(
      'input#password, input[name="password"], input[type="password"]',
      CREDENTIALS.password
    );
    await this.page.click('button[type="submit"]');
    await this.page.waitForTimeout(2500);

    const cookies = await this.context.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'session');
    this.apiToken = sessionCookie?.value || null;

    const path = new URL(this.page.url()).pathname;
    if (path === '/login') {
      throw new Error('Login failed');
    }
    console.log('[E2E] Logged in');
  }

  async apiPost(path, body) {
    const resp = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${this.apiToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`API POST ${path} failed: ${resp.status}`);
    return resp.json();
  }

  async testUserChatReceivesAgentMessages() {
    console.log('[E2E] === testUserChatReceivesAgentMessages ===');

    // 1. Create group and agent via API
    const group = await this.apiPost('/api/groups', {
      name: `E2E ChatAgent ${Date.now()}`,
    });
    this.groupId = group.group.jid;
    const folder = group.group.folder;
    console.log(`[E2E] Created group ${this.groupId}`);

    this.agentName = `TestAgent-${Date.now()}`;
    const agent = await this.apiPost(`/api/groups/${this.groupId}/agents`, {
      name: this.agentName,
      prompt: 'You are a test assistant. Keep replies very short.',
      kind: 'conversation',
    });
    this.agentId = agent.agent.id;
    console.log(`[E2E] Created agent ${this.agentId} name=${this.agentName}`);

    // 2. Navigate to group in browser
    await this.page.goto(`${BASE_URL}/chat/${folder || this.groupId}`);
    await this.page.waitForTimeout(2000);

    // 3. Click the agent tab
    const agentTab = this.page.locator('text=' + this.agentName).first();
    if (!(await agentTab.isVisible().catch(() => false))) {
      this.addIssue('critical', 'Agent tab not visible', `Agent tab "${this.agentName}" not found in UI`);
      return;
    }
    await agentTab.click();
    await this.page.waitForTimeout(500);
    console.log('[E2E] Switched to agent tab');

    // 4. Send a unique message to the agent via browser UI
    const uniqueMsg = `agent-browser-test-${Date.now()}`;
    await this.page.fill('textarea[placeholder="输入消息..."]', uniqueMsg);
    // Press Enter to send (textarea handles Enter key for sending)
    await this.page.keyboard.press('Enter');
    console.log(`[E2E] Sent message to agent: ${uniqueMsg}`);

    // 5. Wait for the user message to appear in agent tab
    await this.page.waitForTimeout(2000);
    const agentHasUserMsg = await this.page.locator('text=' + uniqueMsg).first().isVisible().catch(() => false);
    if (!agentHasUserMsg) {
      this.addIssue('critical', 'Agent tab missing user message', `User message "${uniqueMsg}" not visible in agent tab`);
    } else {
      console.log('[E2E] Agent tab shows user message: OK');
    }

    // 6. Wait for agent reply to appear in agent tab (up to 25s)
    let agentReplyText = '';
    for (let i = 0; i < 25; i++) {
      await this.page.waitForTimeout(1000);
      // Check if any assistant content appeared by looking for non-user-message content
      // We look for text that is NOT our sent message - indicating an assistant reply
      const pageText = await this.page.locator('body').innerText().catch(() => '');
      if (pageText.length > uniqueMsg.length + 200) {
        // There should be more text than just our message and UI chrome
        // Try to extract what looks like an assistant reply
        const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean);
        const replyLine = lines.find(l => l.includes('agent-browser-test-') === false && l.length > 5 && !l.includes(this.agentName) && !l.includes('主对话') && !l.includes('输入消息'));
        if (replyLine) {
          agentReplyText = replyLine;
          break;
        }
      }
      // Also check if streaming display is active (the pulsing AI indicator)
      const streamingActive = await this.page.locator('[class*="streaming"], [class*="animate-pulse"]').first().isVisible().catch(() => false);
      if (!streamingActive && i > 5) {
        // May have finished; do one more text check
        const pageText2 = await this.page.locator('body').innerText().catch(() => '');
        const lines2 = pageText2.split('\n').map(l => l.trim()).filter(Boolean);
        const replyLine2 = lines2.find(l => l.includes(uniqueMsg) === false && l.length > 5 && !l.includes(this.agentName) && !l.includes('主对话') && !l.includes('输入消息') && !l.includes('清除上下文') && !l.includes('终端') && !l.includes('添加文件'));
        if (replyLine2) {
          agentReplyText = replyLine2;
          break;
        }
      }
    }

    if (!agentReplyText) {
      this.addIssue('warning', 'Agent reply not detected in UI', 'No assistant reply text found in agent tab after waiting');
    } else {
      console.log(`[E2E] Agent reply detected: "${agentReplyText.slice(0, 80)}"`);
    }

    // 7. Switch back to main conversation tab
    const mainTab = this.page.locator('text=主对话').first();
    await mainTab.click();
    await this.page.waitForTimeout(1000);
    console.log('[E2E] Switched to main tab');

    // 8. Verify the unique agent message is NOT in main tab
    const mainHasAgentUserMsg = await this.page.locator('text=' + uniqueMsg).first().isVisible().catch(() => false);
    if (mainHasAgentUserMsg) {
      this.addIssue('critical', 'Main tab leaked agent user message', `User message "${uniqueMsg}" found in main conversation tab`);
    } else {
      console.log('[E2E] Main tab does not contain agent user message: OK');
    }

    // 9. Verify agent reply is NOT in the main chat message list.
    // We scope the search to the main message area to avoid false positives
    // from unrelated UI elements (e.g., sidebar group names).
    if (agentReplyText) {
      const mainContent = this.page.locator('.flex-1.flex-col.min-w-0').first();
      const mainHasAgentReply = await mainContent.locator('text=' + agentReplyText.slice(0, 30)).first().isVisible().catch(() => false);
      // Also check that the unique user message is not there (already verified above, but double-check in scoped area)
      const mainHasUserMsgScoped = await mainContent.locator('text=' + uniqueMsg).first().isVisible().catch(() => false);
      if (mainHasAgentReply) {
        this.addIssue('critical', 'Main tab leaked agent reply', `Agent reply "${agentReplyText.slice(0, 40)}" found in main conversation content area`);
      } else {
        console.log('[E2E] Main tab content area does not contain agent reply: OK');
      }
      if (mainHasUserMsgScoped) {
        this.addIssue('critical', 'Main tab leaked agent user message (scoped)', `User message "${uniqueMsg}" found in main conversation content area`);
      }
    }

    // 10. Cross-check: switch back to agent tab and verify message is still there
    await agentTab.click();
    await this.page.waitForTimeout(500);
    const agentStillHasMsg = await this.page.locator('text=' + uniqueMsg).first().isVisible().catch(() => false);
    if (!agentStillHasMsg) {
      this.addIssue('critical', 'Agent tab lost message after switching', `User message disappeared from agent tab`);
    } else {
      console.log('[E2E] Agent tab retains message after switch: OK');
    }
  }

  async generateReport() {
    const reportPath = '/Users/dingxue/Documents/claude/claw/reports/e2e-chat-agent-reply-report.md';
    const now = new Date().toISOString();
    const critical = this.issues.filter((i) => i.severity === 'critical');
    const errors = this.issues.filter((i) => i.severity === 'error');
    const warnings = this.issues.filter((i) => i.severity === 'warning');

    let md = `# Playwright Chat Agent 消息接收 E2E 报告\n\n生成时间: ${now}\n测试地址: ${BASE_URL}\nAPI 地址: ${API_BASE}\n\n`;
    md += `## 问题摘要\n\n- 🔴 Critical: ${critical.length}\n- 🟠 Error: ${errors.length}\n- 🟡 Warning: ${warnings.length}\n\n`;

    if (this.issues.length === 0) {
      md += '**全部通过**\n\n';
    } else {
      md += '## 详细问题\n\n';
      for (const issue of this.issues) {
        md += `- **${issue.severity.toUpperCase()}**: ${issue.title} — ${issue.detail}\n`;
      }
      md += '\n';
    }

    md += '## 浏览器关键日志\n\n```\n';
    for (const log of this.logs.slice(-50)) {
      md += `[${log.type}] ${log.text}\n`;
    }
    md += '```\n';

    fs.mkdirSync('/Users/dingxue/Documents/claude/claw/reports', { recursive: true });
    fs.writeFileSync(reportPath, md);
    console.log(`\n报告已生成: ${reportPath}`);
  }

  async teardown() {
    if (this.browser) await this.browser.close();
  }
}

async function main() {
  const tester = new ChatAgentTester();
  await tester.init();
  try {
    await tester.login();
    await tester.testUserChatReceivesAgentMessages();
  } catch (err) {
    console.error('Fatal error:', err);
    tester.addIssue('critical', 'Fatal', err.message);
  }
  await tester.generateReport();
  await tester.teardown();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
