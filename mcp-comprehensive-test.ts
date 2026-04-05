import { resolve } from 'path';
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

function readLogTail(bytes = 300_000): string {
  const logPath = resolve('./server.log');
  if (!existsSync(logPath)) return '';
  const buf = readFileSync(logPath);
  const start = Math.max(0, buf.length - bytes);
  return buf.subarray(start).toString('utf-8');
}

function extractLastMcpPayload(): any[] {
  const tail = readLogTail();
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const match = line.match(/mcpPayload:\s*(.+)/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        return [];
      }
    }
  }
  return [];
}

// ─── Test ───────────────────────────────────────────────────────
(async () => {
  console.log('=== MCP Comprehensive Test (stdio + SSE + SDK shape) ===\n');
  let failed = false;

  const token = await apiLogin();

  // Cleanup previous test artifacts
  const listBefore = await apiGetMcpServers(token);
  for (const s of listBefore.servers || []) {
    if (String(s.name).startsWith('test-mcp-') || String(s.name) === 'mysql-data') {
      await apiDeleteMcpServer(token, s.id).catch(() => {});
    }
  }

  let stdioId = '';
  let sseId = '';
  let groupId = '';

  try {
    // ========== Test 1: Create stdio MCP ==========
    console.log('\n[Test 1] Create stdio MCP server');
    const stdioResp = await apiCreateMcpServer(token, {
      name: 'test-mcp-stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: { ROOT_DIR: '/tmp' },
      status: 'active',
    });
    if (!stdioResp.success) {
      console.error('FAIL:', JSON.stringify(stdioResp));
      failed = true;
    } else {
      stdioId = stdioResp.id;
      console.log('PASS: Created stdio MCP, id=', stdioId);
    }

    // ========== Test 2: Create SSE MCP (frontend payload style) ==========
    console.log('\n[Test 2] Create SSE MCP server (frontend payload style)');
    const sseResp = await apiCreateMcpServer(token, {
      id: 'mysql-data',
      type: 'sse',
      url: 'http://114.55.0.167:3007/mcp',
      headers: { Authorization: 'Bearer skdeuoeiwoeyffnheeewcucuuejmkuhb' },
      status: 'active',
    });
    if (!sseResp.success) {
      console.error('FAIL:', JSON.stringify(sseResp));
      failed = true;
    } else {
      sseId = sseResp.id;
      console.log('PASS: Created SSE MCP, id=', sseId);
    }

    // ========== Test 3: List returns correct types and fields ==========
    console.log('\n[Test 3] List returns correct types and fields');
    const list = await apiGetMcpServers(token);
    const stdioSrv = (list.servers || []).find((s: any) => s.id === stdioId);
    const sseSrv = (list.servers || []).find((s: any) => s.id === sseId);

    if (!stdioSrv || stdioSrv.type !== 'stdio') {
      console.error('FAIL: stdio server missing or wrong type:', stdioSrv?.type);
      failed = true;
    } else {
      console.log('PASS: stdio server has type=stdio');
    }

    if (!sseSrv || sseSrv.type !== 'sse' || !sseSrv.url || !sseSrv.headers) {
      console.error('FAIL: SSE server missing or incorrect fields:', sseSrv);
      failed = true;
    } else {
      console.log('PASS: SSE server has type=sse, url, headers');
    }

    // ========== Test 4: Edit SSE status to inactive ==========
    console.log('\n[Test 4] Edit SSE status to inactive');
    const patch = await apiUpdateMcpServer(token, sseId, { status: 'inactive' });
    if (!patch.success) {
      console.error('FAIL:', JSON.stringify(patch));
      failed = true;
    }
    const list2 = await apiGetMcpServers(token);
    const sseSrv2 = (list2.servers || []).find((s: any) => s.id === sseId);
    if (!sseSrv2 || sseSrv2.status !== 'inactive') {
      console.error('FAIL: Expected inactive status, got', sseSrv2?.status);
      failed = true;
    } else {
      console.log('PASS: SSE status patched to inactive');
    }

    // Re-enable for query test
    await apiUpdateMcpServer(token, sseId, { status: 'active' });

    // ========== Test 5: Claude SDK query receives correct shapes ==========
    console.log('\n[Test 5] Claude SDK query receives correct MCP shapes');
    groupId = await apiCreateGroup(token, 'test-mcp-sdk-shape');
    await apiSendMessage(token, groupId, 'Hello with both MCPs');
    await sleep(5000);

    const payload = extractLastMcpPayload();
    console.log('Last MCP payload passed to SDK:', JSON.stringify(payload));

    if (!Array.isArray(payload) || payload.length === 0) {
      console.error('FAIL: No MCP payload found in logs');
      failed = true;
    } else {
      const stdioObj = payload.find((obj: any) => obj['test-mcp-stdio']);
      const sseObj = payload.find((obj: any) => obj['mysql-data']);

      if (!stdioObj) {
        console.error('FAIL: stdio MCP not found in SDK payload');
        failed = true;
      } else {
        const cfg = stdioObj['test-mcp-stdio'];
        if (cfg?.type !== 'stdio' || cfg?.command !== 'npx') {
          console.error('FAIL: stdio SDK shape incorrect:', cfg);
          failed = true;
        } else {
          console.log('PASS: stdio MCP has correct SDK shape');
        }
      }

      if (!sseObj) {
        console.error('FAIL: SSE MCP not found in SDK payload');
        failed = true;
      } else {
        const cfg = sseObj['mysql-data'];
        if (cfg?.type !== 'sse' || cfg?.url !== 'http://114.55.0.167:3007/mcp') {
          console.error('FAIL: SSE SDK shape incorrect:', cfg);
          failed = true;
        } else {
          console.log('PASS: SSE MCP has correct SDK shape');
        }
      }
    }

    // Cleanup
    await apiDeleteGroup(token, groupId).catch(() => {});
    await apiDeleteMcpServer(token, stdioId).catch(() => {});
    await apiDeleteMcpServer(token, sseId).catch(() => {});

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
    await apiDeleteGroup(token, groupId).catch(() => {});
    await apiDeleteMcpServer(token, stdioId).catch(() => {});
    await apiDeleteMcpServer(token, sseId).catch(() => {});
  }
})();
