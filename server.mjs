import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.zip', 'application/zip'],
]);

const publicFiles = new Set(['/index.html', '/kingrus.zip']);
const publicDirectories = ['/src/', '/vendor/emulators/'];

function isPublicPath(pathname) {
  return publicFiles.has(pathname) || publicDirectories.some(prefix => pathname.startsWith(prefix));
}

function serveStatic(root, req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = resolve(root, `.${pathname}`);
  const withinRoot = file === root || file.startsWith(`${root}${sep}`);

  if (!isPublicPath(pathname) || !withinRoot || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': types.get(extname(file).toLowerCase()) || 'application/octet-stream',
    'Cache-Control': pathname.startsWith('/vendor/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

export function createStaticServer(root = process.cwd()) {
  return createServer((req, res) => serveStatic(root, req, res));
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const server = createStaticServer();
  const port = Number(process.env.PORT || 8080);
  server.listen(port, () => console.log(`King single-player: http://localhost:${port}`));
}
