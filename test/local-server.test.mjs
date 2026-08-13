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
    const [page, archive, wasm, gitConfig, readme] = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/kingrus.zip`),
      fetch(`${baseUrl}/vendor/emulators/wdosbox.wasm`),
      fetch(`${baseUrl}/.git/config`),
      fetch(`${baseUrl}/README.md`),
    ]);

    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.equal(archive.headers.get('content-type'), 'application/zip');
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');
    assert.equal(gitConfig.status, 404);
    assert.equal(readme.status, 404);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});
