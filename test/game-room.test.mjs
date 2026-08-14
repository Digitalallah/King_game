import assert from 'node:assert/strict';
import test from 'node:test';

import { GameRoom } from '../worker/game-room.js';

const ROOM_ID = 'ABCDEFGHJKLMNPQRST23';

function makeState() {
  const values = new Map();
  return {
    storage: {
      async get(key) { return values.get(key); },
      async put(key, value) { values.set(key, value); },
      async setAlarm() {},
      async deleteAll() { values.clear(); },
    },
  };
}

function roomRequest(action, body) {
  return new Request(`https://game.example/room/${ROOM_ID}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function socketLog() {
  return {
    messages: [],
    send(raw) { this.messages.push(JSON.parse(raw)); },
  };
}

test('lobby keeps reserved human seats, reports joins, and starts only when everyone is connected', async () => {
  const state = makeState();
  const object = new GameRoom(state, {});
  const host = { id: 'tg:1', name: 'Хозяин', photoUrl: 'https://t.me/i/userpic/host.svg' };
  const guest = { id: 'tg:2', name: 'Гость', photoUrl: 'https://t.me/i/userpic/guest.svg' };
  const choices = [
    { type: 'human' },
    { type: 'bot', characterId: 2 },
    { type: 'bot', characterId: 7 },
  ];
  const createdResponse = await object.fetch(roomRequest('create', {
    user: host,
    displayName: 'Король',
    choices,
  }));
  assert.equal(createdResponse.status, 200);
  const created = await createdResponse.json();
  assert.equal(created.room.seats[1].type, 'pending');
  assert.equal(created.room.canStart, false);
  assert.ok(created.ticket.length >= 24);
  assert.equal(JSON.stringify(created.room).includes('tg:1'), false);

  let storedRoom = await state.storage.get('room');
  storedRoom.seats[0].connected = true;
  await state.storage.put('room', storedRoom);
  const hostSocket = socketLog();
  object.sessions.set('host-session', {
    ws: hostSocket,
    userId: host.id,
    seat: 0,
    rateWindowAt: Date.now(),
    rateCount: 0,
  });
  await object.handleMessage('host-session', JSON.stringify({ type: 'startGame' }));
  assert.equal((await state.storage.get('room')).game, null);
  assert.match(hostSocket.messages.at(-1).error, /все приглашённые/i);

  const joinedResponse = await object.fetch(roomRequest('join', {
    user: guest,
    displayName: 'Алиса',
  }));
  assert.equal(joinedResponse.status, 200);
  const joined = await joinedResponse.json();
  assert.equal(joined.localSeat, 1);
  assert.equal(joined.room.seats[1].name, 'Алиса');
  assert.equal(joined.room.seats[1].connected, false);
  assert.equal(JSON.stringify(joined.room).includes('tg:2'), false);

  storedRoom = await state.storage.get('room');
  storedRoom.seats[0].connected = true;
  storedRoom.seats[1].connected = true;
  await state.storage.put('room', storedRoom);
  const guestSocket = socketLog();
  object.sessions.set('guest-session', {
    ws: guestSocket,
    userId: guest.id,
    seat: 1,
    rateWindowAt: Date.now(),
    rateCount: 0,
  });
  assert.equal(object.canStart(storedRoom), true);
  await object.handleMessage('host-session', JSON.stringify({ type: 'startGame' }));

  storedRoom = await state.storage.get('room');
  assert.equal(storedRoom.status, 'playing');
  assert.ok(storedRoom.game);
  assert.deepEqual(storedRoom.game.hands.map(hand => hand.length), [8, 8, 8, 8]);
  const hostView = hostSocket.messages.filter(message => message.type === 'gameState').at(-1).game;
  const guestView = guestSocket.messages.filter(message => message.type === 'gameState').at(-1).game;
  assert.equal(hostView.handIds.length, 8);
  assert.equal(guestView.handIds.length, 8);
  assert.equal('hands' in hostView, false);
  assert.equal(hostView.handIds.some(cardId => guestView.handIds.includes(cardId)), false);

  const rejoin = await object.fetch(roomRequest('join', {
    user: guest,
    displayName: 'Алиса вернулась',
  }));
  assert.equal(rejoin.status, 200);
  assert.equal((await rejoin.json()).localSeat, 1);
  const stranger = await object.fetch(roomRequest('join', {
    user: { id: 'tg:3', name: 'Лишний' },
    displayName: 'Лишний',
  }));
  assert.equal(stranger.status, 409);
});

test('simultaneous invite opens are serialized into different reserved seats', async () => {
  const state = makeState();
  const object = new GameRoom(state, {});
  await object.fetch(roomRequest('create', {
    user: { id: 'tg:host', name: 'Хозяин' },
    displayName: 'Хозяин',
    choices: [{ type: 'human' }, { type: 'human' }, { type: 'human' }],
  }));
  const [firstResponse, secondResponse] = await Promise.all([
    object.fetch(roomRequest('join', {
      user: { id: 'tg:first', name: 'Первый' },
      displayName: 'Первый',
    })),
    object.fetch(roomRequest('join', {
      user: { id: 'tg:second', name: 'Второй' },
      displayName: 'Второй',
    })),
  ]);
  const first = await firstResponse.json();
  const second = await secondResponse.json();
  assert.notEqual(first.localSeat, second.localSeat);
  assert.deepEqual(new Set([first.localSeat, second.localSeat]), new Set([1, 2]));
  const room = await state.storage.get('room');
  assert.equal(room.seats.filter(record => record.type === 'pending').length, 1);
});
