import http from 'http';
import https from 'https';
import { URL } from 'url';

const PROXY_PORT = 3456;
const TARGET_HOST = 'api.kimi.com';
const TARGET_PATH_PREFIX = '/coding/v1';

function forward(req, res, body) {
  const parsed = new URL(req.url, `http://127.0.0.1:${PROXY_PORT}`);
  const targetPath = `${TARGET_PATH_PREFIX}${parsed.pathname}${parsed.search}`;
  const options = {
    hostname: TARGET_HOST,
    port: 443,
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: TARGET_HOST,
    },
  };

  console.error(`[PROXY] ${req.method} ${req.url} -> ${TARGET_HOST}${targetPath}`);
  if (body) {
    console.error('[PROXY] BODY:', body.slice(0, 500));
  }

  const proxyReq = https.request(options, (proxyRes) => {
    let responseBody = '';
    proxyRes.on('data', (chunk) => {
      responseBody += chunk;
      res.write(chunk);
    });
    proxyRes.on('end', () => {
      console.error(`[PROXY] RESPONSE ${proxyRes.statusCode}:`, responseBody.slice(0, 800));
      res.end();
    });
  });

  proxyReq.on('error', (err) => {
    console.error('[PROXY] ERROR:', err.message);
    res.writeHead(502);
    res.end(JSON.stringify({ error: err.message }));
  });

  if (body) {
    proxyReq.write(body);
  }
  proxyReq.end();
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => forward(req, res, body));
});

server.listen(PROXY_PORT, () => {
  console.error(`[PROXY] Listening on http://127.0.0.1:${PROXY_PORT}, forwarding to https://${TARGET_HOST}${TARGET_PATH_PREFIX}`);
});
