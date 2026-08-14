import assert from 'node:assert/strict';
import test from 'node:test';

import worker, {
  makeRoomId,
  verifyTelegramInitData,
} from '../worker/index.js';
import { GameRoom } from '../worker/game-room.js';

function makeRoomBinding() {
  const objects = new Map();
  return {
    idFromName(name) { return name; },
    get(id) {
      if (!objects.has(id)) {
        const values = new Map();
        const state = {
          storage: {
            async get(key) { return values.get(key); },
            async put(key, value) { values.set(key, value); },
            async setAlarm() {},
            async deleteAll() { values.clear(); },
          },
        };
        objects.set(id, new GameRoom(state, {}));
      }
      return objects.get(id);
    },
  };
}

function post(path, body) {
  return new Request(`https://game.example${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('worker creates and joins a Durable Object room in explicit local-dev auth mode', async () => {
  const env = {
    GAME_ROOM: makeRoomBinding(),
    DEV_AUTH: 'true',
    BOT_USERNAME: 'KingIgraBot',
    APP_SHORT_NAME: 'King',
  };
  const createResponse = await worker.fetch(post('/api/rooms', {
    devUserId: 'host',
    displayName: 'Хозяин',
    choices: [
      { type: 'human' },
      { type: 'bot', characterId: 0 },
      { type: 'bot', characterId: 1 },
    ],
  }), env);
  assert.equal(createResponse.status, 200);
  const created = await createResponse.json();
  assert.match(created.room.roomId, /^[A-HJ-NP-Z2-9]{20}$/);
  assert.match(created.ticket, /^[A-Za-z0-9_-]{24,64}$/);
  assert.equal(JSON.stringify(created).includes('dev:host'), false);

  const joinResponse = await worker.fetch(post(`/api/rooms/${created.room.roomId}/join`, {
    devUserId: 'guest',
    displayName: 'Гость',
  }), env);
  assert.equal(joinResponse.status, 200);
  const joined = await joinResponse.json();
  assert.equal(joined.localSeat, 1);
  assert.equal(joined.room.seats[1].name, 'Гость');

  const configResponse = await worker.fetch(new Request('https://game.example/api/config'), env);
  assert.deepEqual(await configResponse.json(), {
    ok: true,
    appUrl: 'https://t.me/KingIgraBot/King',
    devAuth: true,
  });
});

async function makeSignedInitData(token, authDate) {
  const encoder = new TextEncoder();
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'unit-test-query',
    signature: 'unit-test-signature',
    user: JSON.stringify({
      id: 279058397,
      first_name: 'Vladislav',
      last_name: 'Kibenko',
      username: 'vdkfrost',
      photo_url: 'https://t.me/i/userpic/test.svg',
    }),
  });
  const checkString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const webAppDataKey = await crypto.subtle.importKey(
    'raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const secret = await crypto.subtle.sign('HMAC', webAppDataKey, encoder.encode(token));
  const key = await crypto.subtle.importKey(
    'raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const hash = await crypto.subtle.sign('HMAC', key, encoder.encode(checkString));
  params.set('hash', [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''));
  return params.toString();
}

test('Telegram HMAC validation accepts signed data and rejects tampering or old data', async () => {
  const now = 1_733_509_682;
  const token = 'unit-test-token-not-a-bot-secret';
  const initData = await makeSignedInitData(token, now);
  const verified = await verifyTelegramInitData(initData, token, now);
  assert.equal(verified.id, 'tg:279058397');
  assert.equal(verified.username, 'vdkfrost');
  assert.match(verified.photoUrl, /^https:\/\/t\.me\/i\/userpic\//);
  assert.equal(await verifyTelegramInitData(initData.replace('Vladislav', 'Mallory'), token, now), null);
  assert.equal(await verifyTelegramInitData(initData, token, now + 86_401), null);
});

test('room identifiers have 100 bits of random alphabet space and expose no account metadata', async () => {
  const ids = new Set(Array.from({ length: 100 }, () => makeRoomId()));
  assert.equal(ids.size, 100);
  assert.ok([...ids].every(id => /^[A-HJ-NP-Z2-9]{20}$/.test(id)));
  const health = await worker.fetch(new Request('https://game.example/api/health'), {
    GAME_ROOM: makeRoomBinding(),
    DEV_AUTH: 'true',
  });
  const body = await health.json();
  assert.equal(body.networkAvailable, true);
  assert.equal('botToken' in body, false);
  assert.equal('cloudflareAccount' in body, false);
  assert.equal('githubRepository' in body, false);
});
