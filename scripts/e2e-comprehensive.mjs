/**
 * Playwright 综合 E2E 诊断脚本
 * 覆盖前端所有页面 + 所有 API 调用
 * 输出 markdown 报告到 reports/e2e-comprehensive-report.md
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
    this.apiContext = null;
    this.token = null;
    this.userId = null;
    this.testGroupId = null;
    this.testGroupJid = null;
    this.testAgentId = null;
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
    this.apiContext = this.context.request;

    this.page.on('console', (msg) => {
      const text = msg.text();
      this.addLog(msg.type(), text);
      if (msg.type() === 'error' || text.includes('HOOK WS') || text.includes('sendMessage') || text.includes('mergeMessages') || text.includes('localeCompare') || text.includes('undefined') || text.includes('TypeError') || text.includes('application error')) {
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

    // Try to get token from localStorage
    const token = await this.page.evaluate(() => localStorage.getItem('claw_token'));
    this.token = token;

    // Fetch user info via API
    try {
      const resp = await this.apiFetch('GET', '/api/auth/me');
      if (resp.ok && resp.data?.user?.id) {
        this.userId = resp.data.user.id;
      }
    } catch {}

    return true;
  }

  async apiFetch(method, url, body = null) {
    let resp;
    const fullUrl = `${API_BASE}${url}`;
    const headers = body !== null ? { 'Content-Type': 'application/json' } : undefined;
    const data = body !== null ? JSON.stringify(body) : undefined;
    if (method === 'GET') {
      resp = await this.apiContext.get(fullUrl, { headers });
    } else if (method === 'POST') {
      resp = await this.apiContext.post(fullUrl, { headers, data });
    } else if (method === 'PUT') {
      resp = await this.apiContext.put(fullUrl, { headers, data });
    } else if (method === 'PATCH') {
      resp = await this.apiContext.patch(fullUrl, { headers, data });
    } else if (method === 'DELETE') {
      resp = await this.apiContext.delete(fullUrl, { headers, data });
    } else {
      resp = await this.apiContext.fetch(fullUrl, { method, headers, data });
    }

    const text = await resp.text();
    let dataObj = null;
    try { dataObj = JSON.parse(text); } catch {}
    return { ok: resp.ok(), status: resp.status(), data: dataObj, text };
  }

  async visitPage(path, name, options = {}) {
    await this.page.goto(`${BASE_URL}${path}`);
    await this.page.waitForTimeout(options.wait || 2000);

    const bodyText = await this.page.evaluate(() => document.body.innerText).catch(() => '');
    const hasError = bodyText.includes('application error') || bodyText.includes('出错了') || bodyText.includes('Error') || bodyText.includes('TypeError');
    const isBlank = bodyText.trim().length < 50;
    const is404 = bodyText.includes('404') || bodyText.includes('Not Found');

    if (hasError) {
      this.addIssue(name, 'error', `${name} page crash`, `Detected error text on ${path}`, await this.screenshot(`page-${name.replace(/\s+/g, '-').toLowerCase()}-error`));
    } else if (isBlank && !options.allowBlank) {
      this.addIssue(name, 'warning', `${name} page blank`, `Page body is almost empty on ${path}`, await this.screenshot(`page-${name.replace(/\s+/g, '-').toLowerCase()}-blank`));
    } else if (is404 && !options.allow404) {
      this.addIssue(name, 'error', `${name} page 404`, `Page returned 404 on ${path}`, await this.screenshot(`page-${name.replace(/\s+/g, '-').toLowerCase()}-404`));
    } else {
      console.log(`[page] ${name} OK (${path})`);
    }
  }

  async testApi(name, method, url, body = null, expectedStatus = [200, 201]) {
    const resp = await this.apiFetch(method, url, body);
    if (!expectedStatus.includes(resp.status)) {
      this.addIssue('api', 'error', `${name} API failed`, `${method} ${url} => ${resp.status}, body=${resp.text?.slice(0, 200)}`);
      return null;
    }
    console.log(`[api] ${name} OK (${method} ${url} => ${resp.status})`);
    return resp.data;
  }

  async testChat() {
    await this.page.goto(`${BASE_URL}/chat/group-6685800d`);
    await this.page.waitForTimeout(2000);
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
    }
    const msgOccurrences = (bodyText.match(new RegExp(testMsg, 'g')) || []).length;
    if (msgOccurrences > 1) {
      this.addIssue('chat', 'warning', 'Duplicate message rendered', `Message "${testMsg}" appears ${msgOccurrences} times in DOM`, await this.screenshot('chat-duplicate'));
    }
  }

  async testAllPages() {
    const pages = [
      { path: '/chat', name: 'Chat' },
      { path: '/tasks', name: 'Tasks' },
      { path: '/memory', name: 'Memory' },
      { path: '/skills', name: 'Skills' },
      { path: '/mcp-servers', name: 'MCP Servers' },
      { path: '/agent-definitions', name: 'Agent Definitions' },
      { path: '/billing', name: 'Billing' },
      { path: '/settings?tab=profile', name: 'Settings Profile' },
      { path: '/settings?tab=agent-definitions', name: 'Settings Agent Definitions' },
      { path: '/settings?tab=usage', name: 'Settings Usage' },
      { path: '/settings?tab=groups', name: 'Settings Groups' },
      { path: '/settings?tab=mcp-servers', name: 'Settings MCP Servers' },
      { path: '/settings?tab=system', name: 'Settings System' },
      { path: '/settings?tab=monitor', name: 'Settings Monitor' },
      { path: '/users', name: 'Users' },
    ];

    for (const p of pages) {
      await this.visitPage(p.path, p.name);
    }
  }

  async testAuthApis() {
    await this.testApi('Auth Me', 'GET', '/api/auth/me');
    await this.testApi('Auth Profile Update', 'PUT', '/api/auth/profile', { display_name: 'E2E Test' });
    await this.testApi('Auth Change Password', 'PUT', '/api/auth/password', { current_password: CREDENTIALS.password, new_password: CREDENTIALS.password });
  }

  async testGroupApis() {
    const groups = await this.testApi('List Groups', 'GET', '/api/groups');
    if (!groups || !groups.groups) {
      this.addIssue('api', 'error', 'List Groups malformed', 'Response missing groups field');
      return;
    }
    const groupEntries = Object.entries(groups.groups);
    if (groupEntries.length === 0) {
      this.addIssue('api', 'warning', 'No groups found', 'Cannot test group-scoped APIs without a group');
      return;
    }
    this.testGroupJid = groupEntries[0][0];
    this.testGroupId = groupEntries[0][1].id || this.testGroupJid;

    await this.testApi('Group Members', 'GET', `/api/groups/${encodeURIComponent(this.testGroupJid)}/members`);

    // Create a new group for further tests
    const newGroup = await this.testApi('Create Group', 'POST', '/api/groups', { name: `E2E Group ${Date.now()}` });
    if (newGroup?.group?.jid) {
      this.testGroupJid = newGroup.group.jid;
      this.testGroupId = newGroup.group.id || newGroup.group.jid;
    }

    await this.testApi('Group Messages', 'GET', `/api/groups/${encodeURIComponent(this.testGroupJid)}/messages?limit=10`);
    await this.testApi('Group Files', 'GET', `/api/groups/${encodeURIComponent(this.testGroupJid)}/files?path=/`);
    await this.testApi('Group Env', 'GET', `/api/groups/${encodeURIComponent(this.testGroupJid)}/env`);
    await this.testApi('Group Workspace Skills', 'GET', `/api/groups/${encodeURIComponent(this.testGroupJid)}/workspace-config/skills`);
    await this.testApi('Group Workspace MCP', 'GET', `/api/groups/${encodeURIComponent(this.testGroupJid)}/workspace-config/mcp-servers`);
    await this.testApi('Group Agents', 'GET', `/api/groups/${encodeURIComponent(this.testGroupJid)}/agents`);

    // Test group mutations
    await this.testApi('Update Group Env', 'PUT', `/api/groups/${encodeURIComponent(this.testGroupJid)}/env`, { env: { TEST: 'value' } });
    await this.testApi('Create Directory', 'POST', `/api/groups/${encodeURIComponent(this.testGroupJid)}/files/directories`, { path: '/', name: 'e2e-test-dir' });

    // Write a file
    const filePath = Buffer.from('e2e-test-dir/test.txt').toString('base64');
    await this.testApi('Write File', 'PUT', `/api/groups/${encodeURIComponent(this.testGroupJid)}/files/content/${filePath}`, { content: 'hello e2e' });
    await this.testApi('Read File', 'GET', `/api/groups/${encodeURIComponent(this.testGroupJid)}/files/content/${filePath}`);
    await this.testApi('Delete File', 'DELETE', `/api/groups/${encodeURIComponent(this.testGroupJid)}/files/${filePath}`);
  }

  async testMessageApis() {
    if (!this.testGroupJid) {
      this.addIssue('api', 'warning', 'Skip message APIs', 'No test group available');
      return;
    }
    const resp = await this.testApi('Send Message', 'POST', '/api/messages', {
      chatJid: this.testGroupJid,
      content: `E2E API message ${Date.now()}`,
    });
    if (!resp) {
      this.addIssue('api', 'error', 'Send Message failed', 'Could not send test message via API');
    }
  }

  async testMemoryApis() {
    await this.testApi('Memory Sources', 'GET', '/api/memory/sources');
    await this.testApi('Memory Search', 'GET', '/api/memory/search?q=test');
    await this.testApi('Memory Global', 'GET', '/api/memory/global');
    await this.testApi('Memory Global Write', 'PUT', '/api/memory/global', { content: '# E2E Test Memory' });
    await this.testApi('Memory File', 'GET', '/api/memory/file?path=data/groups/main/CLAUDE.md');
    await this.testApi('Memory File Write', 'PUT', '/api/memory/file', { path: 'data/groups/main/CLAUDE.md', content: '# E2E Test' });
  }

  async testConfigApis() {
    await this.testApi('Config Appearance', 'GET', '/api/config/appearance');
    await this.testApi('Config System', 'GET', '/api/config/system');
    await this.testApi('Config Claude', 'GET', '/api/config/claude');
    await this.testApi('Config Registration', 'GET', '/api/config/registration');
    await this.testApi('Update Appearance', 'PUT', '/api/config/appearance', { appName: 'E2E App' });
    await this.testApi('Update System', 'PUT', '/api/config/system', { allowRegistration: true });
  }

  async testTaskApis() {
    await this.testApi('List Tasks', 'GET', '/api/tasks');
    const task = await this.testApi('Create Task', 'POST', '/api/tasks', {
      name: `E2E Task ${Date.now()}`,
      description: 'test',
      schedule: '0 0 * * *',
      command: 'echo hello',
    });
    if (task?.task?.id) {
      const taskId = task.task.id;
      await this.testApi('Update Task', 'PATCH', `/api/tasks/${taskId}`, { name: 'Updated E2E Task' });
      await this.testApi('Run Task', 'POST', `/api/tasks/${taskId}/run`);
      await this.testApi('Task Logs', 'GET', `/api/tasks/${taskId}/logs`);
      await this.testApi('Delete Task', 'DELETE', `/api/tasks/${taskId}`);
    }
    await this.testApi('Parse Task', 'POST', '/api/tasks/parse', { text: 'every day at 9am say hello' });
    await this.testApi('AI Task', 'POST', '/api/tasks/ai', { name: 'AI Task', prompt: 'test' });
  }

  async testSkillApis() {
    await this.testApi('List Skills', 'GET', '/api/skills');
    await this.testApi('Skill Sync Status', 'GET', '/api/skills/sync-status');
    await this.testApi('Skill Search', 'GET', '/api/skills/search?q=git');
    await this.testApi('Skill Sync Host', 'POST', '/api/skills/sync-host');
    await this.testApi('Skill Sync Settings', 'PUT', '/api/skills/sync-settings', { autoSyncEnabled: false });
  }

  async testBillingApis() {
    await this.testApi('Billing Status', 'GET', '/api/billing/status');
    await this.testApi('Billing Balance', 'GET', '/api/billing/my/balance');
    await this.testApi('Billing Access', 'GET', '/api/billing/my/access');
    await this.testApi('Billing Daily Usage', 'GET', '/api/billing/my/usage/daily');
    await this.testApi('Billing Plans', 'GET', '/api/billing/plans');
    await this.testApi('Billing Transactions', 'GET', '/api/billing/my/transactions');
    await this.testApi('Billing Admin Dashboard', 'GET', '/api/billing/admin/dashboard');
    await this.testApi('Billing Admin Revenue', 'GET', '/api/billing/admin/revenue');
    await this.testApi('Billing Admin Redeem Codes', 'GET', '/api/billing/admin/redeem-codes');
    await this.testApi('Billing Admin Audit Log', 'GET', '/api/billing/admin/audit-log?limit=10&offset=0');
  }

  async testUsageApis() {
    await this.testApi('Usage Stats', 'GET', '/api/usage/stats?days=7');
    await this.testApi('Usage Models', 'GET', '/api/usage/models');
    await this.testApi('Usage Users', 'GET', '/api/usage/users');
  }

  async testMcpServerApis() {
    await this.testApi('List MCP Servers', 'GET', '/api/mcp-servers');
    const server = await this.testApi('Create MCP Server', 'POST', '/api/mcp-servers', {
      name: `E2E MCP ${Date.now()}`,
      command: 'echo',
      args: ['hello'],
      env: {},
      status: 'active',
    });
    if (server?.id) {
      await this.testApi('Update MCP Server', 'PATCH', `/api/mcp-servers/${server.id}`, { name: 'Updated E2E MCP' });
      await this.testApi('Toggle MCP Server', 'POST', `/api/mcp-servers/${server.id}/toggle`, {});
      await this.testApi('Delete MCP Server', 'DELETE', `/api/mcp-servers/${server.id}`);
    }
    await this.testApi('Sync Host MCP', 'POST', '/api/mcp-servers/sync-host');
  }

  async testAgentDefinitionApis() {
    await this.testApi('List Agent Definitions', 'GET', '/api/agent-definitions');
    if (this.testGroupJid) {
      const agent = await this.testApi('Create Group Agent', 'POST', `/api/groups/${encodeURIComponent(this.testGroupJid)}/agents`, {
        name: `E2E Agent ${Date.now()}`,
        prompt: 'You are an E2E test agent',
        kind: 'conversation',
      });
      if (agent?.agent?.id) {
        this.testAgentId = agent.agent.id;
        await this.testApi('Update Group Agent', 'PATCH', `/api/groups/${encodeURIComponent(this.testGroupJid)}/agents/${this.testAgentId}`, { name: 'Updated E2E Agent' });
        await this.testApi('Group Agent Messages', 'GET', `/api/groups/${encodeURIComponent(this.testGroupJid)}/messages?agentId=${this.testAgentId}&limit=10`);
        await this.testApi('Delete Group Agent', 'DELETE', `/api/groups/${encodeURIComponent(this.testGroupJid)}/agents/${this.testAgentId}`);
      }
    }
    const globalAgent = await this.testApi('Create Global Agent', 'POST', '/api/agent-definitions', {
      name: `E2E Global Agent ${Date.now()}`,
      prompt: 'Global test agent',
      kind: 'conversation',
    });
    if (globalAgent?.id) {
      await this.testApi('Update Global Agent', 'PUT', `/api/agent-definitions/${globalAgent.id}`, { name: 'Updated Global Agent' });
      await this.testApi('Delete Global Agent', 'DELETE', `/api/agent-definitions/${globalAgent.id}`);
    }
  }

  async testMonitorApis() {
    await this.testApi('Status', 'GET', '/api/status');
  }

  async testAdminApis() {
    await this.testApi('Admin Users', 'GET', '/api/admin/users?page=1&pageSize=20');
    await this.testApi('Admin Invites', 'GET', '/api/admin/invites');
    await this.testApi('Admin Audit Log', 'GET', '/api/admin/audit-log?limit=10&offset=0');
    await this.testApi('Admin Permission Templates', 'GET', '/api/admin/permission-templates');

    const userResp = await this.apiFetch('GET', '/api/admin/users?page=1&pageSize=1');
    if (userResp.ok && userResp.data?.users?.length > 0) {
      const targetUserId = userResp.data.users[0].id;
      await this.testApi('Admin Update User', 'PATCH', `/api/admin/users/${targetUserId}`, { display_name: 'E2E Updated' });
    }
  }

  async testImBindingApis() {
    for (const provider of ['feishu', 'telegram', 'qq', 'dingtalk']) {
      await this.testApi(`IM Binding ${provider}`, 'GET', `/api/config/user-im/${provider}`, null, [200, 404]);
    }
    await this.testApi('IM Bindings List', 'GET', '/api/config/user-im/bindings');
  }

  async generateReport() {
    const reportPath = '/Users/dingxue/Documents/claude/claw/reports/e2e-comprehensive-report.md';
    const now = new Date().toISOString();
    const critical = this.issues.filter(i => i.severity === 'critical');
    const errors = this.issues.filter(i => i.severity === 'error');
    const warnings = this.issues.filter(i => i.severity === 'warning');

    let md = `# Playwright E2E 综合测试报告\n\n生成时间: ${now}\n测试地址: ${BASE_URL}\nAPI 地址: ${API_BASE}\n\n`;
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
    const relevantLogs = this.logs.filter(l => l.type === 'error' || l.text.includes('TypeError') || l.text.includes('undefined') || l.text.includes('HOOK WS') || l.text.includes('application error'));
    if (relevantLogs.length === 0) {
      md += '无关键异常日志。\n';
    } else {
      md += '```\n';
      for (const l of relevantLogs.slice(-40)) {
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
    await tester.testAllPages();
    await tester.testChat();
    await tester.testAuthApis();
    await tester.testGroupApis();
    await tester.testMessageApis();
    await tester.testMemoryApis();
    await tester.testConfigApis();
    await tester.testTaskApis();
    await tester.testSkillApis();
    await tester.testBillingApis();
    await tester.testUsageApis();
    await tester.testMcpServerApis();
    await tester.testAgentDefinitionApis();
    await tester.testMonitorApis();
    await tester.testAdminApis();
    await tester.testImBindingApis();
  }
  await tester.generateReport();
  await tester.teardown();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
