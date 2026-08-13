import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  encodeCp866,
  KING_FNT_SHA256,
  KING_LIB_SHA256,
  parseKingFont,
  parseKingLib,
} from '../src/native-assets.js';

const lib = readFileSync(new URL('../assets/native/king.lib.bin', import.meta.url));
const font = readFileSync(new URL('../assets/native/king.fnt.bin', import.meta.url));

test('native assets are byte-identical to the supplied original resources', () => {
  assert.equal(createHash('sha256').update(lib).digest('hex'), KING_LIB_SHA256);
  assert.equal(createHash('sha256').update(font).digest('hex'), KING_FNT_SHA256);
});

test('KING.LIB decoder restores the original cards and character strips', () => {
  const sprites = parseKingLib(lib);
  assert.equal(sprites.length, 72);
  assert.equal(sprites.filter(Boolean).length, 49);
  assert.deepEqual([sprites[0].width, sprites[0].height], [52, 60]);
  assert.deepEqual([sprites[49].width, sprites[49].height], [52, 60]);
  assert.deepEqual([sprites[52].width, sprites[52].height], [320, 88]);
  assert.deepEqual([sprites[63].width, sprites[63].height], [156, 108]);
  assert.equal(sprites[8], null);
  assert.ok(sprites.filter(Boolean).every(sprite => sprite.pixels.every(color => color <= 15)));
});

test('KING.FNT exposes all three original bitmap-font planes', () => {
  const fonts = parseKingFont(font);
  assert.equal(fonts[6].length, 256 * 6);
  assert.equal(fonts[8].length, 256 * 8);
  assert.equal(fonts[14].length, 256 * 14);
  assert.ok(fonts[8].some(byte => byte !== 0));
});

test('Russian UI strings map to the original CP866 glyph indexes', () => {
  assert.deepEqual([...encodeCp866('АЯаяЁё')], [0x80, 0x9f, 0xa0, 0xef, 0xf0, 0xf1]);
});
