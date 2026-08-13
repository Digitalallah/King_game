import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createStaticServer } from '../server.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('local server exposes only browser assets with correct MIME types', async () => {
  const server = createStaticServer(root);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const [page, lib, font, archive, wasm, gitConfig, readme] = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/assets/native/king.lib.bin`),
      fetch(`${baseUrl}/assets/native/king.fnt.bin`),
      fetch(`${baseUrl}/kingrus.zip`),
      fetch(`${baseUrl}/vendor/emulators/wdosbox.wasm`),
      fetch(`${baseUrl}/.git/config`),
      fetch(`${baseUrl}/README.md`),
    ]);

    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.equal(lib.status, 200);
    assert.equal(font.status, 200);
    assert.equal(lib.headers.get('content-type'), 'application/octet-stream');
    assert.equal(font.headers.get('content-type'), 'application/octet-stream');
    assert.equal(archive.status, 404);
    assert.equal(wasm.status, 404);
    assert.equal(gitConfig.status, 404);
    assert.equal(readme.status, 404);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});
