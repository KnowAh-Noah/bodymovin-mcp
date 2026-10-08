/*
 * MCP over HTTP, hosted in the hidden helper extension's Node context.
 * Node builtins only. Modelled on ae-vision's server (cep/server/http-server.js).
 *
 *   POST /mcp     MCP (JSON-RPC 2.0, Streamable HTTP without a stream)
 *   GET  /health  is After Effects reachable, is the panel ready
 *
 * The port is fixed, never auto-picked, so client configs stay valid.
 * ae-vision uses 8791 (After Effects) and 8792 (Illustrator).
 *
 * Loopback is not access control - any local process or a web page (DNS
 * rebinding, simple-request CSRF) can reach the port, and these tools drive
 * After Effects and write files. So:
 *   - a bearer token, 0600 in ~/.bodymovin-mcp/token, persisted across launches
 *     so client configs keep working; created atomically
 *   - Host must be loopback:<port> (defeats DNS rebinding)
 *   - any real web Origin is refused
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMcpHandler } = require('./protocol.js');
const { tools, callTool, status } = require('./tools.js');

const PORT = Number(process.env.BODYMOVIN_MCP_PORT) || 8793;
const TOKEN_DIR = process.env.BODYMOVIN_MCP_TOKEN_DIR || path.join(os.homedir(), '.bodymovin-mcp');
const TOKEN_FILE = path.join(TOKEN_DIR, 'token');

function readToken() {
  try {
    const raw = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    return /^[0-9a-f]{64}$/.test(raw) ? raw : null;
  } catch (err) {
    return null;
  }
}

// 'wx' so that if two processes race on first run, one wins and both read its token.
function loadOrCreateToken() {
  const existing = readToken();
  if (existing) return existing;
  const token = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600, flag: 'wx' });
    return token;
  } catch (err) {
    if (err.code === 'EEXIST' && readToken()) return readToken();
    fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
    fs.chmodSync(TOKEN_FILE, 0o600);
    return token;
  }
}

function sameSecret(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function start(log) {
  const startupToken = loadOrCreateToken();
  const handleMcp = createMcpHandler({ tools, callTool });
  const allowedHosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`];

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const origin = req.headers.origin;
    if (origin && origin !== 'null' && !origin.startsWith('file://')) {
      json(res, 403, { error: 'Cross-origin requests are not accepted' });
      return;
    }
    if (!allowedHosts.includes(req.headers.host)) {
      json(res, 403, { error: `Unexpected Host: ${req.headers.host}` });
      return;
    }
    // Compare against the file, not a startup copy: the file is what clients read.
    const expected = readToken() || startupToken;
    const supplied = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!sameSecret(supplied, expected)) {
      json(res, 401, { error: `Missing or bad bearer token. Read it from ${TOKEN_FILE}` });
      return;
    }

    const route = req.url.split('?')[0];
    if (req.method === 'GET' && route === '/health') {
      let host;
      try {
        host = { reachable: true, ...(await status()) };
      } catch (err) {
        host = { reachable: false, error: String(err.message || err) };
      }
      json(res, 200, { ok: true, service: 'bodymovin-mcp', node: process.version, port: PORT, host });
      return;
    }

    if (route === '/mcp' || route === '/') {
      if (req.method === 'POST') {
        let body;
        try {
          body = await readBody(req);
        } catch (err) {
          json(res, 400, { error: String(err.message || err) });
          return;
        }
        const reply = await handleMcp(body);
        if (reply === null) {
          res.writeHead(202, { 'Content-Length': 0 });
          res.end();
          return;
        }
        json(res, 200, reply);
        return;
      }
      // No server-to-client stream and no sessions: the spec's answer is 405.
      res.writeHead(405, { Allow: 'POST', 'Content-Length': 0 });
      res.end();
      return;
    }

    json(res, 404, { error: 'Not found' });
  });

  server.on('error', (err) => log(`server error: ${err.code || err.message}`));
  server.listen(PORT, '127.0.0.1', () => log(`listening on 127.0.0.1:${PORT}, token in ${TOKEN_FILE}`));
  return server;
}

module.exports = { start, PORT, TOKEN_FILE };
