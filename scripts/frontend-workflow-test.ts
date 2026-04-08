import { resolve, join } from 'path';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
  statSync,
} from 'fs';

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

async function apiDeleteGroup(token: string, chatJid: string) {
  const resp = await fetch(`${BASE_URL}/api/groups/${chatJid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json();
}

async function apiSendMessage(token: string, chatJid: string, content: string) {
  const resp = await fetch(`${BASE_URL}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ chatJid, content }),
  });
  return resp.json();
}

async function apiGetSessions(token: string) {
  const resp = await fetch(`${BASE_URL}/api/claude/sessions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json() as Promise<{ data: any[] }>;
}

// ─── Skill APIs ─────────────────────────────────────────────────
async function apiPostSkill(token: string, body: any): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return resp.json();
}

async function apiGetSkills(token: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/skills`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json();
}

async function apiDeleteSkill(token: string, id: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/skills/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json();
}

// ─── MCP APIs ───────────────────────────────────────────────────
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

async function apiDeleteMcpServer(token: string, id: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/mcp-servers/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json();
}

// ─── Memory APIs ────────────────────────────────────────────────
async function apiPutMemoryGlobal(token: string, content: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/memory/global`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content }),
  });
  return resp.json();
}

async function apiGetMemoryGlobal(token: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/memory/global`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json();
}

// ─── Helpers ────────────────────────────────────────────────────
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

function extractLastQueryLog(): { mcpNames: string[]; systemPromptLength: number; promptLength: number } {
  const tail = readLogTail();
  const lines = tail.split('\n');
  const result = { mcpNames: [] as string[], systemPromptLength: -1, promptLength: -1 };

  // Find last [messages] startQuery
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.includes('[messages] startQuery')) {
      // scan forward within the next 10 lines for fields
      for (let j = i; j < Math.min(i + 15, lines.length); j++) {
        const l = lines[j];
        const mcpMatch = l.match(/mcpNames:\s*\[([^\]]*)\]/);
        if (mcpMatch) {
          result.mcpNames = mcpMatch[1]
            .split(',')
            .map((s) => s.trim().replace(/^'/, '').replace(/'$/, ''))
            .filter(Boolean);
        }
      }
      break;
    }
  }

  // Find last [claude-session] querySession start - but systemPrompt isn't logged there.
  // Better: check server.log for "systemPromptLength" that we added
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const spMatch = line.match(/systemPromptLength:\s*(\d+)/);
    if (spMatch) {
      result.systemPromptLength = parseInt(spMatch[1], 10);
      break;
    }
  }

  return result;
}

function listDirs(p: string): string[] {
  if (!existsSync(p)) return [];
  return readdirSync(p).filter((n) => statSync(join(p, n)).isDirectory());
}

