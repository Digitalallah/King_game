import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVITE_TEXT,
  KingRoomClient,
  makeInviteLink,
  makeTelegramShareUrl,
  parseRoomInvite,
} from '../src/network-client.js';

const ROOM_ID = 'ABCDEFGHJKLMNPQRST23';

test('Telegram startapp links resolve the invited room', () => {
  assert.equal(parseRoomInvite({
    telegram: { initDataUnsafe: { start_param: `room_${ROOM_ID}` } },
    search: '',
  }), ROOM_ID);
  assert.equal(parseRoomInvite({
    search: `?tgWebAppStartParam=room_${ROOM_ID}`,
  }), ROOM_ID);
  assert.equal(parseRoomInvite({ search: '?tgWebAppStartParam=../../secret' }), '');
});

test('the invite uses Telegram direct-link format and the requested message', () => {
  const invite = makeInviteLink('https://t.me/KingIgraBot/King', ROOM_ID);
  assert.equal(invite, `https://t.me/KingIgraBot/King?startapp=room_${ROOM_ID}`);
  const share = new URL(makeTelegramShareUrl(invite));
  assert.equal(share.origin + share.pathname, 'https://t.me/share/url');
  assert.equal(share.searchParams.get('url'), invite);
  assert.equal(share.searchParams.get('text'), INVITE_TEXT);
  assert.equal(INVITE_TEXT, 'Привет, я решил поиграть в игру Кинг, присоединяйся!');
});

test('the browser fetch keeps its Window receiver in Telegram WebView', async () => {
  const receiver = globalThis.window ?? globalThis;
  function browserFetch(input) {
    assert.equal(this, receiver);
    assert.equal(new URL(String(input)).pathname, '/api/config');
    return Promise.resolve(Response.json({
      ok: true,
      appUrl: 'https://t.me/KingIgraBot/King',
      devAuth: false,
    }));
  }

  const client = new KingRoomClient({
    baseUrl: 'https://game.example',
    fetchImpl: browserFetch,
    WebSocketImpl: class {},
    storage: null,
  });

  assert.equal((await client.loadConfig()).ok, true);
});

test('Telegram initData is posted for verification but never placed in the WebSocket URL', async () => {
  const requests = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname === '/api/config') {
      return Response.json({
        ok: true,
        appUrl: 'https://t.me/KingIgraBot/King',
        devAuth: false,
      });
    }
    if (url.pathname === '/api/rooms') {
      return Response.json({
        ok: true,
        ticket: 'abcdefghijklmnopqrstuvwxyzABCDEFGH',
        room: {
          roomId: ROOM_ID,
          localSeat: 0,
          isHost: true,
          canStart: false,
          status: 'lobby',
          seats: [],
        },
      });
    }
    throw new Error(`unexpected request ${url}`);
  };

  class FakeWebSocket {
    static urls = [];
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.listeners = new Map();
      FakeWebSocket.urls.push(url);
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    close() { this.readyState = 3; }
  }

  const stored = new Map();
  const storage = {
    getItem(key) { return stored.get(key) ?? null; },
    setItem(key, value) { stored.set(key, String(value)); },
    removeItem(key) { stored.delete(key); },
  };
  const initData = 'query_id=private&auth_date=123&hash=very-secret';
  const client = new KingRoomClient({
    telegram: { initData, initDataUnsafe: { user: { first_name: 'Алиса' } } },
    baseUrl: 'https://game.example',
    fetchImpl,
    WebSocketImpl: FakeWebSocket,
    storage,
  });
  const choices = [
    { type: 'human' },
    { type: 'bot', characterId: 2 },
    { type: 'bot', characterId: 7 },
  ];
  await client.create({ choices, displayName: 'Алиса' });

  const createRequest = requests.find(request => request.url.pathname === '/api/rooms');
  const body = JSON.parse(createRequest.init.body);
  assert.equal(body.initData, initData);
  assert.deepEqual(body.choices, choices);
  assert.equal(FakeWebSocket.urls.length, 1);
  const socketUrl = new URL(FakeWebSocket.urls[0]);
  assert.equal(socketUrl.protocol, 'wss:');
  assert.equal(socketUrl.pathname, `/api/rooms/${ROOM_ID}/ws`);
  assert.equal(socketUrl.searchParams.get('ticket'), 'abcdefghijklmnopqrstuvwxyzABCDEFGH');
  assert.doesNotMatch(socketUrl.href, /initData|auth_date|very-secret|hash/i);
  assert.equal(client.savedRoom().roomId, ROOM_ID);
});
