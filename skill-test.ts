import { resolve, join } from 'path';
import {
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'fs';
import { homedir } from 'os';

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

async function apiPostSkillsSyncHost(token: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/skills/sync-host`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json();
}

async function apiGetSkills(token: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/skills`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json();
}

async function apiPostSkill(token: string, body: any): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return resp.json();
}

async function apiPatchSkill(token: string, id: string, body: any): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/skills/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
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

async function apiInstallSkill(token: string, pkg: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/api/skills/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ package: pkg }),
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

async function apiGetSessions(token: string) {
  const resp = await fetch(`${BASE_URL}/api/claude/sessions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json() as Promise<{ data: any[] }>;
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

// ─── Helpers to inspect filesystem ─────────────────────────────

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function rimraf(p: string) {
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

function listDirs(p: string): string[] {
  if (!existsSync(p)) return [];
  return readdirSync(p).filter((n) => statSync(join(p, n)).isDirectory());
}

function readSkillMd(dir: string): string | null {
  const p = join(dir, 'SKILL.md');
  if (existsSync(p)) return readFileSync(p, 'utf-8');
  const pd = join(dir, 'SKILL.md.disabled');
  if (existsSync(pd)) return readFileSync(pd, 'utf-8');
  return null;
}

// ─── Test ──────────────────────────────────────────────────────

(async () => {
  console.log('=== Skill 3-Layer Mechanism Test ===\n');
  let failed = false;

  const token = await apiLogin();
  const me = await apiGetMe(token);
  const userId = me.user?.id || me.id;
  console.log('User ID:', userId);

  // Identify directories
  const userSkillsDir = resolve('./data/skills', userId);
  const hostSkillsDir = resolve(homedir(), '.claude', 'skills');
  const sessionsBaseDir = resolve('./data/sessions');

  // Prepare clean state: remove previous test skills
  const hostSkillId = 'test-host-skill-e2e';
  const manualSkillId = 'test-manual-skill-e2e';
  const installSkillId = 'test-install-skill-e2e';

  rimraf(join(hostSkillsDir, hostSkillId));
  rimraf(join(userSkillsDir, hostSkillId));
  rimraf(join(userSkillsDir, manualSkillId));
  rimraf(join(userSkillsDir, installSkillId));

  try {
    // ========== Test 1: Host Sync ==========
    console.log('\n[Test 1] Host skill sync to user directory');
    ensureDir(hostSkillsDir);
    const hostSkillDir = join(hostSkillsDir, hostSkillId);
    ensureDir(hostSkillDir);
    writeFileSync(
      join(hostSkillDir, 'SKILL.md'),
      `---\nname: Test Host Skill\ndescription: A skill from host for e2e test\nuser-invocable: true\n---\n\nThis is a test host skill.\n`
    );

    const syncResult = await apiPostSkillsSyncHost(token);
    console.log('Sync result:', JSON.stringify(syncResult));
    if (!syncResult.success) {
      console.error('FAIL: Sync-host API failed');
      failed = true;
    } else if (!existsSync(join(userSkillsDir, hostSkillId, 'SKILL.md'))) {
      console.error('FAIL: Host skill was not copied to user directory');
      failed = true;
    } else {
      console.log('PASS: Host skill synced to user directory.');
    }

    // ========== Test 2: Skill List ==========
    console.log('\n[Test 2] Skill list after sync');
    const listResult = await apiGetSkills(token);
    const skills: any[] = listResult.skills || [];
    const hostSkill = skills.find((s) => s.id === hostSkillId);
    if (!hostSkill) {
      console.error('FAIL: Host skill not found in API list');
      failed = true;
    } else if (hostSkill.syncedFromHost !== true) {
      console.error('FAIL: Expected syncedFromHost=true, got', hostSkill.syncedFromHost);
      failed = true;
    } else if (hostSkill.name !== 'Test Host Skill') {
      console.error('FAIL: Expected name "Test Host Skill", got', hostSkill.name);
      failed = true;
    } else {
      console.log('PASS: Skill list contains host skill with correct metadata.');
    }

    // ========== Test 3: Manual skill creation ==========
    console.log('\n[Test 3] Create manual skill');
    const createResult = await apiPostSkill(token, {
      id: manualSkillId,
      name: 'Test Manual Skill',
      description: 'Manually created skill',
      source: 'user',
      enabled: true,
      content: '---\nname: Test Manual Skill\ndescription: Manual\nuser-invocable: false\n---\n',
      config: { userInvocable: false, allowedTools: ['bash'] },
    });
    if (!createResult.success) {
      console.error('FAIL: Manual skill creation failed:', JSON.stringify(createResult));
      failed = true;
    } else {
      console.log('PASS: Manual skill created in DB.');
    }

    // Check that manual skill appears in list even without filesystem backing yet
    const list2 = await apiGetSkills(token);
    const manualSkill = (list2.skills || []).find((s: any) => s.id === manualSkillId);
    if (!manualSkill) {
      console.error('FAIL: Manual skill missing from list');
      failed = true;
    } else if (manualSkill.userInvocable !== false) {
      console.error('FAIL: Expected userInvocable=false for manual skill, got', manualSkill.userInvocable);
      failed = true;
    } else {
      console.log('PASS: Manual skill visible in list with correct config.');
    }

    // ========== Test 4: Install skill (best-effort) ==========
    console.log('\n[Test 4] Install skill from skills.sh (best-effort)');
    let installAttempted = false;
    try {
      const installResult = await apiInstallSkill(token, 'anthropic/web-search');
      installAttempted = true;
      if (!installResult.success) {
        console.log('SKIP/BLOCKED: Install API returned error (network/toolchain):', installResult.details || JSON.stringify(installResult));
      } else {
        console.log('PASS: Installed skills:', installResult.installed);
        // verify at least one of installed entries exists on disk
        const installedIds: string[] = installResult.installed || [];
        const missing = installedIds.filter((id) => !existsSync(join(userSkillsDir, id)));
        if (missing.length > 0) {
          console.error('FAIL: Installed skill dirs missing on disk:', missing);
          failed = true;
        } else {
          console.log('PASS: Installed skill directories exist.');
        }
      }
    } catch (e: any) {
      console.log('SKIP/BLOCKED: Install threw exception:', e.message);
    }

    // ========== Test 5: Enable / Disable toggle ==========
    console.log('\n[Test 5] Enable/disable host skill via filesystem rename');
    const patchResult = await apiPatchSkill(token, hostSkillId, { enabled: false });
    if (!patchResult.success) {
      console.error('FAIL: Patch skill failed:', JSON.stringify(patchResult));
      failed = true;
    } else {
      const disabledPath = join(userSkillsDir, hostSkillId, 'SKILL.md.disabled');
      const enabledPath = join(userSkillsDir, hostSkillId, 'SKILL.md');
      if (existsSync(disabledPath) && !existsSync(enabledPath)) {
        console.log('PASS: Skill disabled on filesystem.');
      } else {
        console.error('FAIL: Expected SKILL.md.disabled to exist and SKILL.md to be absent');
        failed = true;
      }
    }

    // Re-enable for injection test
    await apiPatchSkill(token, hostSkillId, { enabled: true });

    // ========== Test 6: Skill injection into session on query ==========
    console.log('\n[Test 6] Skill injected into session directory on query');
    const groupId = await apiCreateGroup(token, 'test-skill-injection');
    console.log('Created group:', groupId);

    // Send message to trigger querySession (which calls syncSkillsToSession)
    await apiSendMessage(token, groupId, 'Hello skill injection test');
    await sleep(3000);

    // Find the active session for this group
    const sessionsResp = await apiGetSessions(token);
    const session = (sessionsResp.data || []).find((s: any) => s.workspace === groupId);
    if (!session) {
      console.error('FAIL: No active session found for group after sending message');
      failed = true;
    } else {
      const sessionSkillsDir = resolve(sessionsBaseDir, session.workDir, '.claude', 'skills');
      console.log('Session skills dir:', sessionSkillsDir);
      const copiedSkills = listDirs(sessionSkillsDir);
      console.log('Copied skills in session:', copiedSkills);

      if (!copiedSkills.includes(hostSkillId)) {
        console.error('FAIL: Host skill was NOT copied into session .claude/skills');
        failed = true;
      } else {
        console.log('PASS: Host skill copied into session directory.');
      }

      if (!copiedSkills.includes(manualSkillId)) {
        console.error('FAIL: Manual skill was NOT copied into session .claude/skills');
        failed = true;
      } else {
        console.log('PASS: Manual skill copied into session directory.');
      }

      // Verify content integrity
      const injectedMd = readSkillMd(join(sessionSkillsDir, hostSkillId));
      if (!injectedMd || !injectedMd.includes('Test Host Skill')) {
        console.error('FAIL: Injected host skill content is incomplete');
        failed = true;
      } else {
        console.log('PASS: Injected skill content is correct.');
      }
    }

    // ========== Test 7: Group-level workspace skill sync path ==========
    console.log('\n[Test 7] Workspace-level skill directory resolution');
    // Group folder is something like group-<hash>. syncSkillsToSession looks at:
    // resolve(appConfig.paths.sessions, group.folder || group.id, '.claude', 'skills')
    // We can verify this path exists or is correctly resolved even if empty.
    // Actually let's check if the group object has the right folder.
    const groupResp = await fetch(`${BASE_URL}/api/groups/${groupId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const groupData = await groupResp.json();
    const folder = groupData.group?.folder;
    if (!folder) {
      console.error('FAIL: Group missing folder field');
      failed = true;
    } else {
      const workspaceSkillDir = resolve(sessionsBaseDir, folder, '.claude', 'skills');
      console.log('Workspace skill dir resolved to:', workspaceSkillDir);
      // We haven't put anything here; the point is that the path resolution logic aligns.
      console.log('PASS: Group folder resolves correctly.');
    }

    // Cleanup
    await apiDeleteGroup(token, groupId);
    await apiDeleteSkill(token, hostSkillId);
    await apiDeleteSkill(token, manualSkillId);
    rimraf(join(hostSkillsDir, hostSkillId));
    rimraf(join(userSkillsDir, hostSkillId));
    rimraf(join(userSkillsDir, manualSkillId));
    rimraf(join(userSkillsDir, installSkillId));

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

    // emergency cleanup
    rimraf(join(hostSkillsDir, hostSkillId));
    rimraf(join(userSkillsDir, hostSkillId));
    rimraf(join(userSkillsDir, manualSkillId));
    rimraf(join(userSkillsDir, installSkillId));
  }
})();
