/**
 * Playwright E2E 验证 Conversation Agent Tab 隔离
 * 覆盖：跨 Group 隔离、同一 Group 主对话与 Agent Tab 隔离
 */
import { chromium } from '@playwright/test';
import fs from 'fs';

const BASE_URL = process.env.CLAW_WEB_URL || 'http://localhost:5173';
const API_BASE = process.env.CLAW_API_URL || 'http://localhost:3000';
const WS_URL = API_BASE.replace(/^http/, 'ws') + '/ws';
const CREDENTIALS = {
  username: process.argv[2] || 'admin@example.com',
  password: process.argv[3] || 'admin123',
};

class Tester {
  constructor() {
    this.issues = [];
    this.logs = [];
    this.page = null;
    this.browser = null;
    this.context = null;
    this.apiToken = null;
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

  async apiGet(path) {
    const resp = await fetch(`${API_BASE}${path}`, {
      headers: { Cookie: `session=${this.apiToken}` },
    });
    if (!resp.ok) throw new Error(`API GET ${path} failed: ${resp.status}`);
    return resp.json();
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

  async sendWsMessage(chatJid, content, agentId) {
    return this.page.evaluate(
      ({ chatJid, content, agentId, wsUrl }) => {
        return new Promise((resolve) => {
          const ws = new WebSocket(wsUrl);
          const payload = {
            type: 'send_message',
            chatJid,
            content,
            ...(agentId ? { agentId } : {}),
          };
          ws.onopen = () => {
            ws.send(JSON.stringify(payload));
            setTimeout(() => {
              ws.close();
              resolve(true);
            }, 500);
          };
          ws.onerror = () => resolve(false);
        });
      },
      { chatJid, content, agentId, wsUrl: WS_URL }
    );
  }

  async getMessages(chatJid, agentId) {
    let url = `/api/groups/${chatJid}/messages?limit=100`;
    if (agentId) url += `&agentId=${encodeURIComponent(agentId)}`;
    const data = await this.apiGet(url);
    return data.messages || [];
  }

  async testCrossGroupIsolation() {
    const groupA = await this.apiPost('/api/groups', {
      name: `E2E Group A ${Date.now()}`,
    });
    const groupB = await this.apiPost('/api/groups', {
      name: `E2E Group B ${Date.now()}`,
    });
    const jidA = groupA.group.jid;
    const jidB = groupB.group.jid;

    const msgA = `cross-group-A-${Date.now()}`;
    const msgB = `cross-group-B-${Date.now()}`;

    await this.sendWsMessage(jidA, msgA);
    await this.page.waitForTimeout(4000);

    await this.sendWsMessage(jidB, msgB);
    await this.page.waitForTimeout(4000);

    const messagesA = await this.getMessages(jidA);
    const messagesB = await this.getMessages(jidB);

    const aHasA = messagesA.some((m) => m.content === msgA);
    const aHasB = messagesA.some((m) => m.content === msgB);
    const bHasA = messagesB.some((m) => m.content === msgA);
    const bHasB = messagesB.some((m) => m.content === msgB);

    if (!aHasA)
      this.addIssue('critical', 'Cross-group isolation', `Group A missing its own message: ${msgA}`);
    if (aHasB)
      this.addIssue('critical', 'Cross-group isolation', `Group A leaked Group B message: ${msgB}`);
    if (bHasA)
      this.addIssue('critical', 'Cross-group isolation', `Group B leaked Group A message: ${msgA}`);
    if (!bHasB)
      this.addIssue('critical', 'Cross-group isolation', `Group B missing its own message: ${msgB}`);

    if (aHasA && !aHasB && !bHasA && bHasB) {
      console.log('[E2E] Cross-group isolation: OK');
    }
  }

  async testAgentTabIsolation() {
    const group = await this.apiPost('/api/groups', {
      name: `E2E Agent Group ${Date.now()}`,
    });
    const gid = group.group.jid;

    const agent = await this.apiPost(`/api/groups/${gid}/agents`, {
      name: 'Test Agent',
      prompt: 'You are a test assistant. Reply with exactly: reply-agent-ok',
      kind: 'conversation',
    });
    const agentId = agent.agent.id;

    const msgMain = `msg-main-${Date.now()}`;
    const msgAgent = `msg-agent-${Date.now()}`;

    await this.sendWsMessage(gid, msgMain);
    await this.page.waitForTimeout(4000);

    await this.sendWsMessage(gid, msgAgent, agentId);
    await this.page.waitForTimeout(12000);

    const mainMessages = await this.getMessages(gid);
    const agentMessages = await this.getMessages(gid, agentId);

    const mainHasMain = mainMessages.some((m) => m.content === msgMain);
    const mainHasAgent = mainMessages.some((m) => m.content === msgAgent);
    const agentHasMain = agentMessages.some((m) => m.content === msgMain);
    const agentHasAgent = agentMessages.some((m) => m.content === msgAgent);

    if (!mainHasMain)
      this.addIssue(
        'critical',
        'Agent tab isolation',
        `Main conversation missing its own message: ${msgMain}`
      );
    if (mainHasAgent)
      this.addIssue(
        'critical',
        'Agent tab isolation',
        `Main conversation leaked agent message: ${msgAgent}`
      );
    if (agentHasMain)
      this.addIssue(
        'critical',
        'Agent tab isolation',
        `Agent tab leaked main message: ${msgMain}`
      );
    if (!agentHasAgent)
      this.addIssue(
        'critical',
        'Agent tab isolation',
        `Agent tab missing its own message: ${msgAgent}`
      );

    if (mainHasMain && !mainHasAgent && !agentHasMain && agentHasAgent) {
      console.log('[E2E] Agent tab isolation: OK');
    }

    const agentHasReply = agentMessages.some(
      (m) => m.sender === '__assistant__' && m.content?.includes('reply-agent-ok')
    );
    if (!agentHasReply) {
      this.addIssue('warning', 'Agent tab reply', 'Agent tab did not receive expected Claude reply content');
    } else {
      console.log('[E2E] Agent tab reply received: OK');
    }
  }

  async generateReport() {
    const reportPath = '/Users/dingxue/Documents/claude/claw/reports/e2e-agent-tabs-report.md';
    const now = new Date().toISOString();
    const critical = this.issues.filter((i) => i.severity === 'critical');
    const errors = this.issues.filter((i) => i.severity === 'error');
    const warnings = this.issues.filter((i) => i.severity === 'warning');

    let md = `# Playwright Agent Tab 隔离 E2E 报告\n\n生成时间: ${now}\n测试地址: ${BASE_URL}\nAPI 地址: ${API_BASE}\n\n`;
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

    md += '---\n';
    fs.writeFileSync(reportPath, md);
    console.log(`\n报告已生成: ${reportPath}`);
  }

  async teardown() {
    if (this.browser) await this.browser.close();
  }
}

async function main() {
  const tester = new Tester();
  await tester.init();
  try {
    await tester.login();
    await tester.testCrossGroupIsolation();
    await tester.testAgentTabIsolation();
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
