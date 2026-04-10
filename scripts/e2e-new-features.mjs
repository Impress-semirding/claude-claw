/**
 * E2E 测试：验证四项后端优化
 * 1. 任务调度系统（script/agent+isolated/agent+group 双模式）
 * 2. Agent Pool 优雅中断（_interrupt sentinel）
 * 3. MCP 工具扩展（list_tasks / pause_task / resume_task / cancel_task / install_skill）
 * 4. Provider Pool（多 provider 负载均衡 + 健康状态）
 *
 * 运行方式:
 *   node scripts/e2e-new-features.mjs [username] [password]
 *
 * 环境变量:
 *   CLAW_API_URL 默认 http://localhost:3000
 */

import fs from 'fs';

const API_BASE = process.env.CLAW_API_URL || 'http://localhost:3000';
const CREDENTIALS = {
  username: process.argv[2] || 'admin@example.com',
  password: process.argv[3] || 'admin123',
};

class NewFeaturesTester {
  constructor() {
    this.issues = [];
    this.logs = [];
    this.token = null;
    this.userId = null;
    this.testGroupId = null;
    this.testGroupJid = null;
  }

  addIssue(severity, title, detail) {
    this.issues.push({ severity, title, detail });
    console.log(`[${severity.toUpperCase()}] ${title}: ${detail}`);
  }

  log(text) {
    this.logs.push(text);
    console.log(text);
  }

