/**
 * E2E: 测试 mysql-data SSE MCP 服务端点是否连通
 */
const BASE_URL = process.env.CLAW_API_URL || 'http://localhost:3000';
const ADMIN = { username: 'admin@example.com', password: 'admin123' };

async function apiLogin() {
  const resp = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  const data = await resp.json();
  if (!data.token) throw new Error('Login failed: ' + JSON.stringify(data));
  return data.token;
}

async function apiGetMcpServers(token) {
  const resp = await fetch(`${BASE_URL}/api/mcp-servers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json();
}

async function testSseConnection(url, headers) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    // MCP over SSE: try GET first (standard SSE connection)
    const getResp = await fetch(url, {
      method: 'GET',
      headers: { ...headers, Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (getResp.ok || getResp.status === 200) {
      const reader = getResp.body.getReader();
      const { done, value } = await reader.read();
      await reader.cancel();
      return {
        ok: true,
        method: 'GET',
        status: getResp.status,
        contentType: getResp.headers.get('content-type') || '',
        firstChunk: done ? '' : new TextDecoder().decode(value).slice(0, 200),
      };
    }

    // Fallback: POST initialize with dual Accept
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'claw-e2e-test', version: '1.0.0' },
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        statusText: resp.statusText,
        body: await resp.text().catch(() => ''),
      };
    }
    // Try to read a small chunk to confirm streaming works
    const reader = resp.body.getReader();
    const { done, value } = await reader.read();
    await reader.cancel();
    return {
      ok: true,
      status: resp.status,
      contentType: resp.headers.get('content-type') || '',
      firstChunk: done ? '' : new TextDecoder().decode(value).slice(0, 200),
    };
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, error: err.message || String(err) };
  }
}

(async () => {
  console.log('=== MySQL-data SSE Connectivity E2E ===\n');
  let failed = false;

  try {
    const token = await apiLogin();
    console.log('[E2E] Logged in');

    const list = await apiGetMcpServers(token);
    const srv = (list.servers || []).find((s) => s.id === 'mysql-data');
    if (!srv) {
      console.error('[E2E] FAIL: mysql-data MCP server not found');
      process.exit(1);
    }
    console.log('[E2E] mysql-data config:', JSON.stringify({
      id: srv.id,
      type: srv.type,
      url: srv.url,
      enabled: srv.enabled,
      status: srv.status,
    }));

    if (srv.type !== 'sse' || !srv.url) {
      console.error('[E2E] FAIL: mysql-data is not an SSE server or has no URL');
      process.exit(1);
    }

    console.log(`[E2E] Testing SSE endpoint: ${srv.url}`);
    const result = await testSseConnection(srv.url, srv.headers || {});

    if (result.ok) {
      console.log('[E2E] PASS: SSE endpoint connected');
      console.log('  status:', result.status);
      console.log('  content-type:', result.contentType);
      console.log('  firstChunk:', result.firstChunk);
    } else {
      console.error('[E2E] FAIL: SSE endpoint unreachable');
      console.error('  status:', result.status || 'N/A');
      console.error('  statusText:', result.statusText || 'N/A');
      console.error('  error:', result.error || result.body || '');
      failed = true;
    }
  } catch (err) {
    console.error('[E2E] Unexpected error:', err);
    failed = true;
  }

  console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: PASSED');
  process.exit(failed ? 1 : 0);
})();
