import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const rooms = new Map();
const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
]);

function roomClients(room) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  return rooms.get(room);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = normalize(join(root, requested));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': types.get(extname(file)) || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const eventsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/events$/);
  const messageMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/message$/);

  if (req.method === 'GET' && eventsMatch) {
    const room = decodeURIComponent(eventsMatch[1]);
    const client = { id: url.searchParams.get('client') || crypto.randomUUID(), res };
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': connected\n\n');
    roomClients(room).add(client);
    req.on('close', () => roomClients(room).delete(client));
    return;
  }

  if (req.method === 'POST' && messageMatch) {
    const room = decodeURIComponent(messageMatch[1]);
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const message = JSON.parse(body || '{}');
        const data = `data: ${JSON.stringify(message)}\n\n`;
        for (const client of roomClients(room)) client.res.write(data);
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 400, { ok: false });
      }
    });
    return;
  }

  serveStatic(req, res);
});

const port = Number(process.env.PORT || 8080);
server.listen(port, () => console.log(`King game server: http://localhost:${port}`));
