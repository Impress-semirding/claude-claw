import { resolve, join } from 'path';
import { existsSync, readFileSync } from 'fs';

const BASE_URL = 'http://localhost:3000';
const ADMIN = { email: 'admin@example.com', password: 'admin123' };

async function apiLogin(): Promise<string> {
  const resp = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN.email, password: ADMIN.password }),
  });
  const data = (await resp.json()) as any;
  if (!data.token) throw new Error('Login failed: ' + JSON.stringify(data));
  return data.token;
}

async function apiGetMe(token: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json();
}

async function apiGetMcpServers(token: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/mcp-servers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json();
}

async function apiCreateMcpServer(token: string, body: any): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/mcp-servers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return resp.json();
}

async function apiUpdateMcpServer(token: string, id: string, body: any): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/mcp-servers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return resp.json();
}

async function apiDeleteMcpServer(token: string, id: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/mcp-servers/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json();
}

async function apiCreateGroup(token: string, name: string): Promise<string> {
  const resp = await fetch(`${BASE_URL}/api/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  const data = (await resp.json()) as any;
  if (!data.jid) throw new Error('Create group failed: ' + JSON.stringify(data));
  return data.jid;
}

async function apiSendMessage(token: string, chatJid: string, content: string) {
  const resp = await fetch(`${BASE_URL}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ chatJid, content }),
  });
  return resp.json();
}

