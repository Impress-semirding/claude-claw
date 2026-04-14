import http from 'http';

const PORT = 3456;

const MODELS = [
  { id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' },
  { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' },
];

function sendEvent(res, eventType, data) {
  res.write(`event: ${eventType}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function getPathname(url) {
  try {
    return new URL(url, `http://127.0.0.1:${PORT}`).pathname;
  } catch {
    return url.split('?')[0];
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function consumeBody(req, cb) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => cb(body));
}

const server = http.createServer((req, res) => {
  const url = req.url || '';
  const pathname = getPathname(url);

  console.error(`[mock-anthropic] ${req.method} ${url} (pathname: ${pathname})`);

  if (pathname === '/v1/models' && req.method === 'GET') {
    sendJson(res, 200, { data: MODELS });
    return;
  }

  if (pathname === '/v1/messages/count_tokens' && req.method === 'POST') {
    consumeBody(req, (body) => {
      console.error('[mock-anthropic] /v1/messages/count_tokens body snippet:', body.slice(0, 200));
      // Estimate tokens: ~4 chars per token
      const estimatedTokens = Math.max(1, Math.ceil(body.length / 4));
      sendJson(res, 200, {
        input_tokens: estimatedTokens,
        output_tokens: 0,
      });
    });
    return;
  }

  if (pathname === '/v1/messages' && req.method === 'POST') {
    const mockText = '你好！这是来自 Playwright 自动化测试的模拟回复。整个聊天 → Agent 调度 → Claude SDK query → 回复用户的链路已成功打通。';

    consumeBody(req, (body) => {
      console.error('[mock-anthropic] /v1/messages body snippet:', body.slice(0, 200));
      const wantsStream = body.includes('"stream":true');

      if (wantsStream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        sendEvent(res, 'message_start', {
          type: 'message_start',
          message: {
            id: 'msg_mock_001',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-20250514',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 12, output_tokens: 0 },
          },
        });

        sendEvent(res, 'content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        });

        const chunks = mockText.split('');
        let sent = 0;
        const timer = setInterval(() => {
          if (sent >= chunks.length) {
            clearInterval(timer);
            sendEvent(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
            sendEvent(res, 'message_delta', {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: mockText.length },
            });
            sendEvent(res, 'message_stop', { type: 'message_stop' });
            res.end();
            return;
          }
          const chunk = chunks.slice(sent, sent + 5).join('');
          sent += 5;
          sendEvent(res, 'content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: chunk },
          });
        }, 30);
        return;
      }

      // Non-streaming JSON response
      sendJson(res, 200, {
        id: 'msg_mock_001',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: mockText }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: mockText.length },
      });
    });
    return;
  }

  if (pathname === '/api/event_logging/batch' && req.method === 'POST') {
    consumeBody(req, () => {
      sendJson(res, 200, { success: true });
    });
    return;
  }

  // Fallback: return 404 for unexpected paths
  console.error('[mock-anthropic] 404 fallback for', pathname);
  sendJson(res, 404, { error: { message: 'Not found', type: 'not_found_error' } });
});

server.listen(PORT, () => {
  console.log(`[mock-anthropic] listening on http://127.0.0.1:${PORT}`);
});
