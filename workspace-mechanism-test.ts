import { resolve } from 'path';
import { readdirSync, statSync, existsSync } from 'fs';

const BASE_URL = 'http://localhost:5173';
const ADMIN = { email: 'admin@example.com', password: 'admin123' };

// Helpers
async function apiLogin(): Promise<string> {
  const resp = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN.email, password: ADMIN.password }),
  });
  const data = await resp.json() as any;
  if (!data.token) throw new Error('Login failed: ' + JSON.stringify(data));
  return data.token;
}

async function apiCreateGroup(token: string, name: string): Promise<string> {
  const resp = await fetch(`${BASE_URL}/api/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  const data = await resp.json() as any;
  if (!data.jid) throw new Error('Create group failed: ' + JSON.stringify(data));
  return data.jid;
}

async function apiSendMessage(token: string, chatJid: string, content: string) {
  const resp = await fetch(`${BASE_URL}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ chatJid, content }),
  });
  return resp.json();
}

async function apiGetGroupMessages(token: string, chatJid: string) {
  const resp = await fetch(`${BASE_URL}/api/groups/${chatJid}/messages`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return resp.json() as Promise<{ messages: any[] }>;
}

async function apiResetSession(token: string, chatJid: string) {
  const resp = await fetch(`${BASE_URL}/api/groups/${chatJid}/reset-session`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return resp.json();
}

async function apiDeleteGroup(token: string, chatJid: string) {
  const resp = await fetch(`${BASE_URL}/api/groups/${chatJid}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return resp.json();
}

async function apiGetSessions(token: string) {
  const resp = await fetch(`${BASE_URL}/api/claude/sessions`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return resp.json() as Promise<{ data: any[] }>;
}

function listSessionDirs(userId: string, groupId: string): string[] {
  const base = resolve('./data/sessions', userId, groupId);
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((name) => {
    const full = resolve(base, name);
    return statSync(full).isDirectory();
  });
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  console.log('=== Workspace 3-Layer Mechanism Test ===\n');

  let failed = false;

  try {
    const token = await apiLogin();
    const meResp = await fetch(`${BASE_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } });
    const me = await meResp.json() as any;
    const userId = me.user?.id || me.id;
    console.log('User ID:', userId);

    // ============== Test 1: Session Reuse ==============
    console.log('\n[Test 1] Session Reuse');
    const groupId1 = await apiCreateGroup(token, 'test-session-reuse');
    console.log('Created group:', groupId1);

    await apiSendMessage(token, groupId1, 'Hello first message');
    await sleep(2000);
    await apiSendMessage(token, groupId1, 'Hello second message');
    await sleep(2000);

    const sessions1 = await apiGetSessions(token);
    const group1Sessions = sessions1.data.filter((s: any) => s.workspace === groupId1);
    console.log('Sessions for group1:', group1Sessions.length, group1Sessions.map((s: any) => s.sessionId));

    const dirs1 = listSessionDirs(userId, groupId1);
    console.log('Disk dirs for group1:', dirs1.length, dirs1);

    if (group1Sessions.length !== 1) {
      console.error('FAIL: Expected exactly 1 session for group, got', group1Sessions.length);
      failed = true;
    } else if (dirs1.length !== 1) {
      console.error('FAIL: Expected exactly 1 disk dir for group, got', dirs1.length);
      failed = true;
    } else {
      console.log('PASS: Session and directory are reused.');
    }

    await apiDeleteGroup(token, groupId1);

    // ============== Test 2: Group Delete cleans directories ==============
    console.log('\n[Test 2] Group Delete cleans directories');
    const groupId2 = await apiCreateGroup(token, 'test-delete-cleanup');
    await apiSendMessage(token, groupId2, 'msg in group2');
    await sleep(2000);

    const group2WorkDir = resolve('./data/sessions', `group-${groupId2.slice(0, 8)}`);
    const dirsBefore = listSessionDirs(userId, groupId2);
    console.log('Session dirs before delete:', dirsBefore, '| groupWorkDir exists:', existsSync(group2WorkDir));

    await apiDeleteGroup(token, groupId2);
    await sleep(2000);

    const dirsAfter = listSessionDirs(userId, groupId2);
    const baseCheck = resolve('./data/sessions', userId, groupId2);
    console.log('Session dirs after delete:', dirsAfter.length, dirsAfter, '| groupWorkDir exists after:', existsSync(group2WorkDir));
    console.log('Base path checked:', baseCheck, '| exists:', existsSync(baseCheck));
    if (existsSync(baseCheck)) {
      const raw = readdirSync(baseCheck);
      console.log('Raw contents of base:', raw);
    }

    if (dirsAfter.length > 0 || existsSync(group2WorkDir)) {
      console.error('FAIL: Expected session directories to be removed after group delete');
      failed = true;
    } else {
      console.log('PASS: Group directories cleaned up correctly.');
    }

    // ============== Test 3: Reset Session creates new session ==============
    console.log('\n[Test 3] Reset Session creates new session');
    const groupId3 = await apiCreateGroup(token, 'test-reset-session');
    await apiSendMessage(token, groupId3, 'before reset');
    await sleep(2000);

    const sessionsBefore = await apiGetSessions(token);
    const beforeIds = sessionsBefore.data.filter((s: any) => s.workspace === groupId3).map((s: any) => s.sessionId);
    console.log('Session IDs before reset:', beforeIds);

    await apiResetSession(token, groupId3);
    await sleep(2000);

    await apiSendMessage(token, groupId3, 'after reset');
    await sleep(2000);

    const sessionsAfter = await apiGetSessions(token);
    const afterIds = sessionsAfter.data.filter((s: any) => s.workspace === groupId3).map((s: any) => s.sessionId);
    console.log('Session IDs after reset:', afterIds);

    if (afterIds.length !== 1) {
      console.error('FAIL: Expected exactly 1 session after reset, got', afterIds.length);
      failed = true;
    } else if (beforeIds[0] === afterIds[0]) {
      console.error('FAIL: Expected a NEW session after reset, but got the same session ID');
      failed = true;
    } else {
      console.log('PASS: Reset session created a new session successfully.');
    }

    await apiDeleteGroup(token, groupId3);

    // ============== Test 4: Messages aggregate across sessions ==============
    console.log('\n[Test 4] Messages aggregate across sessions');
    const groupId4 = await apiCreateGroup(token, 'test-message-aggregate');
    await apiSendMessage(token, groupId4, 'msg one');
    await sleep(2000);
    await apiSendMessage(token, groupId4, 'msg two');
    await sleep(2000);

    const msgs = await apiGetGroupMessages(token, groupId4);
    const userMsgs = msgs.messages.filter((m: any) => m.sender === userId);
    console.log('Aggregated user messages:', userMsgs.length, userMsgs.map((m: any) => m.content));

    if (userMsgs.length !== 2) {
      console.error('FAIL: Expected 2 aggregated messages, got', userMsgs.length);
      failed = true;
    } else {
      console.log('PASS: Messages aggregated correctly across sessions.');
    }

    await apiDeleteGroup(token, groupId4);

    console.log('\n=================================');
    if (failed) {
      console.log('RESULT: FAILED (see errors above)');
      process.exitCode = 1;
    } else {
      console.log('RESULT: ALL PASSED');
    }
    console.log('=================================');
  } catch (e) {
    console.error('Unexpected error:', e);
    process.exitCode = 1;
  }
})();
