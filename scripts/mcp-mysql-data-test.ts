const BASE_URL = 'http://localhost:3000';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiI4ZDQ4ZWM2ZS04MTBmLTRjOTctYjE3OS1jNDFiZDA4MzZkYjIiLCJlbWFpbCI6ImFkbWluQGV4YW1wbGUuY29tIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzc1MzQ5NDg1LCJleHAiOjE3NzU5NTQyODV9.eYAmXQgTqYP4vU8jDeWaSr7l0bC5CQytuLtRlqttEK4';

async function apiGetMcpServers(): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/mcp-servers`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return resp.json();
}

async function apiPatchMcpServer(id: string, body: any): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/mcp-servers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  return { status: resp.status, data: await resp.json() };
}

async function apiNativeGetMcpServer(id: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/mcp/${id}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return resp.json();
}

(async () => {
  console.log('=== MySQL-data MCP Toggle Debug ===\n');

  // Step 1: Check current state
  const list1 = await apiGetMcpServers();
  const srv1 = (list1.servers || []).find((s: any) => s.id === 'mysql-data');
  console.log('Initial state:', JSON.stringify(srv1));

  // Step 2: Toggle off if active, or on if inactive, then verify
  const targetEnabled = srv1?.status === 'active' ? false : true;
  console.log('\nPatching enabled to', targetEnabled);
  const patch = await apiPatchMcpServer('mysql-data', { enabled: targetEnabled });
  console.log('Patch response:', patch.status, JSON.stringify(patch.data));

  const list2 = await apiGetMcpServers();
  const srv2 = (list2.servers || []).find((s: any) => s.id === 'mysql-data');
  console.log('State after PATCH:', JSON.stringify(srv2));

  if (!!srv2?.enabled !== targetEnabled && srv2?.status !== (targetEnabled ? 'active' : 'inactive')) {
    console.error('FAIL: PATCH did not change state');
  } else {
    console.log('PASS: State changed correctly');
  }

  // Step 3: Check native API
  const native = await apiNativeGetMcpServer('mysql-data');
  console.log('\nNative API state:', JSON.stringify(native.data));
})();
