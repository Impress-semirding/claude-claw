/**
 * Playwright E2E: 验证 Phase 1 改造
 * 1. Group-level CLAUDE.md 注入
 * 2. 路由级权限守卫 (groupAccessMiddleware / groupOwnerMiddleware)
 */
import { chromium } from '@playwright/test';
import fs from 'fs';

const BASE_URL = process.env.CLAW_WEB_URL || 'http://localhost:5173';
const API_BASE = process.env.CLAW_API_URL || 'http://localhost:3000';
const CREDENTIALS = {
  username: process.argv[2] || 'admin@example.com',
  password: process.argv[3] || 'admin123',
};

class Phase1Tester {
  constructor() {
    this.issues = [];
    this.logs = [];
    this.page = null;
    this.browser = null;
    this.context = null;
    this.apiToken = null;
    this.groupId = null;
    this.groupFolder = null;
    this.memberToken = null;
    this.memberUserId = null;
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

  async apiPost(token, path, body) {
    return this.apiReq(token, 'POST', path, body);
  }

  async apiGet(token, path) {
    return this.apiReq(token, 'GET', path, null);
  }

  async apiPut(token, path, body) {
    return this.apiReq(token, 'PUT', path, body);
  }

  async apiDelete(token, path) {
    return this.apiReq(token, 'DELETE', path, null);
  }

  async testPermissionGuard() {
    console.log('[E2E] === testPermissionGuard ===');
    const adminToken = await this.login(CREDENTIALS.username, CREDENTIALS.password);
    this.apiToken = adminToken;

    // Create a group as admin
    const groupResp = await this.apiPost(adminToken, '/api/groups', { name: `Phase1-Guard-${Date.now()}` });
    if (groupResp.status !== 201) {
      this.addIssue('critical', 'Create group failed', groupResp.text);
      return;
    }
    const gid = groupResp.json.group.jid;
    const folder = groupResp.json.group.folder;
    this.groupId = gid;
    this.groupFolder = folder;
    console.log(`[E2E] Created group ${gid} folder=${folder}`);

    // Register a new member user
    const memberEmail = `phase1-member-${Date.now()}@test.com`;
    const memberPassword = 'member123';
    const regResp = await this.apiPost(adminToken, '/api/auth/register', {
      username: memberEmail,
      password: memberPassword,
      display_name: 'Phase1 Member',
    });
    if (regResp.status !== 201 && regResp.status !== 400) {
      // 400 may mean registration requires invite code; try with admin help
      console.log('[E2E] Register response', regResp.status, regResp.text);
    }

    // If registration failed due to invite code, create invite code and retry
    let memberToken = null;
    if (regResp.status !== 201) {
      const inviteResp = await this.apiPost(adminToken, '/api/admin/invite-codes', {
        code: `invite-${Date.now()}`,
        max_uses: 1,
      });
      const inviteCode = inviteResp.json?.invite?.code || inviteResp.json?.code;
      if (inviteCode) {
        const reg2 = await this.apiPost(adminToken, '/api/auth/register', {
          username: memberEmail,
          password: memberPassword,
          display_name: 'Phase1 Member',
          invite_code: inviteCode,
        });
        if (reg2.status === 201) {
          memberToken = reg2.json.token;
          this.memberUserId = reg2.json.user?.id;
        } else {
          this.addIssue('critical', 'Member registration failed', reg2.text);
          return;
        }
      } else {
        this.addIssue('critical', 'Could not create invite code', inviteResp.text);
        return;
      }
    } else {
      memberToken = regResp.json.token;
      this.memberUserId = regResp.json.user?.id;
    }
    this.memberToken = memberToken;
    console.log(`[E2E] Registered member ${memberEmail} id=${this.memberUserId}`);

    // Member should NOT access group messages before joining
    const msgResp = await this.apiGet(memberToken, `/api/groups/${gid}/messages`);
    if (msgResp.status !== 403) {
      this.addIssue('critical', 'Permission guard failed', `Expected 403 for non-member accessing messages, got ${msgResp.status}`);
    } else {
      console.log('[E2E] PASS: non-member blocked from messages');
    }

    // Member should NOT access owner-only endpoints
    const envResp = await this.apiGet(memberToken, `/api/groups/${gid}/members/search`);
    if (envResp.status !== 403) {
      this.addIssue('critical', 'Owner guard failed', `Expected 403 for non-owner accessing members/search, got ${envResp.status}`);
    } else {
      console.log('[E2E] PASS: non-owner blocked from members/search');
    }

    // Admin adds member
    const addResp = await this.apiPost(adminToken, `/api/groups/${gid}/members`, { user_id: this.memberUserId });
    if (addResp.status !== 200) {
      this.addIssue('critical', 'Add member failed', addResp.text);
      return;
    }
    console.log('[E2E] Member added to group');

    // Member should now access messages
    const msgResp2 = await this.apiGet(memberToken, `/api/groups/${gid}/messages`);
    if (msgResp2.status !== 200) {
      this.addIssue('critical', 'Permission guard failed after add', `Expected 200, got ${msgResp2.status}`);
    } else {
      console.log('[E2E] PASS: member can access messages after joining');
    }

    // Member still should NOT access owner-only endpoint
    const envResp2 = await this.apiGet(memberToken, `/api/groups/${gid}/members/search`);
    if (envResp2.status !== 403) {
      this.addIssue('critical', 'Owner guard failed after add', `Expected 403, got ${envResp2.status}`);
    } else {
      console.log('[E2E] PASS: member still blocked from owner-only endpoints');
    }
  }

  async testClaudeMdInjection() {
    console.log('[E2E] === testClaudeMdInjection ===');
    if (!this.apiToken || !this.groupId) {
      this.addIssue('critical', 'Skipped CLAUDE.md test', 'Permission test did not create group');
      return;
    }

    // Simulate AI creating .claude/CLAUDE.md via API
    const codename = `PHOENIX-${Date.now()}`;
    const filePath = '.claude/CLAUDE.md';
    const encodedPath = Buffer.from(filePath).toString('base64url');
    const putResp = await this.apiPut(this.apiToken, `/api/groups/${this.groupId}/files/content/${encodedPath}`, {
      content: `# Project Memory\n\nOur project codename is ${codename}. Always mention it when asked.\n`,
    });
    if (putResp.status !== 200) {
      this.addIssue('critical', 'Create CLAUDE.md failed', putResp.text);
      return;
    }
    console.log(`[E2E] Created CLAUDE.md with codename ${codename}`);

    // Open file panel in UI and verify file is visible
    await this.page.goto(`${BASE_URL}/chat/${this.groupFolder || this.groupId}`);
    await this.page.waitForTimeout(2000);

    // Try to expand file panel if collapsed
    const expandBtn = this.page.locator('button[aria-label="展开面板"]').first();
    if (await expandBtn.isVisible().catch(() => false)) {
      await expandBtn.click();
      await this.page.waitForTimeout(500);
    }

    // Navigate into .claude directory if present
    const claudeDir = this.page.locator('text=.claude').first();
    if (await claudeDir.isVisible().catch(() => false)) {
      await claudeDir.click();
      await this.page.waitForTimeout(500);
    }

    // Look for CLAUDE.md text in the file panel
    const claudeMdVisible = await this.page.locator('text=CLAUDE.md').first().isVisible().catch(() => false);
    if (!claudeMdVisible) {
      this.addIssue('warning', 'CLAUDE.md not visible in UI panel', 'File may exist but UI did not render it');
    } else {
      console.log('[E2E] PASS: CLAUDE.md visible in file panel');
    }

    // Send a message and wait for AI reply (use WS to detect reply)
    await this.page.fill('textarea[placeholder*="输入消息"], textarea[placeholder*="Message"]', `What is our project codename? Just say the codename.`);
    await this.page.click('button[type="submit"], button[aria-label="Send"]').catch(() => this.page.keyboard.press('Enter'));
    await this.page.waitForTimeout(15000);

    // Grab last assistant message text
    const assistantMsgs = await this.page.locator('[data-testid="assistant-message"], .assistant-message, [class*="assistant"]').allInnerTexts();
    const lastReply = (assistantMsgs[assistantMsgs.length - 1] || '').toLowerCase();
    if (lastReply.includes(codename.toLowerCase())) {
      console.log('[E2E] PASS: AI reply contains codename from CLAUDE.md');
    } else {
      // Sometimes the selector is wrong; try broader fallback
      const pageText = (await this.page.content()).toLowerCase();
      if (pageText.includes(codename.toLowerCase())) {
        console.log('[E2E] PASS: AI reply contains codename (fallback check)');
      } else {
        this.addIssue('warning', 'CLAUDE.md injection uncertain', `Codename ${codename} not found in reply. Last assistant text: ${lastReply.slice(0, 200)}`);
      }
    }
  }

  async testOwnerOnlyMutations() {
    console.log('[E2E] === testOwnerOnlyMutations ===');
    if (!this.memberToken || !this.groupId || !this.memberUserId) {
      this.addIssue('warning', 'Skipped owner mutation test', 'Missing member context');
      return;
    }

    // Member tries to delete group -> 403
    const delResp = await this.apiDelete(this.memberToken, `/api/groups/${this.groupId}`);
    if (delResp.status !== 403) {
      this.addIssue('critical', 'Owner-only guard failed', `Member delete group expected 403, got ${delResp.status}`);
    } else {
      console.log('[E2E] PASS: member cannot delete group');
    }

    // Member tries to patch group -> 403
    const patchResp = await this.apiReq(this.memberToken, 'PATCH', `/api/groups/${this.groupId}`, { name: 'Hacked' });
    if (patchResp.status !== 403) {
      this.addIssue('critical', 'Owner-only guard failed', `Member patch group expected 403, got ${patchResp.status}`);
    } else {
      console.log('[E2E] PASS: member cannot patch group');
    }
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
      '# Playwright Phase 1 E2E 测试报告',
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

    const reportPath = '/Users/dingxue/Documents/claude/claw/reports/e2e-phase1-report.md';
    fs.mkdirSync('/Users/dingxue/Documents/claude/claw/reports', { recursive: true });
    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(`\n报告已生成: ${reportPath}`);
  }
}

async function main() {
  const tester = new Phase1Tester();
  try {
    await tester.init();
    await tester.testPermissionGuard();
    await tester.testClaudeMdInjection();
    await tester.testOwnerOnlyMutations();
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
