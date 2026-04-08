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

async function apiCreateMcpServer(token: string, body: any): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/mcp-servers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return resp.json();
}

async function apiGetMcpServers(token: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/mcp-servers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json();
}

async function apiPatchMcpServer(token: string, id: string, body: any): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/mcp-servers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: resp.status, data: await resp.json() };
}

async function apiToggleMcpServer(token: string, id: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/mcp-servers/${id}/toggle`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: resp.status, data: await resp.json() };
}

async function apiDeleteMcpServer(token: string, id: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/mcp-servers/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json();
}

(async () => {
  console.log('=== MCP Toggle/Status Debug Test ===\n');
  let failed = false;
  const token = await apiLogin();

  // cleanup old tests
  const listBefore = await apiGetMcpServers(token);
  for (const s of listBefore.servers || []) {
    if (String(s.name).startsWith('test-toggle-')) {
      await apiDeleteMcpServer(token, s.id).catch(() => {});
    }
  }

  // Test 1: Create without explicit status/enabled (should default to active)
  console.log('[Test 1] Create MCP without status/enabled');
  const create1 = await apiCreateMcpServer(token, {
    name: 'test-toggle-default',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
  });
  console.log('Create result:', JSON.stringify(create1));
  const list1 = await apiGetMcpServers(token);
  const srv1 = (list1.servers || []).find((s: any) => s.id === create1.id);
  console.log('Status after create:', srv1?.status);
  if (srv1?.status !== 'active') {
    console.error('FAIL: Expected active by default, got', srv1?.status);
    failed = true;
  } else {
    console.log('PASS: Default status is active');
  }

  // Test 2: Try toggle endpoint (what frontend likely calls)
  console.log('\n[Test 2] Call POST /api/mcp-servers/:id/toggle');
  const toggleResp = await apiToggleMcpServer(token, create1.id);
  console.log('Toggle response status:', toggleResp.status, 'body:', JSON.stringify(toggleResp.data));
  if (toggleResp.status === 404) {
    console.error('FAIL: Toggle endpoint returns 404 — route is missing in mcp-servers.ts');
    failed = true;
  } else if (toggleResp.status >= 200 && toggleResp.status < 300) {
    console.log('PASS: Toggle endpoint exists and returned', toggleResp.status);
  } else {
    console.error('FAIL: Toggle endpoint returned unexpected status', toggleResp.status);
    failed = true;
  }

  // Test 3: Toggle back via PATCH with status
  console.log('\n[Test 3] PATCH status active -> inactive -> active');
  const patchOff = await apiPatchMcpServer(token, create1.id, { status: 'inactive' });
  console.log('PATCH to inactive:', patchOff.status, JSON.stringify(patchOff.data));
  const list2 = await apiGetMcpServers(token);
  const srv2 = (list2.servers || []).find((s: any) => s.id === create1.id);
  if (srv2?.status !== 'inactive') {
    console.error('FAIL: Expected inactive after PATCH, got', srv2?.status);
    failed = true;
  } else {
    console.log('PASS: PATCH to inactive works');
  }

  const patchOn = await apiPatchMcpServer(token, create1.id, { status: 'active' });
  console.log('PATCH to active:', patchOn.status, JSON.stringify(patchOn.data));
  const list3 = await apiGetMcpServers(token);
  const srv3 = (list3.servers || []).find((s: any) => s.id === create1.id);
  if (srv3?.status !== 'active') {
    console.error('FAIL: Expected active after PATCH, got', srv3?.status);
    failed = true;
  } else {
    console.log('PASS: PATCH to active works');
  }

  // Test 4: Create with status: 'inactive' (simulate frontend creating closed)
  console.log('\n[Test 4] Create MCP with status: inactive');
  const create2 = await apiCreateMcpServer(token, {
    name: 'test-toggle-inactive',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    status: 'inactive',
  });
  const list4 = await apiGetMcpServers(token);
  const srv4 = (list4.servers || []).find((s: any) => s.id === create2.id);
  console.log('Status after create:', srv4?.status);
  if (srv4?.status !== 'inactive') {
    console.error('FAIL: Expected inactive, got', srv4?.status);
    failed = true;
  } else {
    console.log('PASS: Created as inactive correctly');
  }

  // cleanup
  await apiDeleteMcpServer(token, create1.id).catch(() => {});
  await apiDeleteMcpServer(token, create2.id).catch(() => {});

  console.log('\n=================================');
  if (failed) {
    console.log('RESULT: FAILED');
    process.exitCode = 1;
  } else {
    console.log('RESULT: ALL PASSED');
  }
  console.log('=================================');
})();
