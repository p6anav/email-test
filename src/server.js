const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;

function send(res, status, body, headers = {}) {
  const isObject = body && typeof body === 'object';
  const payload = isObject ? JSON.stringify(body) : String(body ?? '');
  res.writeHead(status, {
    'Content-Type': isObject ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Powered-By': 'node-app',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      // DoS guard: limit body size ~1MB
      if (data.length > 1_000_000) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve(null);
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method || 'GET';

  // Basic CORS (adjust as needed)
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (method === 'OPTIONS') return send(res, 204, '', corsHeaders);

  // Routes
  if (method === 'GET' && url.pathname === '/') {
    return send(res, 200, { message: 'Hello from Node app!' }, corsHeaders);
  }

  if (method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { status: 'ok', uptime: process.uptime() }, corsHeaders);
  }

  if (method === 'GET' && url.pathname === '/api/time') {
    return send(res, 200, { now: new Date().toISOString() }, corsHeaders);
  }

  if (method === 'POST' && url.pathname === '/api/echo') {
    return readJson(req)
      .then((body) => send(res, 200, { youSent: body }, corsHeaders))
      .catch((err) => send(res, 400, { error: err.message }, corsHeaders));
  }

  return send(res, 404, { error: 'Not Found' }, corsHeaders);
}

const server = http.createServer(router);
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${PORT}`);
});