// ─── Test ───────────────────────────────────────────────────────
(async () => {
  console.log('=== Frontend Workflow E2E Test (Skill + MCP + Memory) ===\n');
  let failed = false;

  const token = await apiLogin();
  const me = await apiGetMe(token);
  const userId = me.user?.id || me.id;
  console.log('User ID:', userId);

  const sessionBaseDir = resolve('./data/sessions');
  const userSkillsDir = resolve('./data/skills', userId);

  // Cleanup old test artifacts
  const skillsList = await apiGetSkills(token);
  for (const s of skillsList.skills || []) {
    if (String(s.id).startsWith('test-frontend-')) {
      await apiDeleteSkill(token, s.id).catch(() => {});
    }
  }
  const mcpList = await apiGetMcpServers(token);
  for (const s of mcpList.servers || []) {
    if (String(s.name).startsWith('test-frontend-')) {
      await apiDeleteMcpServer(token, s.id).catch(() => {});
    }
  }
  // clean global memory
  await apiPutMemoryGlobal(token, '');

  const skillId = 'test-frontend-skill';
  const mcpName = 'test-frontend-mcp';
  let groupId = '';
  let mcpId = '';

  try {
    // ========== Test 1: Frontend adds skill ==========
    console.log('\n[Test 1] Frontend adds skill via POST /api/skills');
    const skillContent = `---\nname: Frontend Test Skill\ndescription: A skill created from the frontend\nuser-invocable: true\nallowed-tools: bash\n---\n\nYou are a helpful test assistant.\n`;
    const createSkill = await apiPostSkill(token, {
      id: skillId,
      name: 'Frontend Test Skill',
      description: 'A skill created from the frontend',
      source: 'user',
      enabled: true,
      content: skillContent,
      config: { userInvocable: true, allowedTools: ['bash'] },
    });
    if (!createSkill.success) {
      console.error('FAIL: Skill creation failed:', JSON.stringify(createSkill));
      failed = true;
    } else {
      const skillOnDisk = existsSync(join(userSkillsDir, skillId, 'SKILL.md'));
      if (!skillOnDisk) {
        console.error('FAIL: Skill created in DB but not written to user skills directory');
        failed = true;
      } else {
        console.log('PASS: Skill created and persisted to filesystem.');
      }
    }

    // ========== Test 2: Frontend adds MCP server ==========
    console.log('\n[Test 2] Frontend adds MCP server via POST /api/mcp-servers');
    const createMcp = await apiCreateMcpServer(token, {
      name: mcpName,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: { ROOT_DIR: '/tmp' },
      status: 'active',
    });
    if (!createMcp.success) {
      console.error('FAIL: MCP server creation failed:', JSON.stringify(createMcp));
      failed = true;
    } else {
      mcpId = createMcp.id;
      const mcpList2 = await apiGetMcpServers(token);
      const found = (mcpList2.servers || []).find((s: any) => s.id === mcpId);
      if (!found || found.status !== 'active') {
        console.error('FAIL: MCP server not found or not active in list');
        failed = true;
      } else {
        console.log('PASS: MCP server created and listed as active.');
      }
    }

    // ========== Test 3: Frontend sets global memory ==========
    console.log('\n[Test 3] Frontend sets global memory via PUT /api/memory/global');
    const memoryContent = '# Global Memory\nAlways respond with "OK" at the end.';
    const putMem = await apiPutMemoryGlobal(token, memoryContent);
    if (!putMem.success) {
      console.error('FAIL: Memory update failed:', JSON.stringify(putMem));
      failed = true;
    } else {
      const getMem = await apiGetMemoryGlobal(token);
      if (getMem.content !== memoryContent) {
        console.error('FAIL: Memory content mismatch after write');
        failed = true;
      } else {
        console.log('PASS: Global memory written and readable.');
      }
    }

    // ========== Test 4: User asks a question ==========
    console.log('\n[Test 4] User sends message triggering querySession');
    groupId = await apiCreateGroup(token, 'test-frontend-workflow');
    console.log('Created group:', groupId);

    await apiSendMessage(token, groupId, 'Hello from frontend');
    await sleep(5000);

    // ========== Test 5: Skill injected into session ==========
    console.log('\n[Test 5] Skill injected into session directory');
    const sessionsResp = await apiGetSessions(token);
    const session = (sessionsResp.data || []).find((s: any) => s.workspace === groupId);
    if (!session) {
      console.error('FAIL: No active session found for group');
      failed = true;
    } else {
      const sessionSkillsDir = resolve(sessionBaseDir, session.workDir, '.claude', 'skills');
      const copiedSkills = listDirs(sessionSkillsDir);
      console.log('Skills in session:', copiedSkills);
      if (!copiedSkills.includes(skillId)) {
        console.error('FAIL: Frontend-created skill not found in session .claude/skills');
        failed = true;
      } else {
        const injectedMd = readFileSync(join(sessionSkillsDir, skillId, 'SKILL.md'), 'utf-8');
        if (!injectedMd.includes('Frontend Test Skill')) {
          console.error('FAIL: Injected skill content is incorrect');
          failed = true;
        } else {
          console.log('PASS: Frontend skill correctly injected into session.');
        }
      }
    }

    // ========== Test 6: MCP server passed to querySession ==========
    console.log('\n[Test 6] MCP server passed to querySession');
    const queryLog = extractLastQueryLog();
    console.log('Query log extract:', JSON.stringify(queryLog));
    if (!queryLog.mcpNames.includes(mcpName)) {
      console.error('FAIL: Frontend-created MCP server not passed to querySession');
      failed = true;
    } else {
      console.log('PASS: MCP server correctly passed to querySession.');
    }

    // ========== Test 7: Memory passed to querySession as systemPrompt ==========
    console.log('\n[Test 7] Global memory passed to querySession as systemPrompt');
    if (queryLog.systemPromptLength <= 0) {
      console.error('FAIL: Global memory was NOT passed as systemPrompt (length <= 0)');
      failed = true;
    } else {
      console.log('PASS: Global memory appears in systemPrompt, length=', queryLog.systemPromptLength);
    }

    // Cleanup
    await apiDeleteGroup(token, groupId).catch(() => {});
    await apiDeleteSkill(token, skillId).catch(() => {});
    await apiDeleteMcpServer(token, mcpId).catch(() => {});
    await apiPutMemoryGlobal(token, '').catch(() => {});

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
    await apiDeleteSkill(token, skillId).catch(() => {});
    await apiDeleteMcpServer(token, mcpId).catch(() => {});
    await apiPutMemoryGlobal(token, '').catch(() => {});
  }
})();
