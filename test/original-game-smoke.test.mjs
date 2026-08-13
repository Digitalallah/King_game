import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import {
  DOSBOX_CONF,
  isGameTableFrame,
  isPartnerSelectionFrame,
  ORIGINAL_ARCHIVE_SHA256,
  ORIGINAL_HEIGHT,
  ORIGINAL_WIDTH,
  passOriginalPrompts,
  synchronizeOriginalPointer,
} from '../src/original-config.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const archivePath = join(root, 'kingrus.zip');
const vendorPath = join(root, 'vendor', 'emulators');

test('the tracked archive is the supplied original', () => {
  const digest = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
  assert.equal(digest, ORIGINAL_ARCHIVE_SHA256);
});

test('the original game boots and starts a single-player deal at 640×350', { timeout: 25_000 }, async () => {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };

  const require = createRequire(import.meta.url);
  require(join(vendorPath, 'emulators.js'));
  const emulator = globalThis.emulators;
  assert.match(emulator.version, /^8\.4\.1(?:\s|$)/);
  emulator.pathPrefix = vendorPath;

  const archive = new Uint8Array(readFileSync(archivePath));
  const client = await emulator.dosboxNode([
    archive,
    { dosboxConf: DOSBOX_CONF, jsdosConf: { version: emulator.version } },
  ]);

  try {
    await new Promise(resolve => setTimeout(resolve, 650));
    assert.equal(client.width(), ORIGINAL_WIDTH);
    assert.equal(client.height(), ORIGINAL_HEIGHT);

    await passOriginalPrompts(client);
    const deadline = Date.now() + 6000;
    let pickerVisible = false;

    while (Date.now() < deadline && !pickerVisible) {
      const frame = await client.screenshot();
      pickerVisible = isPartnerSelectionFrame(frame.data, frame.width, frame.height, 4);
      if (!pickerVisible) await new Promise(resolve => setTimeout(resolve, 100));
    }

    assert.equal(pickerVisible, true);

    const tap = async (x, y) => {
      await synchronizeOriginalPointer(client);
      client.sendMouseMotion(x / ORIGINAL_WIDTH, y / ORIGINAL_HEIGHT);
      await new Promise(resolve => setTimeout(resolve, 55));
      client.sendMouseButton(0, true);
      await new Promise(resolve => setTimeout(resolve, 45));
      client.sendMouseButton(0, false);
      await new Promise(resolve => setTimeout(resolve, 650));
    };

    await tap(205, 68); // Винни Пух
    await tap(460, 68); // Пятачок
    await tap(295, 68); // Кролик

    const tableDeadline = Date.now() + 6000;
    let tableVisible = false;
    while (Date.now() < tableDeadline && !tableVisible) {
      const frame = await client.screenshot();
      tableVisible = isGameTableFrame(frame.data, frame.width, frame.height, 4);
      if (!tableVisible) await new Promise(resolve => setTimeout(resolve, 100));
    }

    assert.equal(tableVisible, true);
  } finally {
    await client.exit();
  }
});
