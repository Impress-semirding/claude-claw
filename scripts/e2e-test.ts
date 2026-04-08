const BASE = 'http://localhost:3000';

let adminToken = '';
let userToken = '';
let groupJid = '';
let sessionId = '';
let messageId = '';
let taskId = '';
let skillId = '';
let agentId = '';
let inviteCode = '';

function log(title: string, res: any) {
  const ok = res.ok ? '✅' : '❌';
  console.log(`${ok} ${title}: ${JSON.stringify(res).slice(0, 200)}`);
}

async function req(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined || (method !== 'GET' && method !== 'DELETE' && method !== 'HEAD')) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, body: json, text };
}

async function runTests() {
  console.log('=== E2E API Tests ===\n');

  // 1. Auth flow
  const status = await req('GET', '/api/auth/status');
  log('Auth status', status);

  const setup = await req('POST', '/api/auth/setup', { username: 'admin@example.com', password: 'admin123' });
  log('Setup admin', setup);
  if (setup.body.token) adminToken = setup.body.token;

  const regStatus = await req('GET', '/api/auth/register/status');
  log('Register status', regStatus);

  const login = await req('POST', '/api/auth/login', { username: 'admin@example.com', password: 'admin123' });
  log('Admin login', login);
  if (login.body.token) adminToken = login.body.token;

  const me = await req('GET', '/api/auth/me', undefined, adminToken);
  log('GET /me', me);

  const profile = await req('PUT', '/api/auth/profile', { display_name: 'Admin User', ai_name: 'Claude' }, adminToken);
  log('Update profile', profile);

  const sessions = await req('GET', '/api/auth/sessions', undefined, adminToken);
  log('List sessions', sessions);

  // 2. Groups
  const groups = await req('GET', '/api/groups', undefined, adminToken);
  log('List groups', groups);

  const createGroup = await req('POST', '/api/groups', { name: 'Test Group', description: 'E2E test' }, adminToken);
  log('Create group', createGroup);
  groupJid = createGroup.body.jid || '';

  const groupDetail = await req('GET', `/api/groups/${groupJid}`, undefined, adminToken);
  log('Group detail', groupDetail);

  const patchGroup = await req('PATCH', `/api/groups/${groupJid}`, { name: 'Updated Group', execution_mode: 'host' }, adminToken);
  log('Patch group', patchGroup);

  const members = await req('GET', `/api/groups/${groupJid}/members`, undefined, adminToken);
  log('Group members', members);

  const envPut = await req('PUT', `/api/groups/${groupJid}/env`, { env: { TEST_KEY: 'test_value' } }, adminToken);
  log('Put env', envPut);

  const envGet = await req('GET', `/api/groups/${groupJid}/env`, undefined, adminToken);
  log('Get env', envGet);

  // 3. Messages
  const sendMsg = await req('POST', '/api/messages', { chat_jid: groupJid, content: 'Hello from E2E' }, adminToken);
  log('Send message', sendMsg);
  messageId = sendMsg.body.message?.id || '';

  const groupMsgs = await req('GET', `/api/groups/${groupJid}/messages?limit=10`, undefined, adminToken);
  log('Group messages', groupMsgs);

  // 4. Claude sessions
  const claudeSessions = await req('GET', '/api/claude/sessions', undefined, adminToken);
  log('Claude sessions', claudeSessions);
  const sess = claudeSessions.body.sessions?.[0];
  sessionId = sess?.id || '';

  const queryStream = await fetch(`${BASE}/api/claude/query?sessionId=${sessionId || 'new'}&workspace=${groupJid}&prompt=hi`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  log('Claude query stream', { status: queryStream.status, ok: queryStream.ok, body: {} });

  // 5. Files
  const filesList = await req('GET', `/api/groups/${groupJid}/files`, undefined, adminToken);
  log('List files', filesList);

  const mkdirRes = await req('POST', `/api/groups/${groupJid}/files/directories`, { path: '/', name: 'test-dir' }, adminToken);
  log('Mkdir', mkdirRes);

  const filePathB64 = Buffer.from('test-dir/hello.txt').toString('base64');
  const writeFile = await req('PUT', `/api/groups/${groupJid}/files/content/${filePathB64}`, { content: 'hello world' }, adminToken);
  log('Write file', writeFile);

  const readFile = await req('GET', `/api/groups/${groupJid}/files/content/${filePathB64}`, undefined, adminToken);
  log('Read file', readFile);

  const delFile = await req('DELETE', `/api/groups/${groupJid}/files/${filePathB64}`, undefined, adminToken);
  log('Delete file', delFile);

  // 6. Tasks
  const tasks = await req('GET', '/api/tasks', undefined, adminToken);
  log('List tasks', tasks);

  const createTask = await req('POST', '/api/tasks', { name: 'Test Task', command: 'echo hello', schedule: '0 0 * * *' }, adminToken);
  log('Create task', createTask);
  taskId = createTask.body.task?.id || '';

  if (taskId) {
    const runTask = await req('POST', `/api/tasks/${taskId}/run`, {}, adminToken);
    log('Run task', runTask);

    const taskLogs = await req('GET', `/api/tasks/${taskId}/logs`, undefined, adminToken);
    log('Task logs', taskLogs);

    const delTask = await req('DELETE', `/api/tasks/${taskId}`, undefined, adminToken);
    log('Delete task', delTask);
  }

  // 7. Skills
  const skills = await req('GET', '/api/skills', undefined, adminToken);
  log('List skills', skills);

  const createSkill = await req('POST', '/api/skills', { name: 'Test Skill', description: 'test', command: 'echo skill' }, adminToken);
  log('Create skill', createSkill);
  skillId = createSkill.body.skill?.id || '';

  if (skillId) {
    const delSkill = await req('DELETE', `/api/skills/${skillId}`, undefined, adminToken);
    log('Delete skill', delSkill);
  }

  // 8. Agent definitions
  const agents = await req('GET', '/api/agent-definitions', undefined, adminToken);
  log('List agent definitions', agents);

  const createAgent = await req('POST', '/api/agent-definitions', { name: 'Test Agent', content: 'You are a test agent' }, adminToken);
  log('Create agent definition', createAgent);
  agentId = createAgent.body.id || '';

  if (agentId) {
    const getAgent = await req('GET', `/api/agent-definitions/${agentId}`, undefined, adminToken);
    log('Get agent definition', getAgent);

    const delAgent = await req('DELETE', `/api/agent-definitions/${agentId}`, undefined, adminToken);
    log('Delete agent definition', delAgent);
  }

  // 9. Billing
  const billingStatus = await req('GET', '/api/billing/status', undefined, adminToken);
  log('Billing status', billingStatus);

  const billingMy = await req('GET', '/api/billing/my/balance', undefined, adminToken);
  log('Billing my balance', billingMy);

  const billingUsage = await req('GET', '/api/billing/my/usage', undefined, adminToken);
  log('Billing my usage', billingUsage);

  const billingPlans = await req('GET', '/api/billing/plans', undefined, adminToken);
  log('Billing plans', billingPlans);

  // 10. Usage
  const usageStats = await req('GET', '/api/usage/stats?days=7', undefined, adminToken);
  log('Usage stats', usageStats);

  const usageModels = await req('GET', '/api/usage/models', undefined, adminToken);
  log('Usage models', usageModels);

  // 11. Config
  const configAppearance = await req('GET', '/api/config/appearance', undefined, adminToken);
  log('Config appearance', configAppearance);

  const configSystem = await req('GET', '/api/config/system', undefined, adminToken);
  log('Config system', configSystem);

  // 12. Status
  const statusSys = await req('GET', '/api/status', undefined, adminToken);
  log('System status', statusSys);

  // 13. Admin
  const adminUsers = await req('GET', '/api/admin/users', undefined, adminToken);
  log('Admin users', adminUsers);

  const adminAudit = await req('GET', '/api/admin/audit-log', undefined, adminToken);
  log('Admin audit log', adminAudit);

  const inviteCreate = await req('POST', '/api/admin/invites', { max_uses: 5 }, adminToken);
  log('Create invite', inviteCreate);
  inviteCode = inviteCreate.body.code || '';

  if (inviteCode) {
    const inviteList = await req('GET', '/api/admin/invites', undefined, adminToken);
    log('List invites', inviteList);
  }

  // 14. Memory
  const memorySources = await req('GET', '/api/memory/sources', undefined, adminToken);
  log('Memory sources', memorySources);

  // 15. Docker
  const dockerImages = await req('GET', '/api/docker/images', undefined, adminToken);
  log('Docker images', dockerImages);

  // 16. MCP servers
  const mcpServers = await req('GET', '/api/mcp-servers', undefined, adminToken);
  log('MCP servers', mcpServers);

  // 17. Group stop / interrupt / clear-history / reset-session
  const stopGroup = await req('POST', `/api/groups/${groupJid}/stop`, {}, adminToken);
  log('Stop group', stopGroup);

  const interruptGroup = await req('POST', `/api/groups/${groupJid}/interrupt`, {}, adminToken);
  log('Interrupt group', interruptGroup);

  const resetSession = await req('POST', `/api/groups/${groupJid}/reset-session`, {}, adminToken);
  log('Reset session', resetSession);

  const clearHistory = await req('POST', `/api/groups/${groupJid}/clear-history`, {}, adminToken);
  log('Clear history', clearHistory);

  // Cleanup: delete group
  const delGroup = await req('DELETE', `/api/groups/${groupJid}`, undefined, adminToken);
  log('Delete group', delGroup);

  console.log('\n=== Tests complete ===');
}

runTests().catch(console.error);
