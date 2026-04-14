const BASE = 'http://localhost:3000';

async function req(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, body: json };
}

async function main() {
  // 1. login
  const login = await req('POST', '/api/auth/login', { username: 'admin@example.com', password: 'admin123' });
  const adminToken = login.body.token;
  console.log('Login:', login.ok);

  // 2. Update registration settings: disable registration, require invite code
  const putReg = await req('PUT', '/api/config/registration', { allowRegistration: false, requireInviteCode: true }, adminToken);
  console.log('PUT /api/config/registration:', putReg.ok, putReg.body);

  // 3. Check register/status reflects the change
  const regStatus = await req('GET', '/api/auth/register/status');
  console.log('GET /api/auth/register/status:', regStatus.body);
  const regOk = regStatus.body.allowRegistration === false && regStatus.body.requireInviteCode === true;
  console.log(regOk ? '✅ Registration status correct' : '❌ Registration status WRONG');

  // Restore
  await req('PUT', '/api/config/registration', { allowRegistration: true, requireInviteCode: false }, adminToken);

  // 4. Update IM binding: enable feishu
  const putIm = await req('PUT', '/api/config/user-im/feishu', { enabled: true, webhookUrl: 'https://test' }, adminToken);
  console.log('PUT /api/config/user-im/feishu:', putIm.ok, putIm.body);

  // 5. Check GET returns enabled=true
  const getIm = await req('GET', '/api/config/user-im/feishu', undefined, adminToken);
  console.log('GET /api/config/user-im/feishu:', getIm.body);
  const imOk = getIm.body.enabled === true && getIm.body.connected === true;
  console.log(imOk ? '✅ IM binding persisted correctly' : '❌ IM binding NOT persisted');

  // Disable feishu
  await req('PUT', '/api/config/user-im/feishu', { enabled: false }, adminToken);
  const getIm2 = await req('GET', '/api/config/user-im/feishu', undefined, adminToken);
  const imOk2 = getIm2.body.enabled === false && getIm2.body.connected === false;
  console.log(imOk2 ? '✅ IM binding disable persisted' : '❌ IM binding disable NOT persisted');
}

main().catch(console.error);
