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

(async () => {
  console.log('=== MySQL-data: simulate user open switch ===\n');

  // Step 1: Ensure it's inactive first
  await apiPatchMcpServer('mysql-data', { enabled: false });
  const list1 = await apiGetMcpServers();
  const srv1 = (list1.servers || []).find((s: any) => s.id === 'mysql-data');
  console.log('After setting inactive:', srv1?.status);

  // Step 2: Now try to open it (this is what user does)
  console.log('Sending PATCH { enabled: true }');
  const patch = await apiPatchMcpServer('mysql-data', { enabled: true });
  console.log('Patch response:', patch.status, JSON.stringify(patch.data));

  const list2 = await apiGetMcpServers();
  const srv2 = (list2.servers || []).find((s: any) => s.id === 'mysql-data');
  console.log('After opening switch:', srv2?.status);

  if (srv2?.status !== 'active') {
    console.error('FAIL: Could not open switch!');
    process.exitCode = 1;
  } else {
    console.log('PASS: Opened successfully');
  }
})();
