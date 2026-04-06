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
  const resp = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
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

async function apiSendMessage(token: string, chatJid: string, content: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ chatJid, content }),
  });
  return resp.json();
}

async function apiGetMessages(token: string, chatJid: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/groups/${chatJid}/messages?limit=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json();
}

async function apiDeleteGroup(token: string, chatJid: string) {
  await fetch(`${BASE_URL}/api/groups/${chatJid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readServerLogTail(lines = 100): Promise<string> {
  const { execSync } = await import('child_process');
  try {
    return execSync(`tail -n ${lines} /Users/dingxue/Documents/claude/claw/server.log`).toString('utf-8');
  } catch {
    return '';
  }
}

(async () => {
  console.log('=== Chat Reply Test ===\n');
  const token = await apiLogin();
  const me = await apiGetMe(token);
  const userId = me.user?.id || me.id;
  console.log('User:', userId);

  let groupId = '';
  try {
    groupId = await apiCreateGroup(token, 'test-chat-reply-' + Date.now());
    console.log('Group:', groupId);

    console.log('Sending message...');
    const sendResp = await apiSendMessage(token, groupId, 'Say exactly "PONG" and nothing else.');
    console.log('Send response:', JSON.stringify(sendResp));

    // Wait for potential reply
    console.log('Waiting 20s for reply...');
    await sleep(20000);

    const msgs = await apiGetMessages(token, groupId);
    console.log('Messages:', JSON.stringify((msgs.messages || []).map((m: any) => ({ role: m.role || m.sender, content: m.content?.slice(0, 80) }))));

    const assistantMsg = (msgs.messages || []).find((m: any) => (m.role || m.sender) === 'assistant' || m.sender === '__assistant__');
    if (assistantMsg) {
      console.log('PASS: Assistant replied:', assistantMsg.content);
    } else {
      console.error('FAIL: No assistant reply found.');
    }

    console.log('\n--- Server log tail ---');
    const logTail = await readServerLogTail(80);
    console.log(logTail);
  } finally {
    if (groupId) await apiDeleteGroup(token, groupId).catch(() => {});
  }
})();