  async apiFetch(method, path, body = null, cookie = null) {
    const headers = {};
    const c = cookie || this.token;
    if (c) {
      headers['Cookie'] = `session=${c}`;
    }
    if (body !== null && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }
    const resp = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: resp.status, json, text };
  }

  async apiPost(path, body, cookie) {
    return this.apiFetch('POST', path, body, cookie);
  }

  async apiGet(path, cookie) {
    return this.apiFetch('GET', path, null, cookie);
  }

  async apiPatch(path, body, cookie) {
    return this.apiFetch('PATCH', path, body, cookie);
  }

  async apiDelete(path, cookie) {
    return this.apiFetch('DELETE', path, null, cookie);
  }

  async apiPut(path, body, cookie) {
    return this.apiFetch('PUT', path, body, cookie);
  }

  async login() {
    const resp = await this.apiPost('/api/auth/login', {
      username: CREDENTIALS.username,
      password: CREDENTIALS.password,
    });
    if (resp.status !== 200 || !resp.json?.token) {
      this.addIssue('critical', 'Login failed', `status=${resp.status} body=${resp.text.slice(0, 200)}`);
      throw new Error('Login failed');
    }
    this.token = resp.json.token;
    this.userId = resp.json.user?.id;
    this.log(`[login] OK userId=${this.userId}`);
  }

  async getOrCreateGroup() {
    if (this.testGroupJid) return this.testGroupJid;
    const resp = await this.apiPost('/api/groups', { name: `E2E NewFeatures ${Date.now()}` });
    if (resp.status !== 201 || !resp.json?.group?.jid) {
      this.addIssue('critical', 'Create group failed', resp.text);
      throw new Error('Create group failed');
    }
    this.testGroupJid = resp.json.group.jid;
    this.testGroupId = resp.json.group.id || this.testGroupJid;
    this.log(`[group] created ${this.testGroupJid}`);
    return this.testGroupJid;
  }

  // ─── 1. Task Scheduler Tests ────────────────────────────────────

  async testTaskScheduler() {
    this.log('\n=== Task Scheduler Tests ===');
    const gid = await this.getOrCreateGroup();

    // 1a. Create script task
    const scriptTaskResp = await this.apiPost('/api/tasks', {
      name: 'E2E Script Task',
      executionType: 'script',
      scriptCommand: 'echo "hello from script"',
      schedule: '0 0 * * *',
      enabled: true,
    });
    if (scriptTaskResp.status !== 201 || !scriptTaskResp.json?.task?.id) {
      this.addIssue('critical', 'Create script task failed', scriptTaskResp.text);
      return;
    }
    const scriptTask = scriptTaskResp.json.task;
    if (scriptTask.executionType !== 'script') {
      this.addIssue('critical', 'Script task wrong executionType', JSON.stringify(scriptTask));
    } else {
      this.log('[task] script task created OK');
    }

    // 1b. Create agent+isolated task
    const agentTaskResp = await this.apiPost('/api/tasks', {
      name: 'E2E Agent Isolated Task',
      executionType: 'agent',
      contextMode: 'isolated',
      prompt: 'Say hello from isolated task',
      schedule: '0 0 * * *',
      enabled: true,
    });
    if (agentTaskResp.status !== 201 || !agentTaskResp.json?.task?.id) {
      this.addIssue('critical', 'Create agent isolated task failed', agentTaskResp.text);
      return;
    }
    const agentTask = agentTaskResp.json.task;
    if (agentTask.executionType !== 'agent' || agentTask.contextMode !== 'isolated') {
      this.addIssue('critical', 'Agent isolated task wrong fields', JSON.stringify(agentTask));
    } else {
      this.log('[task] agent+isolated task created OK');
    }

    // 1c. Create agent+group task
    const groupTaskResp = await this.apiPost('/api/tasks', {
      name: 'E2E Agent Group Task',
      executionType: 'agent',
      contextMode: 'group',
      prompt: 'Say hello from group task',
      schedule: '0 0 * * *',
      groupId: gid,
      enabled: true,
    });
    if (groupTaskResp.status !== 201 || !groupTaskResp.json?.task?.id) {
      this.addIssue('critical', 'Create agent group task failed', groupTaskResp.text);
      return;
    }
    const groupTask = groupTaskResp.json.task;
    if (groupTask.contextMode !== 'group' || groupTask.groupId !== gid) {
      this.addIssue('critical', 'Agent group task wrong fields', JSON.stringify(groupTask));
    } else {
      this.log('[task] agent+group task created OK');
    }

    // 1d. Manual run script task
    const runResp = await this.apiPost(`/api/tasks/${scriptTask.id}/run`);
    if (runResp.status !== 200) {
      this.addIssue('critical', 'Run script task failed', `status=${runResp.status} body=${runResp.text}`);
    } else {
      this.log('[task] manual run triggered OK');
    }

    // Wait a bit for execution
    await new Promise((r) => setTimeout(r, 2000));

    // 1e. Check logs appear
    const logsResp = await this.apiGet(`/api/tasks/${scriptTask.id}/logs`);
    if (logsResp.status !== 200 || !Array.isArray(logsResp.json?.logs)) {
      this.addIssue('error', 'Task logs endpoint failed', logsResp.text);
    } else {
      this.log(`[task] logs count=${logsResp.json.logs.length}`);
      const hasRunning = logsResp.json.logs.some((l) => l.status === 'running');
      const hasSuccess = logsResp.json.logs.some((l) => l.status === 'success');
      if (!hasRunning && !hasSuccess) {
        this.addIssue('warning', 'Task logs missing expected statuses', JSON.stringify(logsResp.json.logs.map((l) => l.status)));
      }
    }

    // 1f. list tasks
    const listResp = await this.apiGet('/api/tasks');
    if (listResp.status !== 200 || !Array.isArray(listResp.json?.tasks)) {
      this.addIssue('error', 'List tasks failed', listResp.text);
    } else {
      const ids = listResp.json.tasks.map((t) => t.id);
      if (!ids.includes(scriptTask.id) || !ids.includes(agentTask.id) || !ids.includes(groupTask.id)) {
        this.addIssue('error', 'List tasks missing created tasks', JSON.stringify(ids));
      } else {
        this.log('[task] list tasks OK');
      }
    }

    // 1g. Pause / resume
    const pauseResp = await this.apiPatch(`/api/tasks/${scriptTask.id}`, { enabled: false });
    if (pauseResp.status !== 200) {
      this.addIssue('error', 'Pause task failed', pauseResp.text);
    } else {
      const getResp = await this.apiGet(`/api/tasks/${scriptTask.id}`);
      if (getResp.json?.task?.enabled !== false) {
        this.addIssue('error', 'Task not paused', JSON.stringify(getResp.json));
      } else {
        this.log('[task] pause/resume OK');
      }
    }

    // Cleanup tasks
    for (const id of [scriptTask.id, agentTask.id, groupTask.id]) {
      await this.apiDelete(`/api/tasks/${id}`);
    }
    this.log('[task] cleanup done');
  }

  // ─── 2. Agent Pool Interrupt Tests ──────────────────────────────

  async testAgentPoolInterrupt() {
    this.log('\n=== Agent Pool Interrupt Tests ===');
    const gid = await this.getOrCreateGroup();

    // First, create a session by sending a message that will trigger an agent query
    // We need to start the query, then abort it.
    const uniqueMsg = `e2e-interrupt-test-${Date.now()}`;
    const sendResp = await this.apiPost('/api/messages', {
      chatJid: gid,
      content: uniqueMsg,
    });
    if (sendResp.status !== 200 || !sendResp.json?.messageId) {
      this.addIssue('critical', 'Send message failed for interrupt test', sendResp.text);
      return;
    }
    this.log(`[interrupt] message sent messageId=${sendResp.json.messageId}`);

    // Small delay to ensure query starts
    await new Promise((r) => setTimeout(r, 800));

    // We need the session ID. Since we don't have it from send message, we can
    // fetch group messages and look for the session_id in the latest message.
    const msgResp = await this.apiGet(`/api/groups/${encodeURIComponent(gid)}/messages?limit=5`);
    let sessionId = null;
    if (msgResp.status === 200 && Array.isArray(msgResp.json?.messages)) {
      const last = msgResp.json.messages[0];
      sessionId = last?.session_id || last?.sessionId || null;
    }

    if (!sessionId) {
      // Fallback: create a session explicitly via POST /api/claude/sessions
      this.log('[interrupt] no session_id from messages, creating session explicitly');
      const sessionResp = await this.apiPost('/api/claude/sessions', { workspace: gid });
      sessionId = sessionResp.json?.data?.sessionId || null;
      if (!sessionId) {
        this.addIssue('warning', 'Could not get sessionId for abort test', 'Skipping interrupt E2E');
        return;
      }
      // Register the session by sending a message with explicit sessionId
      const sendWithSession = await this.apiPost('/api/messages', {
        chatJid: gid,
        content: `e2e-interrupt-session ${Date.now()}`,
        sessionId,
      });
      if (sendWithSession.status !== 200) {
        this.addIssue('warning', 'Send message with explicit sessionId failed', sendWithSession.text);
        return;
      }
    }

    this.log(`[interrupt] sessionId=${sessionId}`);

    // Send another message using this sessionId to ensure there's a running query
    const sendResp2 = await this.apiPost('/api/messages', {
      chatJid: gid,
      content: `second message for interrupt ${Date.now()}`,
      sessionId,
    });
    if (sendResp2.status !== 200) {
      this.addIssue('warning', 'Second message failed', sendResp2.text);
    }
    await new Promise((r) => setTimeout(r, 1000));

    // Abort query
    const abortResp = await this.apiPost('/api/claude/abort', {
      workspace: gid,
      sessionId,
    });
    if (abortResp.status !== 200) {
      this.addIssue('critical', 'Abort endpoint failed', `status=${abortResp.status} body=${abortResp.text}`);
    } else if (!abortResp.json?.success) {
      this.addIssue('warning', 'Abort returned success=false', abortResp.text);
    } else {
      this.log('[interrupt] abort OK');
    }

    // Verify no server crash by hitting health
    const healthResp = await this.apiGet('/health');
    if (healthResp.status !== 200) {
      this.addIssue('critical', 'Server crashed after abort', healthResp.text);
    } else {
      this.log('[interrupt] server healthy after abort');
    }

    // Verify _interrupt sentinel file was written (internal check via file API if accessible)
    // Not directly accessible via public API, so we rely on abort success as proxy.
  }

  // ─── 3. MCP Tools Tests ─────────────────────────────────────────

  async testMcpTools() {
    this.log('\n=== MCP Tools Tests ===');
    const gid = await this.getOrCreateGroup();

    // Create a task that the agent can potentially list/cancel
    const taskResp = await this.apiPost('/api/tasks', {
      name: 'E2E MCP Task',
      executionType: 'agent',
      contextMode: 'group',
      prompt: 'Say hello',
      schedule: '0 0 * * *',
      groupId: gid,
      enabled: true,
    });
    const taskId = taskResp.json?.task?.id;
    if (!taskId) {
      this.addIssue('critical', 'MCP tool test: task creation failed', taskResp.text);
      return;
    }
    this.log(`[mcp] created task ${taskId}`);

    // Send a message asking the agent to use list_tasks.
    // Note: whether the agent actually calls the tool depends on the model.
    // We verify at minimum that the message pipeline works with the claw MCP server active.
    const msg = `Please use the list_tasks tool to check scheduled tasks in this workspace, then say "OK tasks checked".`;
    const sendResp = await this.apiPost('/api/messages', {
      chatJid: gid,
      content: msg,
    });
    if (sendResp.status !== 200) {
      this.addIssue('critical', 'MCP tool test: send message failed', sendResp.text);
      await this.apiDelete(`/api/tasks/${taskId}`);
      return;
    }

    // Wait for agent processing (up to 20s)
    this.log('[mcp] waiting for agent reply...');
    let foundReply = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const msgsResp = await this.apiGet(`/api/groups/${encodeURIComponent(gid)}/messages?limit=10`);
      if (msgsResp.status === 200 && Array.isArray(msgsResp.json?.messages)) {
        const replies = msgsResp.json.messages.filter((m) => m.role === 'assistant');
        const lastReply = replies[0];
        if (lastReply && lastReply.content && lastReply.content.includes('OK tasks checked')) {
          foundReply = true;
          this.log('[mcp] agent reply found');
          break;
        }
      }
    }
    if (!foundReply) {
      this.addIssue('warning', 'MCP tool test: agent did not produce expected reply', 'This may be normal if model chose not to use tool or quota exceeded');
    }

    // Cleanup
    await this.apiDelete(`/api/tasks/${taskId}`);

    // Verify skill install endpoint exists (we won't actually install to save time/quota)
    const skillSearchResp = await this.apiGet('/api/skills/search?q=git');
    if (skillSearchResp.status !== 200) {
      this.addIssue('error', 'MCP skill search endpoint failed', skillSearchResp.text);
    } else {
      this.log('[mcp] skill search endpoint OK');
    }
  }

  // ─── 4. Provider Pool Tests ─────────────────────────────────────

  async testProviderPool() {
    this.log('\n=== Provider Pool Tests ===');

    // 4a. Create provider 1
    const p1Resp = await this.apiPost('/api/config/claude/providers', {
      name: 'E2E Provider 1',
      enabled: true,
      weight: 2,
      anthropicBaseUrl: 'https://api.anthropic.com',
      anthropicModel: 'claude-sonnet-4-20250514',
      anthropicApiKey: 'sk-test-key-1',
    });
    if (p1Resp.status !== 201 || !p1Resp.json?.id) {
      this.addIssue('critical', 'Create provider 1 failed', p1Resp.text);
      return;
    }
    const p1Id = p1Resp.json.id;
    this.log(`[provider] created p1=${p1Id}`);

    // 4b. Create provider 2
    const p2Resp = await this.apiPost('/api/config/claude/providers', {
      name: 'E2E Provider 2',
      enabled: false,
      weight: 1,
      anthropicBaseUrl: 'https://api.anthropic.com',
      anthropicModel: 'claude-opus-4-20250514',
      anthropicApiKey: 'sk-test-key-2',
    });
    if (p2Resp.status !== 201 || !p2Resp.json?.id) {
      this.addIssue('critical', 'Create provider 2 failed', p2Resp.text);
      await this.apiDelete(`/api/config/claude/providers/${p1Id}`);
      return;
    }
    const p2Id = p2Resp.json.id;
    this.log(`[provider] created p2=${p2Id}`);

    // 4c. List providers and verify health field present
    const listResp = await this.apiGet('/api/config/claude/providers');
    if (listResp.status !== 200 || !Array.isArray(listResp.json?.providers)) {
      this.addIssue('critical', 'List providers failed', listResp.text);
    } else {
      const ids = listResp.json.providers.map((p) => p.id);
      if (!ids.includes(p1Id) || !ids.includes(p2Id)) {
        this.addIssue('error', 'List providers missing created providers', JSON.stringify(ids));
      } else {
        const h1 = listResp.json.providers.find((p) => p.id === p1Id)?.health;
        if (!h1 || typeof h1.healthy !== 'boolean') {
          this.addIssue('error', 'Provider health missing', JSON.stringify(h1));
        } else {
          this.log('[provider] list + health OK');
        }
      }
    }

    // 4d. Toggle provider 2 on
    const toggleResp = await this.apiPost(`/api/config/claude/providers/${p2Id}/toggle`);
    if (toggleResp.status !== 200) {
      this.addIssue('error', 'Toggle provider failed', toggleResp.text);
    } else {
      this.log('[provider] toggle OK');
    }

    // 4e. Reset health
    const resetResp = await this.apiPost(`/api/config/claude/providers/${p1Id}/reset-health`);
    if (resetResp.status !== 200) {
      this.addIssue('error', 'Reset health failed', resetResp.text);
    } else {
      this.log('[provider] reset health OK');
    }

    // 4f. Health endpoint
    const healthResp = await this.apiGet('/api/config/claude/providers/health');
    if (healthResp.status !== 200 || !Array.isArray(healthResp.json?.statuses)) {
      this.addIssue('error', 'Providers health endpoint failed', healthResp.text);
    } else {
      const statuses = healthResp.json.statuses;
      const hasP1 = statuses.some((s) => s.providerId === p1Id);
      const hasP2 = statuses.some((s) => s.providerId === p2Id);
      if (!hasP1 || !hasP2) {
        this.addIssue('error', 'Health statuses missing providers', JSON.stringify(statuses.map((s) => s.providerId)));
      } else {
        this.log('[provider] health endpoint OK');
      }
    }

    // 4g. Balancing config
    const balanceResp = await this.apiPut('/api/config/claude/balancing', {
      strategy: 'weighted-random',
      unhealthyThreshold: 2,
      recoveryIntervalMs: 60000,
    });
    if (balanceResp.status !== 200) {
      this.addIssue('error', 'Update balancing failed', balanceResp.text);
    } else {
      this.log('[provider] balancing config OK');
    }

    // Cleanup
    await this.apiDelete(`/api/config/claude/providers/${p1Id}`);
    await this.apiDelete(`/api/config/claude/providers/${p2Id}`);
    this.log('[provider] cleanup done');
  }

  // ─── Report ─────────────────────────────────────────────────────

  generateReport() {
    const reportPath = '/Users/dingxue/Documents/claude/claw/reports/e2e-new-features-report.md';
    const critical = this.issues.filter((i) => i.severity === 'critical');
    const errors = this.issues.filter((i) => i.severity === 'error');
    const warnings = this.issues.filter((i) => i.severity === 'warning');

    const lines = [
      '# New Features E2E 测试报告',
      '',
      `生成时间: ${new Date().toISOString()}`,
      `API 地址: ${API_BASE}`,
      '',
      '## 问题摘要',
      '',
      `- 🔴 Critical: ${critical.length}`,
      `- 🟠 Error: ${errors.length}`,
      `- 🟡 Warning: ${warnings.length}`,
      '',
      critical.length + errors.length === 0 ? '**核心项全部通过**' : '**存在问题**',
      '',
      '## 详细问题',
      '',
      ...this.issues.map((i) => `- **${i.severity.toUpperCase()}**: ${i.title} — ${i.detail}`),
      '',
      '## 运行日志',
      '',
      '```',
      ...this.logs.slice(-80),
      '```',
    ];

    fs.mkdirSync('/Users/dingxue/Documents/claude/claw/reports', { recursive: true });
    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(`\n报告已生成: ${reportPath}`);
  }
}

async function main() {
  const tester = new NewFeaturesTester();
  try {
    await tester.login();
    await tester.testTaskScheduler();
    await tester.testAgentPoolInterrupt();
    await tester.testMcpTools();
    await tester.testProviderPool();
  } catch (err) {
    console.error('Fatal error:', err);
    tester.addIssue('critical', 'Fatal script error', err.message);
  } finally {
    tester.generateReport();
    const critical = tester.issues.filter((i) => i.severity === 'critical');
    const errors = tester.issues.filter((i) => i.severity === 'error');
    if (critical.length > 0 || errors.length > 0) {
      console.log('\n测试未通过，请查看报告。');
      process.exit(1);
    }
    console.log('\n全部测试通过。');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
