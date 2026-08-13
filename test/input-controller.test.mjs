import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectPlayerCardSlots,
  partnerAtPoint,
  playerCardAtPoint,
} from '../src/input-controller.js';
import { DOSBOX_CONF, ORIGINAL_CPU_CYCLES } from '../src/original-config.js';

function syntheticHandFrame() {
  const width = 640;
  const height = 350;
  const pixels = new Uint8Array(width * height * 3).fill(170);
  const set = (x, y, value) => {
    const offset = (y * width + x) * 3;
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
  };
  const leftEdges = [164, 224, 244, 264, 284, 304, 364, 424];
  const suitStarts = new Set([164, 224, 364, 424]);

  for (const left of leftEdges) {
    if (suitStarts.has(left)) {
      set(left, 280, 170);
      set(left + 1, 280, 170);
      set(left + 2, 280, 0);
    } else {
      set(left, 280, 0);
      set(left, 281, 255);
    }
    for (let y = 282; y <= 337; y += 1) set(left, y, 0);
  }

  return pixels;
}

test('partner taps snap to the original 4×3 portrait grid', () => {
  assert.deepEqual(partnerAtPoint(207, 66), { index: 0, x: 205, y: 68 });
  assert.deepEqual(partnerAtPoint(456, 184), { index: 7, x: 460, y: 180 });
  assert.deepEqual(partnerAtPoint(371, 294), { index: 10, x: 375, y: 290 });
  assert.equal(partnerAtPoint(600, 200), null);
});

test('card slots are detected through original overlapping card borders', () => {
  const slots = detectPlayerCardSlots(syntheticHandFrame(), 640, 350, 3);
  assert.deepEqual(slots.map(slot => slot.left), [164, 224, 244, 264, 284, 304, 364, 424]);
  assert.equal(slots[1].right, 244);
  assert.equal(slots[5].right, 356);
  assert.equal(slots[7].right, 476);
});

test('a raised or normal card tap resolves to one visible card', () => {
  const slots = detectPlayerCardSlots(syntheticHandFrame(), 640, 350, 3);
  assert.equal(playerCardAtPoint(slots, 230, 310)?.left, 224);
  assert.equal(playerCardAtPoint(slots, 250, 270)?.left, 244);
  assert.equal(playerCardAtPoint(slots, 450, 330)?.left, 424);
  assert.equal(playerCardAtPoint(slots, 110, 310), null);
});

test('DOSBox uses a fixed slower CPU speed instead of maximum cycles', () => {
  assert.equal(ORIGINAL_CPU_CYCLES, 20000);
  assert.match(DOSBOX_CONF, /cycles=20000/);
  assert.doesNotMatch(DOSBOX_CONF, /cycles=max/);
});

test('browser clicks use deterministic relative mouse motion', async () => {
  const calls = [];
  const fakeClient = {
    sendMouseRelativeMotion(x, y) {
      calls.push([x, y]);
    },
  };
  const { moveOriginalPointer } = await import('../src/original-config.js');
  await moveOriginalPointer(fakeClient, 205, 68, 0);
  assert.deepEqual(calls, [[-1000, 1000], [205, -68]]);
});