async function apiDeleteGroup(token: string, chatJid: string) {
  const resp = await fetch(`${BASE_URL}/api/groups/${chatJid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function readLogTail(bytes = 200_000): string {
  const logPath = resolve('./server.log');
  if (!existsSync(logPath)) return '';
  const buf = readFileSync(logPath);
  const start = Math.max(0, buf.length - bytes);
  return buf.subarray(start).toString('utf-8');
}

function extractLastMcpNamesFromLog(): string[] {
  const tail = readLogTail();
  const lines = tail.split('\n');
  // find the last mcpNames: [...] line
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const match = line.match(/mcpNames:\s*\[([^\]]*)\]/);
    if (match) {
      return match[1]
        .split(',')
        .map((s) => s.trim().replace(/^'/, '').replace(/'$/, ''))
        .filter(Boolean);
    }
  }
  return [];
}

// ─── Test ──────────────────────────────────────────────────────

(async () => {
  console.log('=== MCP End-to-End Test ===\n');
  let failed = false;

  const token = await apiLogin();
  const me = await apiGetMe(token);
  const userId = me.user?.id || me.id;
  console.log('User ID:', userId);

  let activeId = '';
  let inactiveId = '';

  try {
    // Clean previous test artifacts
    const listBefore = await apiGetMcpServers(token);
    const prevServers: any[] = listBefore.servers || [];
    for (const s of prevServers) {
      if (String(s.name).startsWith('test-mcp-')) {
        await apiDeleteMcpServer(token, s.id);
      }
    }

    // ========== Test 1: Create active MCP server ==========
    console.log('\n[Test 1] Create active MCP server');
    const createActive = await apiCreateMcpServer(token, {
      name: 'test-mcp-active',
      command: 'npx',
      args: ['-y', '@anthropic-ai/mcp-test'],
      env: { KEY: 'value1' },
      status: 'active',
    });
    if (!createActive.success) {
      console.error('FAIL: Create active MCP server failed:', JSON.stringify(createActive));
      failed = true;
    } else {
      activeId = createActive.id;
      console.log('PASS: Created active MCP server, id=', activeId);
    }

    // ========== Test 2: Create inactive MCP server ==========
    console.log('\n[Test 2] Create inactive MCP server');
    const createInactive = await apiCreateMcpServer(token, {
      name: 'test-mcp-inactive',
      command: 'npx',
      args: ['-y', '@anthropic-ai/mcp-test'],
      env: {},
      status: 'inactive',
    });
    if (!createInactive.success) {
      console.error('FAIL: Create inactive MCP server failed:', JSON.stringify(createInactive));
      failed = true;
    } else {
      inactiveId = createInactive.id;
      console.log('PASS: Created inactive MCP server, id=', inactiveId);
    }

    // ========== Test 3: List with correct status mapping ==========
    console.log('\n[Test 3] List verifies status mapping');
    const listResult = await apiGetMcpServers(token);
    const servers: any[] = listResult.servers || [];
    const activeSrv = servers.find((s) => s.id === activeId);
    const inactiveSrv = servers.find((s) => s.id === inactiveId);

    if (!activeSrv || activeSrv.status !== 'active') {
      console.error('FAIL: Active server missing or wrong status:', activeSrv?.status);
      failed = true;
    } else {
      console.log('PASS: Active server has status=active');
    }

    if (!inactiveSrv || inactiveSrv.status !== 'inactive') {
      console.error('FAIL: Inactive server missing or wrong status:', inactiveSrv?.status);
      failed = true;
    } else {
      console.log('PASS: Inactive server has status=inactive');
    }

    // Also verify that native /api/mcp returns enabled boolean (not status string)
    const nativeResp = await fetch(`${BASE_URL}/api/mcp`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const nativeData = await nativeResp.json();
    const nativeActive = (nativeData.data || []).find((s: any) => s.id === activeId);
    if (!nativeActive || nativeActive.enabled !== true) {
      console.error('FAIL: Native layer should return enabled=true boolean');
      failed = true;
    } else {
      console.log('PASS: Native API returns enabled boolean correctly.');
    }

    // ========== Test 4: Update status via PATCH ==========
    console.log('\n[Test 4] PATCH status active -> inactive');
    const patch1 = await apiUpdateMcpServer(token, activeId, { status: 'inactive' });
    if (!patch1.success) {
      console.error('FAIL: PATCH returned error:', JSON.stringify(patch1));
      failed = true;
    }
    const listAfterPatch = await apiGetMcpServers(token);
    const patchedActive = (listAfterPatch.servers || []).find((s: any) => s.id === activeId);
    if (!patchedActive || patchedActive.status !== 'inactive') {
      console.error('FAIL: Expected patched server to be inactive, got', patchedActive?.status);
      failed = true;
    } else {
      console.log('PASS: PATCH correctly toggled status to inactive.');
    }

    // Toggle back to active
    await apiUpdateMcpServer(token, activeId, { status: 'active' });

    // ========== Test 5: Update args/env via PATCH ==========
    console.log('\n[Test 5] PATCH preserves args/env structure');
    await apiUpdateMcpServer(token, activeId, {
      args: ['node', 'server.js'],
      env: { API_KEY: 'secret', NUM_WORKERS: '4' },
    });
    const listAfterEnvPatch = await apiGetMcpServers(token);
    const envPatched = (listAfterEnvPatch.servers || []).find((s: any) => s.id === activeId);
    if (!envPatched) {
      console.error('FAIL: Server missing after env patch');
      failed = true;
    } else if (JSON.stringify(envPatched.args) !== JSON.stringify(['node', 'server.js'])) {
      console.error('FAIL: Args mismatch after patch:', envPatched.args);
      failed = true;
    } else if (envPatched.env?.API_KEY !== 'secret') {
      console.error('FAIL: Env mismatch after patch:', envPatched.env);
      failed = true;
    } else {
      console.log('PASS: Args and env persisted correctly.');
    }

    // ========== Test 6: QuerySession receives enabled MCP servers ==========
    console.log('\n[Test 6] Claude SDK query receives enabled MCP servers');
    const groupId = await apiCreateGroup(token, 'test-mcp-query');
    console.log('Created group:', groupId);

    // We first check findEnabled via the native mcp layer indirectly:
    // Native API returns only enabled when we query /api/mcp/:id individually,
    // but /api/mcp returns all. We rely on messages.ts calling findEnabled().

    // Trigger message (likely to fail because no real LLM/API key, but enough to reach log line)
    await apiSendMessage(token, groupId, 'Hello with MCP');
    await sleep(4000);
    const names = extractLastMcpNamesFromLog();
    console.log('MCP servers passed to querySession:', names);
    if (!names.includes('test-mcp-active')) {
      console.error('FAIL: Enabled MCP server "test-mcp-active" was NOT passed to querySession');
      failed = true;
    } else {
      console.log('PASS: Enabled MCP server is passed to querySession.');
    }
    if (names.includes('test-mcp-inactive')) {
      console.error('FAIL: Inactive MCP server should NOT be passed to querySession');
      failed = true;
    } else {
      console.log('PASS: Inactive MCP server is excluded from querySession.');
    }

    // Wait for Test 6 query to finish so runningQueries lock is released
    console.log('Waiting for previous query to finish...');
    await sleep(8000);

    // ========== Test 7: After deleting active server, query gets empty MCP list ==========
    console.log('\n[Test 7] After deleting all test MCPs, query gets empty MCP list');
    await apiDeleteMcpServer(token, activeId);
    await apiDeleteMcpServer(token, inactiveId);

    const groupId2 = await apiCreateGroup(token, 'test-mcp-empty');
    await apiSendMessage(token, groupId2, 'Hello without MCP');
    await sleep(4000);
    const names2 = extractLastMcpNamesFromLog();
    console.log('MCP servers after deletion:', names2);
    if (names2.length > 0) {
      console.error('FAIL: Expected empty MCP list after deletion, got', names2);
      failed = true;
    } else {
      console.log('PASS: Empty MCP list passed after deletion.');
    }

    await apiDeleteGroup(token, groupId);
    await apiDeleteGroup(token, groupId2);

    console.log('\n=================================');
    if (failed) {
      console.log('RESULT: FAILED (see errors above)');
      process.exitCode = 1;
    } else {
      console.log('RESULT: ALL PASSED');
    }
    console.log('=================================');
  } catch (e: any) {
    console.error('Unexpected error:', e);
    process.exitCode = 1;
    // cleanup
    if (activeId) await apiDeleteMcpServer(token, activeId).catch(() => {});
    if (inactiveId) await apiDeleteMcpServer(token, inactiveId).catch(() => {});
  }
})();
