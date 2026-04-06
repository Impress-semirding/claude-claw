/**
 * 端到端消息流诊断脚本
 * 用法：node scripts/diagnose-message-flow.mjs [username] [password]
 * 默认凭证：admin / admin123
 */
import http from 'http';
import WebSocket from 'ws';

const BASE = process.env.CLAW_BASE_URL || 'http://localhost:3000';
const WS = BASE.replace(/^http/, 'ws') + '/ws';
const CREDENTIALS = {
  username: process.argv[2] || 'admin',
  password: process.argv[3] || 'admin123',
};

function requestJson(path, method = 'GET', body = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE).toString();
    const opts = { method, headers: {} };
    if (cookie) opts.headers['Cookie'] = cookie;
    if (body) {
      const data = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
      const req = http.request(url, opts, (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const json = raw ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode, headers: res.headers, body: json });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, body: raw });
          }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    } else {
      const req = http.request(url, opts, (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const json = raw ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode, headers: res.headers, body: json });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, body: raw });
          }
        });
      });
      req.on('error', reject);
      req.end();
    }
  });
}

async function main() {
  console.log('=== Step 1: Login ===');
  const loginRes = await requestJson('/api/auth/login', 'POST', CREDENTIALS);
  if (loginRes.status !== 200) {
    console.error('Login failed:', loginRes.status, loginRes.body);
    console.error('\n提示：请提供正确的用户名和密码，例如：');
    console.error('  node scripts/diagnose-message-flow.mjs admin yourpassword');
    process.exit(1);
  }
  const cookies = Array.isArray(loginRes.headers['set-cookie'])
    ? loginRes.headers['set-cookie']
    : [loginRes.headers['set-cookie']].filter(Boolean);
  const sessionCookie = cookies.find((c) => c && c.startsWith('session=')) || '';
  console.log('Login OK. Cookie:', sessionCookie.slice(0, 50) + '...');

  console.log('\n=== Step 2: Get Groups ===');
  const groupsRes = await requestJson('/api/groups', 'GET', null, sessionCookie);
  const groupEntries = Object.entries(groupsRes.body.groups || {});
  let groupId = groupEntries[0]?.[0];
  let groupFolder = groupEntries[0]?.[1]?.folder;
  if (!groupId) {
    console.log('No group found, creating one...');
    const createRes = await requestJson('/api/groups', 'POST', { name: 'Diag Group' }, sessionCookie);
    groupId = createRes.body.jid;
    groupFolder = createRes.body.group?.folder;
    console.log('Created group:', groupId, 'folder:', groupFolder);
  } else {
    console.log('Using existing group:', groupId, 'folder:', groupFolder);
  }

  console.log('\n=== Step 3: Connect WebSocket ===');
  const ws = new WebSocket(WS, {
    headers: { Cookie: sessionCookie },
  });

  const wsEvents = [];
  let wsOpened = false;
  let wsClosedCode = null;

  ws.on('open', () => {
    wsOpened = true;
    console.log('WS connected (open)');
  });
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      wsEvents.push(msg);
      if (msg.type === 'new_message') {
        console.log('[WS] new_message -> chatJid=', msg.chatJid, 'msgId=', msg.message?.id, 'sender=', msg.message?.sender);
      } else if (msg.type === 'runner_state') {
        console.log('[WS] runner_state -> chatJid=', msg.chatJid, 'state=', msg.state);
      } else if (msg.type === 'stream_event') {
        console.log('[WS] stream_event -> chatJid=', msg.chatJid, 'eventType=', msg.event?.eventType);
      } else {
        console.log('[WS]', msg.type, 'chatJid=', msg.chatJid);
      }
    } catch (err) {
      console.log('[WS] raw (non-json):', data.toString().slice(0, 200));
    }
  });
  ws.on('close', (code) => {
    wsClosedCode = code;
    console.log('WS closed with code:', code);
  });
  ws.on('error', (err) => {
    console.error('WS error:', err.message);
  });

  await new Promise((r) => setTimeout(r, 800));
  if (!wsOpened) {
    console.warn('⚠️  WS 未在 800ms 内连接成功。如果最终也没 open，说明 WS upgrade 失败（通常是 cookie 认证问题）。');
  }

  // --- Test A: HappyClaw original path (HTTP POST /api/messages) ---
  console.log('\n=== Step 4-A: Send message via HTTP POST /api/messages ===');
  const httpPayload = { chatJid: groupId, content: 'Hello from diagnose script (HTTP)', attachments: [] };
  const postRes = await requestJson('/api/messages', 'POST', httpPayload, sessionCookie);
  console.log('POST /api/messages status:', postRes.status);
  console.log('POST /api/messages body:', JSON.stringify(postRes.body, null, 2));

  if (postRes.status === 200 && postRes.body.success) {
    console.log('HTTP send succeeded. Waiting 2s for WS new_message...');
    await new Promise((r) => setTimeout(r, 2000));
    const gotNewMessage = wsEvents.some((m) => m.type === 'new_message' && m.chatJid === groupId);
    if (gotNewMessage) {
      console.log('✅ WS 成功收到 new_message（HTTP 路径正常）');
    } else {
      console.warn('⚠️  HTTP 发送成功，但 WS 未收到 new_message。说明后端保存了消息，但广播没到达这个 WS 连接。');
      console.log('    已收到的 WS 事件类型:', [...new Set(wsEvents.map((m) => m.type))]);
    }
  } else {
    console.error('❌ HTTP 发送失败，消息没进入后端流程。');
  }

  // --- Test B: Web-adapter path (WS send_message) ---
  console.log('\n=== Step 4-B: Send message via WS send_message ===');
  const wsPayload = {
    type: 'send_message',
    chatJid: groupId,
    content: 'Hello from diagnose script (WS)',
  };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(wsPayload));
    console.log('WS send_message sent.');
    await new Promise((r) => setTimeout(r, 2000));
    const gotNewMessage2 = wsEvents.some(
      (m) => m.type === 'new_message' && m.chatJid === groupId && m.message?.content === wsPayload.content
    );
    if (gotNewMessage2) {
      console.log('✅ WS 成功收到 new_message（WS 路径正常）');
    } else {
      console.warn('⚠️  WS send_message 发出后未收到 new_message。');
    }
  } else {
    console.error('❌ WS 当前未连接，无法测试 WS 路径。');
  }

  // --- Test C: Verify DB/Polling ---
  console.log('\n=== Step 5: Verify messages via GET /api/groups/:jid/messages ===');
  const msgRes = await requestJson(`/api/groups/${encodeURIComponent(groupId)}/messages?limit=10`, 'GET', null, sessionCookie);
  const msgs = msgRes.body.messages || [];
  console.log('GET messages status:', msgRes.status, 'count:', msgs.length);
  const httpMsg = msgs.find((m) => m.content === httpPayload.content);
  const wsMsg = msgs.find((m) => m.content === wsPayload.content);
  if (httpMsg) {
    console.log('✅ 数据库里存在 HTTP 发送的消息（刷新页面能看到它）');
    console.log('   id=', httpMsg.id, 'timestamp=', httpMsg.timestamp, 'source_kind=', httpMsg.source_kind);
  } else {
    console.error('❌ 数据库里找不到 HTTP 发送的消息');
  }
  if (wsMsg) {
    console.log('✅ 数据库里存在 WS 发送的消息');
  } else {
    console.error('❌ 数据库里找不到 WS 发送的消息');
  }

  ws.close();

  console.log('\n=== Summary ===');
  console.log('- Login OK:', !!sessionCookie);
  console.log('- WS Connected:', wsOpened, wsClosedCode !== null ? `(closed ${wsClosedCode})` : '(still open)');
  console.log('- HTTP POST /api/messages success:', postRes.status === 200 && postRes.body.success);
  console.log('- HTTP msg in DB:', !!httpMsg);
  console.log('- WS msg in DB:', !!wsMsg);

  if (postRes.status === 200 && postRes.body.success && httpMsg && !wsEvents.some((m) => m.type === 'new_message' && m.chatJid === groupId && m.message?.id === httpMsg.id)) {
    console.log('\n🔴 核心问题：HTTP 发送能存库，但 WS new_message 没有到达客户端。');
    console.log('   这意味着前端刷新后能看到消息，但发送时实时不显示。');
    console.log('   根因可能在：1) WS 连接没带上认证 cookie（已修复 SameSite=Lax）；2) broadcastNewMessage 的过滤逻辑漏掉了这个连接。');
  }

  if (!wsOpened) {
    console.log('\n🔴 WS 根本没连上。请检查：');
    console.log('   1) 后端是否已重启（让 SameSite=Lax 生效）？');
    console.log('   2) 浏览器 DevTools Network -> WS 里 /ws 状态是不是 401？');
  }
}

main().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
