/**
 * Playwright E2E: 验证文件管理器的完整 CRUD 与跨 Group 隔离
 */
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.CLAW_WEB_URL || 'http://localhost:5173';
const API_BASE = process.env.CLAW_API_URL || 'http://localhost:3000';
const CREDENTIALS = {
  username: process.argv[2] || 'admin@example.com',
  password: process.argv[3] || 'admin123',
};

class FilesCrudTester {
  constructor() {
    this.issues = [];
    this.logs = [];
    this.page = null;
    this.browser = null;
    this.context = null;
    this.apiToken = null;
    this.groupJid = null;
    this.groupFolder = null;
    this.secondGroupJid = null;
    this.secondGroupFolder = null;
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

    const pathName = new URL(this.page.url()).pathname;
    if (pathName === '/login') {
      throw new Error('Login failed');
    }
    console.log('[E2E] Logged in');
  }

  async apiGet(apiPath) {
    const resp = await fetch(`${API_BASE}${apiPath}`, {
      headers: { Cookie: `session=${this.apiToken}` },
    });
    if (!resp.ok) throw new Error(`API GET ${apiPath} failed: ${resp.status}`);
    return resp.json();
  }

  async apiPost(apiPath, body) {
    const resp = await fetch(`${API_BASE}${apiPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${this.apiToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`API POST ${apiPath} failed: ${resp.status}`);
    return resp.json();
  }

  async apiPut(apiPath, body) {
    const resp = await fetch(`${API_BASE}${apiPath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${this.apiToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`API PUT ${apiPath} failed: ${resp.status}`);
    return resp.json();
  }

  async apiDelete(apiPath) {
    const resp = await fetch(`${API_BASE}${apiPath}`, {
      method: 'DELETE',
      headers: { Cookie: `session=${this.apiToken}` },
    });
    if (!resp.ok) throw new Error(`API DELETE ${apiPath} failed: ${resp.status}`);
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

  async createSecondGroup() {
    const data = await this.apiPost('/api/groups', { name: 'E2E-隔离测试组' });
    const group = data.group;
    this.secondGroupJid = group.jid || group.id;
    this.secondGroupFolder = group.folder || group.jid || group.id;
    console.log(`[E2E] Second group JID: ${this.secondGroupJid}, folder: ${this.secondGroupFolder}`);
    return { jid: this.secondGroupJid, folder: this.secondGroupFolder };
  }

  async navigateToChat() {
    await this.page.goto(`${BASE_URL}/chat/${this.groupFolder}`);
    await this.page.waitForTimeout(2000);
  }

  async openFilePanel() {
    // Desktop: click the expand panel button if sidebar is collapsed
    const expandBtn = this.page.locator('button[aria-label="展开面板"]');
    if (await expandBtn.isVisible().catch(() => false)) {
      await expandBtn.click();
      await this.page.waitForTimeout(500);
    }
    // Verify file panel header
    const header = this.page.locator('text=工作区文件管理').first();
    await header.waitFor({ state: 'visible', timeout: 5000 });
    console.log('[E2E] File panel is open');
  }

  async refreshFilePanel() {
    const refreshBtn = this.page.locator('button[aria-label="刷新文件列表"]').first();
    await refreshBtn.click();
    await this.page.waitForTimeout(800);
  }

  async simulateAiCreateFile(fileName, content) {
    // Directly write to the group's workspace to simulate AI creating a file
    const resp = await this.apiPut(
      `/api/groups/${this.groupJid}/files/content/${Buffer.from(fileName).toString('base64url')}`,
      { content }
    );
    console.log(`[E2E] Simulated AI file creation: ${fileName}`);
    return resp;
  }

  async simulateAiCreateFileInSecondGroup(fileName, content) {
    const resp = await this.apiPut(
      `/api/groups/${this.secondGroupJid}/files/content/${Buffer.from(fileName).toString('base64url')}`,
      { content }
    );
    console.log(`[E2E] Simulated AI file creation in second group: ${fileName}`);
    return resp;
  }

  async assertFileVisibleInPanel(fileName, shouldBeVisible = true) {
    // File list items contain the file name text
    const locator = this.page.locator(`text=${fileName}`).first();
    const isVisible = await locator.isVisible().catch(() => false);
    if (shouldBeVisible && !isVisible) {
      this.addIssue('critical', 'File not visible in panel', `Expected to see "${fileName}" in file panel`);
      return false;
    }
    if (!shouldBeVisible && isVisible) {
      this.addIssue('critical', 'File should not be visible', `Did not expect to see "${fileName}" in file panel`);
      return false;
    }
    return true;
  }

  async testCreateDirectoryViaUI(dirName) {
    await this.page.click('button:has-text("新建文件夹")');
    await this.page.fill('input[placeholder="输入文件夹名称"]', dirName);
    await this.page.click('button:has-text("创建")');
    await this.page.waitForTimeout(1000);
    const ok = await this.assertFileVisibleInPanel(dirName, true);
    if (ok) console.log(`[E2E] Directory created via UI: ${dirName}`);
    return ok;
  }

  async testUploadViaApiAndVerifyInUi(fileName, content) {
    // Use API to upload (verify backend), then check it appears in the UI panel
    const formData = new FormData();
    const blob = new Blob([content], { type: 'text/plain' });
    formData.append('files', blob, fileName);
    formData.append('path', '');

    const resp = await fetch(`${API_BASE}/api/groups/${this.groupJid}/files`, {
      method: 'POST',
      headers: { Cookie: `session=${this.apiToken}` },
      body: formData,
    });
    if (!resp.ok) {
      this.addIssue('critical', 'Upload API failed', `Status ${resp.status}`);
      return false;
    }

    await this.refreshFilePanel();
    const ok = await this.assertFileVisibleInPanel(fileName, true);
    if (ok) console.log(`[E2E] File uploaded via API and visible in UI: ${fileName}`);
    return ok;
  }

  async testDeleteFileViaUI(fileName) {
    // Click the delete button next to the file name
    const fileRow = this.page.locator(`text=${fileName}`).locator('xpath=../../..').first();
    const deleteBtn = fileRow.locator('button[aria-label="删除文件"]').first();
    await deleteBtn.click();
    await this.page.waitForTimeout(500);
    // Confirm deletion
    const confirmBtn = this.page.locator('button:has-text("删除")').last();
    await confirmBtn.click();
    await this.page.waitForTimeout(1000);

    const ok = await this.assertFileVisibleInPanel(fileName, false);
    if (ok) console.log(`[E2E] File deleted via UI: ${fileName}`);
    return ok;
  }

  async cleanup() {
    // Delete simulated files and directories via API
    try {
      await this.apiDelete(`/api/groups/${this.groupJid}/files/${Buffer.from('e2e-ai-test.md').toString('base64url')}`);
    } catch {}
    try {
      await this.apiDelete(`/api/groups/${this.groupJid}/files/${Buffer.from('e2e-upload-test.txt').toString('base64url')}`);
    } catch {}
    try {
      await this.apiDelete(`/api/groups/${this.groupJid}/files/${Buffer.from('e2e-new-dir').toString('base64url')}`);
    } catch {}
    try {
      if (this.secondGroupJid) {
        await this.apiDelete(`/api/groups/${this.secondGroupJid}`);
      }
    } catch {}
  }

  async run() {
    try {
      await this.init();
      await this.login();
      await this.getFirstGroup();
      await this.createSecondGroup();
      await this.navigateToChat();
      await this.openFilePanel();

      // 1. Simulate AI creating a file and verify it appears after refresh
      const aiFileName = 'e2e-ai-test.md';
      await this.simulateAiCreateFile(aiFileName, '# Hello from AI\nThis is a test file.\n');
      await this.refreshFilePanel();
      let ok = await this.assertFileVisibleInPanel(aiFileName, true);
      if (ok) console.log('[E2E] PASS: AI-created file is visible in file panel');

      // 2. Test directory creation via UI
      ok = await this.testCreateDirectoryViaUI('e2e-new-dir');

      // 3. Test file upload via UI
      ok = await this.testUploadViaApiAndVerifyInUi('e2e-upload-test.txt', 'uploaded content');

      // 4. Cross-group isolation: create a file in second group, ensure it does NOT appear in first group
      await this.simulateAiCreateFileInSecondGroup('isolated-file.md', '# Isolated\n');
      await this.refreshFilePanel();
      ok = await this.assertFileVisibleInPanel('isolated-file.md', false);
      if (ok) console.log('[E2E] PASS: Cross-group isolation works');

      // 5. Verify second group has its own file via API
      const secondGroupFiles = await this.apiGet(`/api/groups/${this.secondGroupJid}/files`);
      const hasIsolated = (secondGroupFiles.files || []).some((f) => f.name === 'isolated-file.md');
      if (!hasIsolated) {
        this.addIssue('critical', 'Isolated file missing in second group', 'Second group file list should contain isolated-file.md');
      } else {
        console.log('[E2E] PASS: Second group contains its own file');
      }

      // 6. Cleanup test artifacts
      await this.cleanup();

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
      '# Playwright E2E 文件管理 CRUD 测试报告',
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

    const reportPath = '/Users/dingxue/Documents/claude/claw/reports/e2e-files-crud-report.md';
    fs.mkdirSync('/Users/dingxue/Documents/claude/claw/reports', { recursive: true });
    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(`\n报告已生成: ${reportPath}`);
  }
}

const tester = new FilesCrudTester();
tester.run().then((ok) => {
  process.exit(ok ? 0 : 1);
});
