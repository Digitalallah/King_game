import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createDeck } from '../src/game-engine.js';

class MockImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

class MockElement {
  constructor(id) {
    this.id = id;
    this.hidden = false;
    this.open = false;
    this.disabled = false;
    this.textContent = '';
    this.value = '';
    this.href = 'https://t.me/oodalenka';
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.classList = { add() {}, remove() {}, contains() { return false; } };
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  replaceWith() {}
  remove() {}
  focus() {}
}

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  emit(type, payload = {}) {
    for (const listener of this.listeners.get(type) || []) listener(payload);
  }
  open() { this.readyState = 1; this.emit('open'); }
  message(value) { this.emit('message', { data: JSON.stringify(value) }); }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
}

async function eventually(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for network UI state');
}

test('native picker creates a mixed lobby, waits for the guest, and plays through the shared socket', async () => {
  const context = { imageSmoothingEnabled: false, putImageData() {} };
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new MockElement(id));
    return elements.get(id);
  };
  const canvas = element('gameCanvas');
  canvas.width = 640;
  canvas.height = 350;
  canvas.getContext = () => context;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 350 });
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};

  const ids = [
    'gameCanvas', 'avatarLayer', 'orientationHint', 'loadingOverlay', 'loadingText', 'loadingBar',
    'retryButton', 'startOverlay', 'savedGameInfo', 'continueButton', 'continueNetworkButton',
    'newGameButton', 'restartButton', 'soundButton', 'rulesButton', 'aboutButton', 'rulesDialog',
    'aboutDialog', 'networkDialog', 'networkDialogTitle', 'networkLead', 'networkNameInput',
    'networkConnectButton', 'networkCloseButton', 'networkStatus', 'networkLobby', 'networkRoomCode',
    'networkPlayers', 'networkInviteButton', 'networkCopyButton', 'networkStartButton', 'gameHint',
  ];
  const selectors = Object.fromEntries(ids.map(id => [`#${id}`, id]));
  selectors['#aboutDialog a[href^="https://t.me/"]'] = 'aboutLink';
  const stored = new Map();
  const documentListeners = new Map();
  const roomId = 'ABCDEFGHJKLMNPQRST23';
  const ticket = 'abcdefghijklmnopqrstuvwxyzABCDEFGH';
  const initialRoom = {
    roomId,
    status: 'lobby',
    localSeat: 0,
    isHost: true,
    canStart: false,
    seats: [
      { seat: 0, type: 'human', name: 'Алиса', photoUrl: 'https://t.me/i/userpic/alice.svg', host: true, connected: false, characterId: null },
      { seat: 1, type: 'pending', name: 'Ожидаем игрока', photoUrl: '', host: false, connected: false, characterId: null },
      { seat: 2, type: 'bot', name: 'Винни Пух', photoUrl: '', host: false, connected: true, characterId: 0 },
      { seat: 3, type: 'bot', name: 'Кролик', photoUrl: '', host: false, connected: true, characterId: 1 },
    ],
  };
  const apiRequests = [];

  globalThis.ImageData = MockImageData;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.location = { search: '?speed=0.01', origin: 'https://game.example' };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { maxTouchPoints: 0, clipboard: { async writeText() {} } },
  });
  globalThis.window = {
    location: globalThis.location,
    innerWidth: 800,
    innerHeight: 500,
    matchMedia() { return { matches: false, addEventListener() {} }; },
    addEventListener() {},
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, String(value)); },
      removeItem(key) { stored.delete(key); },
    },
    Telegram: {
      WebApp: {
        initData: 'auth_date=123&hash=signed',
        initDataUnsafe: { user: { first_name: 'Алиса' } },
        platform: 'web',
        ready() {}, expand() {}, disableVerticalSwipes() {}, unlockOrientation() {},
        setHeaderColor() {}, setBackgroundColor() {}, onEvent() {},
      },
    },
  };
  globalThis.document = {
    hidden: false,
    fullscreenElement: null,
    documentElement: {},
    querySelector(selector) { return element(selectors[selector]); },
    createElement(tag) { return new MockElement(tag); },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.protocol === 'file:') return new Response(await readFile(fileURLToPath(url)), { status: 200 });
    apiRequests.push({ url, init });
    if (url.pathname === '/api/config') {
      return Response.json({ ok: true, appUrl: 'https://t.me/KingIgraBot/King', devAuth: false });
    }
    if (url.pathname === '/api/rooms') {
      return Response.json({ ok: true, ticket, localSeat: 0, room: initialRoom });
    }
    throw new Error(`Unexpected API request ${url}`);
  };

  let pointerId = 0;
  const tap = (x, y) => {
    pointerId += 1;
    const shared = { isPrimary: true, pointerId, clientX: x, clientY: y, preventDefault() {} };
    canvas.emit('pointerdown', shared);
    canvas.emit('pointerup', shared);
  };

  await import(`../src/native-game.js?network-ui=${Date.now()}`);
  const debug = await eventually(() => window.__kingDebug);
  await eventually(() => debug.snapshot().screen === 'start');
  element('newGameButton').emit('click');
  tap(70, 160);
  tap(200, 60);
  tap(280, 60);
  await eventually(() => element('networkDialog').open);
  assert.deepEqual(debug.snapshot().selectedSeatChoices, [
    { type: 'human' },
    { type: 'bot', characterId: 0 },
    { type: 'bot', characterId: 1 },
  ]);
  assert.equal(element('networkConnectButton').textContent, 'Создать комнату');
  element('networkConnectButton').emit('click');
  const socket = await eventually(() => FakeWebSocket.instances[0]);
  socket.open();
  await eventually(() => debug.snapshot().networkRoom?.roomId === roomId);
  assert.equal(element('networkStartButton').disabled, true);
  assert.equal(JSON.parse(apiRequests.find(request => request.url.pathname === '/api/rooms').init.body).choices[0].type, 'human');

  const readyRoom = structuredClone(initialRoom);
  readyRoom.seats[0].connected = true;
  readyRoom.seats[1] = {
    seat: 1,
    type: 'human',
    name: 'Боб',
    photoUrl: 'https://t.me/i/userpic/bob.svg',
    host: false,
    connected: true,
    characterId: null,
  };
  readyRoom.canStart = true;
  socket.message({ type: 'roomState', room: readyRoom });
  await eventually(() => element('networkStartButton').disabled === false);
  assert.match(element('networkStatus').textContent, /Можно начинать/);
  element('networkStartButton').emit('click');
  assert.deepEqual(socket.sent.at(-1), { type: 'startGame' });

  const deck = createDeck();
  socket.message({
    type: 'gameState',
    game: {
      status: 'playing', contractIndex: 0, currentSeat: 0, trickNumber: 0, trick: [],
      trickWinnerSeat: null, handIds: deck.slice(0, 8).map(card => card.id), handCounts: [8, 8, 8, 8],
      legalCardIds: deck.slice(0, 8).map(card => card.id), scores: [0, 0, 0, 0],
      dealScores: [0, 0, 0, 0], winners: [], revision: 1, nextActionAt: null,
      serverNow: 1_000, message: '',
    },
  });
  const playerTurn = await eventually(() => {
    const snapshot = debug.snapshot();
    return snapshot.networkMode && snapshot.game?.currentSeat === 0 && !snapshot.inputLocked ? snapshot : null;
  });
  assert.equal(element('networkDialog').open, false);
  assert.match(element('gameHint').textContent, /^Ваш ход/);
  const card = playerTurn.game.playerCards.find(item => item.id === playerTurn.game.legalPlayerCardIds[0]);
  tap(card.x + 2, 310);
  tap(card.x + 2, 310);
  assert.deepEqual(socket.sent.at(-1), { type: 'playCard', cardId: card.id });

  socket.message({
    type: 'gameState',
    game: {
      status: 'trick-await', contractIndex: 0, currentSeat: 1, trickNumber: 1,
      trick: [0, 1, 2, 3].map((seat, index) => ({ seat, cardId: deck[index].id })),
      trickWinnerSeat: 1, handIds: deck.slice(4, 11).map(item => item.id), handCounts: [7, 7, 7, 7],
      legalCardIds: [], scores: [0, -20, 0, 0], dealScores: [0, -20, 0, 0], winners: [],
      revision: 5, nextActionAt: null, serverNow: 2_000, message: '',
    },
  });
  await eventually(() => debug.snapshot().game?.status === 'trick-await');
  assert.equal(debug.snapshot().game.trick.length, 4);
  tap(20, 20);
  assert.deepEqual(socket.sent.at(-1), { type: 'collectTrick' });
});
