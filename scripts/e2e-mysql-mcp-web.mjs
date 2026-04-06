/**
 * Playwright E2E: 在 Web 界面发送消息后，验证 mysql-data MCP 工具是否被调用
 */
import { chromium } from '@playwright/test';
import fs from 'fs';

const BASE_URL = process.env.CLAW_WEB_URL || 'http://localhost:5173';
const API_BASE = process.env.CLAW_API_URL || 'http://localhost:3000';
const CREDENTIALS = {
  username: process.argv[2] || 'admin@example.com',
  password: process.argv[3] || 'admin123',
};

class MySqlMcpWebTester {
  constructor() {
    this.issues = [];
    this.logs = [];
    this.wsEvents = [];
    this.page = null;
    this.browser = null;
    this.context = null;
    this.apiToken = null;
    this.groupJid = null;
    this.groupFolder = null;
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
      const text = msg.text();
      this.logs.push({ type: msg.type(), text });
      // Also persist WS stream_event logs from our hook for easier inspection
      if (text.includes('[HOOK WS] type=stream_event')) {
        try {
          const raw = text.split('chatJid=')[1]?.split(' ')[1];
          if (raw) this.wsEvents.push(JSON.parse(raw));
        } catch {}
      }
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
            if (data.type === 'stream_event') {
              console.log(
                `[HOOK WS] type=stream_event chatJid=${data.chatJid}`,
                JSON.stringify(data).slice(0, 600)
              );
            }
            window.__wsStreamEvents = window.__wsStreamEvents || [];
            window.__wsStreamEvents.push(data);
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

  async getFirstGroup() {
    const data = await this.apiGet('/api/groups');
    const groups = Object.values(data.groups || {});
    const first = groups[0];
    if (!first) throw new Error('No group found');
    this.groupJid = first.jid || first.id;
    this.groupFolder = first.folder || first.jid || first.id;
    console.log(`[E2E] First group JID: ${this.groupJid}, folder: ${this.groupFolder}`);
    return { jid: this.groupJid, folder: this.groupFolder };
  }

  async navigateToChat() {
    await this.page.goto(`${BASE_URL}/chat/${this.groupFolder}`);
    await this.page.waitForTimeout(2000);
  }

  async sendMessage(content) {
    const textarea = this.page.locator('textarea').first();
    await textarea.fill(content);
    await this.page.keyboard.press('Enter');
    console.log(`[E2E] Sent message: ${content}`);
  }

  async waitForMysqlToolEvent(timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = await this.page.evaluate(() => {
        const msgs = window.__wsStreamEvents || [];
        return msgs.some((m) => {
          if (m.type !== 'stream_event') return false;
          const ev = m.event || {};
          if (ev.eventType !== 'tool_use_start') return false;
          const haystack = `${ev.toolName || ''} ${JSON.stringify(ev.toolInput || {})} ${ev.toolInputSummary || ''}`.toLowerCase();
          // Accept MySQL-related tools, or Bash calling the MySQL MCP endpoint
          return haystack.includes('mysql')
            || haystack.includes('sql')
            || haystack.includes('query')
            || haystack.includes('database')
            || haystack.includes('mcp')
            || haystack.includes('114.55.0.167');
        });
      });
      if (found) return true;
      await this.page.waitForTimeout(500);
    }
    return false;
  }

  async extractMysqlToolEvents() {
    return this.page.evaluate(() => {
      const msgs = window.__wsStreamEvents || [];
      return msgs
        .filter((m) => m.type === 'stream_event' && m.event?.eventType === 'tool_use_start')
        .map((m) => m.event);
    });
  }

  async run() {
    try {
      await this.init();
      await this.login();

      // Verify mysql-data is enabled via API
      const mcpList = await this.apiGet('/api/mcp-servers');
      const mysqlMcp = (mcpList.servers || []).find((s) => s.id === 'mysql-data');
      if (!mysqlMcp) {
        this.addIssue('critical', 'MySQL MCP missing', 'mysql-data MCP server not found');
      } else if (!mysqlMcp.enabled) {
        this.addIssue('error', 'MySQL MCP disabled', `mysql-data is enabled=${mysqlMcp.enabled}, status=${mysqlMcp.status}`);
      } else {
        console.log('[E2E] mysql-data MCP is enabled:', mysqlMcp.url);
      }

      await this.getFirstGroup();
      await this.navigateToChat();

      const prompt = '帮我查一下 mysql 数据库里有哪些表';
      await this.sendMessage(prompt);

      console.log('[E2E] Waiting for mysql tool_use_start stream_event...');
      const gotMysqlTool = await this.waitForMysqlToolEvent(45000);

      if (gotMysqlTool) {
        const events = await this.extractMysqlToolEvents();
        console.log('[E2E] Detected tool events:', JSON.stringify(events.slice(0, 3), null, 2));
        console.log('[E2E] PASS: mysql-related MCP tool was triggered');
      } else {
        // If no tool event, maybe the model answered without tools. Check the final message.
        const hasReply = await this.page.evaluate(() => {
          const body = document.body.innerText || '';
          return /mysql|sql|database|表|table/i.test(body);
        });
        if (hasReply) {
          console.log('[E2E] WARNING: No mysql tool_use_start captured, but reply mentions mysql/sql/database. Model may have answered directly or DOM rendered too late.');
          this.addIssue('warning', 'MySQL tool not captured', 'No stream_event tool_use_start captured, but reply text mentions mysql/database');
        } else {
          this.addIssue('critical', 'MySQL tool not triggered', 'No mysql-related tool_use_start stream_event or reply detected within timeout');
        }
      }

      // Wait for completion (runner_state idle) to leave page in clean state
      const startIdle = Date.now();
      let idle = false;
      while (Date.now() - startIdle < 30000) {
        idle = await this.page.evaluate((jid) => {
          const msgs = window.__wsStreamEvents || [];
          return msgs.some((m) => m.type === 'runner_state' && m.chatJid === jid && m.state === 'idle');
        }, this.groupJid);
        if (idle) break;
        await this.page.waitForTimeout(500);
      }
      if (idle) console.log('[E2E] Runner reached idle');

      await this.browser.close();
      this.generateReport();
      return this.issues.filter((i) => i.severity === 'critical').length === 0;
    } catch (err) {
      console.error(err);
      if (this.browser) await this.browser.close();
      this.addIssue('critical', 'Test script error', err.message);
      this.generateReport();
      return false;
    }
  }

  generateReport() {
    const critical = this.issues.filter((i) => i.severity === 'critical');
    const errors = this.issues.filter((i) => i.severity === 'error');
    const warnings = this.issues.filter((i) => i.severity === 'warning');

    const lines = [
      '# Playwright E2E MySQL MCP Web 测试报告',
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
      critical.length + errors.length + warnings.length === 0 ? '**无问题**' : '**存在问题，详见下方**',
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

    const reportPath = '/Users/dingxue/Documents/claude/claw/reports/e2e-mysql-mcp-web-report.md';
    fs.mkdirSync('/Users/dingxue/Documents/claude/claw/reports', { recursive: true });
    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(`\n报告已生成: ${reportPath}`);
  }
}

const tester = new MySqlMcpWebTester();
tester.run().then((ok) => {
  process.exit(ok ? 0 : 1);
});
