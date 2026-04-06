/**
 * Playwright 全量前端 E2E 诊断脚本
 * 覆盖登录、聊天、设置、技能、任务、监控等页面
 * 输出 markdown 报告到 reports/e2e-test-report.md
 */
import { chromium } from '@playwright/test';
import fs from 'fs';

const BASE_URL = process.env.CLAW_WEB_URL || 'http://localhost:5173';
const API_BASE = process.env.CLAW_API_URL || 'http://localhost:3000';
const CREDENTIALS = {
  username: process.argv[2] || 'admin@example.com',
  password: process.argv[3] || 'admin123',
};

class PlaywrightTester {
  constructor() {
    this.issues = [];
    this.logs = [];
    this.wsLogs = [];
    this.screenshots = [];
    this.page = null;
    this.browser = null;
    this.context = null;
  }

  addIssue(page, severity, title, detail, screenshotFile = null) {
    this.issues.push({ page, severity, title, detail, screenshotFile });
    console.log(`[${severity.toUpperCase()}] ${page} — ${title}: ${detail}`);
  }

  addLog(type, text) {
    this.logs.push({ type, text });
  }

  async init() {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({ viewport: { width: 1280, height: 900 } });
    this.page = await this.context.newPage();
    this.page.on('console', (msg) => {
      const text = msg.text();
      this.addLog(msg.type(), text);
      if (msg.type() === 'error' || text.includes('HOOK WS') || text.includes('sendMessage') || text.includes('mergeMessages') || text.includes('localeCompare') || text.includes('undefined') || text.includes('TypeError')) {
        console.log(`[BROWSER ${msg.type().toUpperCase()}]`, text.slice(0, 400));
      }
    });
    this.page.on('pageerror', (err) => {
      this.addIssue('global', 'error', 'Page JS Error', err.message);
    });
    this.page.on('websocket', (ws) => {
      ws.on('framereceived', (data) => {
        try {
          const payload = JSON.parse(data.payload);
          this.wsLogs.push(payload);
        } catch {}
      });
    });

    await this.page.addInitScript(() => {
      const OriginalWebSocket = window.WebSocket;
      window.WebSocket = function(...args) {
        const ws = new OriginalWebSocket(...args);
        ws.addEventListener('message', (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === 'new_message' || data.type === 'stream_event' || data.type === 'runner_state' || data.type === 'typing') {
              console.log(`[HOOK WS] type=${data.type} chatJid=${data.chatJid}`, JSON.stringify(data).slice(0, 800));
            }
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

  async screenshot(name) {
    const path = `/tmp/claw-e2e-${name}.png`;
    await this.page.screenshot({ path, fullPage: true });
    this.screenshots.push({ name, path });
    return path;
  }

  async login() {
    await this.page.goto(`${BASE_URL}/login`);
    await this.page.waitForTimeout(1000);
    const hasUsername = await this.page.locator('input#username, input[name="username"], input[placeholder*="用户名"], input[placeholder*="邮箱"]').count() > 0;
    if (!hasUsername) {
      await this.page.goto(BASE_URL);
      await this.page.waitForTimeout(1000);
      const path = new URL(this.page.url()).pathname;
      if (path !== '/login') return true;
    }
    await this.page.fill('input#username, input[name="username"], input[placeholder*="用户名"], input[placeholder*="邮箱"]', CREDENTIALS.username);
    await this.page.fill('input#password, input[name="password"], input[type="password"]', CREDENTIALS.password);
    await this.page.click('button[type="submit"]');
    await this.page.waitForTimeout(2500);
    const path = new URL(this.page.url()).pathname;
    if (path === '/login') {
      this.addIssue('login', 'critical', 'Login failed', `Still on /login after submit`);
      return false;
    }
    return true;
  }

  async testChat() {
    await this.page.goto(`${BASE_URL}/chat/group-6685800d`);
    await this.page.waitForTimeout(2000);

    // Verify chat textarea exists
    const textarea = this.page.locator('textarea').first();
    const visible = await textarea.isVisible().catch(() => false);
    if (!visible) {
      this.addIssue('chat', 'critical', 'No message input found', 'Chat page loaded but textarea not visible');
      await this.screenshot('chat-no-input');
      return;
    }

    const testMsg = `e2e-${Date.now()}`;
    await textarea.fill(testMsg);
    await this.page.keyboard.press('Enter');
    await this.page.waitForTimeout(3500);

    const bodyText = await this.page.evaluate(() => document.body.innerText);
    const msgVisible = bodyText.includes(testMsg);
    const wsNewMessageCount = this.wsLogs.filter(l => l.type === 'new_message' && l.message?.content === testMsg).length;

    if (!msgVisible) {
      this.addIssue('chat', 'critical', 'Message not visible after sending', `Sent "${testMsg}" but DOM does not contain it. WS new_message count=${wsNewMessageCount}`, await this.screenshot('chat-msg-invisible'));
    } else if (wsNewMessageCount === 0) {
      this.addIssue('chat', 'warning', 'Message visible but no WS new_message received', 'Probably rendered from optimistic local state only; real-time pipeline broken', await this.screenshot('chat-no-ws'));
    } else {
      console.log(`[chat] OK — message visible and WS new_message received (count=${wsNewMessageCount})`);
    }

    // Check for duplicated messages
    const msgOccurrences = (bodyText.match(new RegExp(testMsg, 'g')) || []).length;
    if (msgOccurrences > 1) {
      this.addIssue('chat', 'warning', 'Duplicate message rendered', `Message "${testMsg}" appears ${msgOccurrences} times in DOM`, await this.screenshot('chat-duplicate'));
    }

    // Check streaming state indicator
    const hasRunningIndicator = await this.page.locator('text=中断, .animate-pulse, .streaming-indicator').count() > 0;
    console.log('[chat] running indicator present:', hasRunningIndicator);
  }

  async testSettingsTabs() {
    const tabs = [
      { tab: 'profile', name: 'Profile' },
      { tab: 'agent-definitions', name: 'Agent Definitions' },
      { tab: 'usage', name: 'Usage' },
      { tab: 'groups', name: 'Groups' },
      { tab: 'mcp-servers', name: 'MCP Servers' },
      { tab: 'system', name: 'System' },
    ];

    for (const { tab, name } of tabs) {
      await this.page.goto(`${BASE_URL}/settings?tab=${tab}`);
      await this.page.waitForTimeout(2000);

      const bodyText = await this.page.evaluate(() => document.body.innerText);
      const hasError = bodyText.includes('application error') || bodyText.includes('出错了') || bodyText.includes('Error') || bodyText.includes('TypeError');
      const isBlank = bodyText.trim().length < 100;

      if (hasError) {
        this.addIssue('settings', 'error', `${name} tab crash`, `Detected error text on settings?tab=${tab}`, await this.screenshot(`settings-${tab}-error`));
      } else if (isBlank) {
        this.addIssue('settings', 'warning', `${name} tab blank`, `Page body is almost empty on settings?tab=${tab}`, await this.screenshot(`settings-${tab}-blank`));
      } else {
        console.log(`[settings] ${name} OK`);
      }
    }
  }

  async testSkillsPage() {
    await this.page.goto(`${BASE_URL}/skills`);
    await this.page.waitForTimeout(2000);
    const bodyText = await this.page.evaluate(() => document.body.innerText);
    if (bodyText.includes('application error') || bodyText.includes('Error')) {
      this.addIssue('skills', 'error', 'Skills page crash', 'Error text detected', await this.screenshot('skills-error'));
    } else {
      console.log('[skills] OK');
    }
  }

  async testTasksPage() {
    await this.page.goto(`${BASE_URL}/tasks`);
    await this.page.waitForTimeout(2000);
    const bodyText = await this.page.evaluate(() => document.body.innerText);
    if (bodyText.includes('application error') || bodyText.includes('Error')) {
      this.addIssue('tasks', 'error', 'Tasks page crash', 'Error text detected', await this.screenshot('tasks-error'));
    } else {
      console.log('[tasks] OK');
    }
  }

  async testMonitorPage() {
    await this.page.goto(`${BASE_URL}/monitor`);
    await this.page.waitForTimeout(2000);
    const bodyText = await this.page.evaluate(() => document.body.innerText);
    if (bodyText.includes('application error') || bodyText.includes('Error')) {
      this.addIssue('monitor', 'error', 'Monitor page crash', 'Error text detected', await this.screenshot('monitor-error'));
    } else {
      console.log('[monitor] OK');
    }
  }

  async testMemoryPage() {
    await this.page.goto(`${BASE_URL}/memory`);
    await this.page.waitForTimeout(2000);
    const bodyText = await this.page.evaluate(() => document.body.innerText);
    if (bodyText.includes('application error') || bodyText.includes('Error')) {
      this.addIssue('memory', 'error', 'Memory page crash', 'Error text detected', await this.screenshot('memory-error'));
    } else {
      console.log('[memory] OK');
    }
  }

  async generateReport() {
    const reportPath = '/Users/dingxue/Documents/claude/claw/reports/e2e-test-report.md';
    const now = new Date().toISOString();
    const critical = this.issues.filter(i => i.severity === 'critical');
    const errors = this.issues.filter(i => i.severity === 'error');
    const warnings = this.issues.filter(i => i.severity === 'warning');

    let md = `# Playwright E2E 全量测试报告\n\n生成时间: ${now}\n测试地址: ${BASE_URL}\nAPI 地址: ${API_BASE}\n\n`;
    md += `## 问题摘要\n\n- 🔴 Critical: ${critical.length}\n- 🟠 Error: ${errors.length}\n- 🟡 Warning: ${warnings.length}\n\n`;

    if (this.issues.length === 0) {
      md += '**无问题**\n\n';
    } else {
      md += '## 详细问题列表\n\n';
      for (const issue of this.issues) {
        md += `### ${issue.page} — ${issue.severity.toUpperCase()}: ${issue.title}\n`;
        md += `- 详情: ${issue.detail}\n`;
        if (issue.screenshotFile) {
          md += `- 截图: \`${issue.screenshotFile}\`\n`;
        }
        md += '\n';
      }
    }

    md += '## 截图列表\n\n';
    for (const s of this.screenshots) {
      md += `- ${s.name}: \`${s.path}\`\n`;
    }

    md += '\n## WS 消息统计\n\n';
    const wsCounts = {};
    for (const l of this.wsLogs) {
      wsCounts[l.type] = (wsCounts[l.type] || 0) + 1;
    }
    for (const [type, count] of Object.entries(wsCounts)) {
      md += `- ${type}: ${count}\n`;
    }

    md += '\n## 浏览器关键日志\n\n';
    const relevantLogs = this.logs.filter(l => l.type === 'error' || l.text.includes('TypeError') || l.text.includes('undefined') || l.text.includes('HOOK WS'));
    if (relevantLogs.length === 0) {
      md += '无关键异常日志。\n';
    } else {
      md += '```\n';
      for (const l of relevantLogs.slice(-30)) {
        md += `[${l.type}] ${l.text.slice(0, 300)}\n`;
      }
      md += '```\n';
    }

    md += '\n---\n';
    fs.writeFileSync(reportPath, md);
    console.log(`\n报告已生成: ${reportPath}`);
  }

  async teardown() {
    if (this.browser) await this.browser.close();
  }
}

async function main() {
  const tester = new PlaywrightTester();
  await tester.init();
  const ok = await tester.login();
  if (ok) {
    await tester.testChat();
    await tester.testSettingsTabs();
    await tester.testSkillsPage();
    await tester.testTasksPage();
    await tester.testMonitorPage();
    await tester.testMemoryPage();
  }
  await tester.generateReport();
  await tester.teardown();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
