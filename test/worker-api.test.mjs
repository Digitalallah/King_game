import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

function env() {
  const calls = [];
  return {
    DEV_AUTH: 'true',
    GAME_ROOM: {
      idFromName(roomId) {
        return roomId;
      },
      get(id) {
        return {
          async fetch(request) {
            calls.push({ id, request });
            return Response.json({ ok: true });
          },
        };
      },
    },
    calls,
  };
}

function jsonPost(path) {
  return new Request(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: '' }),
  });
}

test('GET /api/health returns 200', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/health'), env());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test('POST /api/rooms returns 200 and creates a room through the Durable Object', async () => {
  const testEnv = env();
  const response = await worker.fetch(jsonPost('/api/rooms'), testEnv);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.match(body.roomId, /^[A-Z2-9]{6}$/);
  assert.equal(testEnv.calls.length, 1);
});

test('GET /api/rooms returns 405 with Allow: POST', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/rooms'), env());
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'POST');
});

test('POST on unknown API route returns 404', async () => {
  const response = await worker.fetch(jsonPost('/api/missing'), env());
  assert.equal(response.status, 404);
});
