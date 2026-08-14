import { CHARACTERS } from '../src/game-engine.js';
import {
  advanceNetworkGame,
  beginTrickCollection,
  createNetworkGame,
  gameForPlayer,
  playHumanCard,
} from './network-game.js';

const TICKET_LIFETIME_MS = 5 * 60 * 1000;
const MAX_MESSAGE_BYTES = 2_048;
const MAX_MESSAGES_PER_SECOND = 30;
const ROOM_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function cleanName(value, fallback = 'Игрок') {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return normalized || fallback;
}

function randomToken(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pendingSeat(seat) {
  return {
    seat,
    type: 'pending',
    name: 'Ожидаем игрока',
    connected: false,
  };
}

function botSeat(seat, characterId) {
  const character = CHARACTERS[characterId];
  if (!character) throw new Error('Неизвестный персонаж компьютера.');
  return {
    seat,
    type: 'bot',
    characterId,
    name: character.name,
    connected: true,
  };
}

function humanSeat(user, seat, displayName, host = false) {
  return {
    seat,
    type: 'human',
    userId: user.id,
    name: cleanName(displayName, user.name),
    photoUrl: user.photoUrl || '',
    username: user.username || '',
    host,
    connected: false,
    joinedAt: Date.now(),
    disconnectedAt: null,
  };
}

function normalizeChoices(choices) {
  if (!Array.isArray(choices) || choices.length !== 3) {
    throw new Error('Выберите ровно трёх партнёров.');
  }

  let humanCount = 0;
  const botIds = new Set();
  const normalized = choices.map((choice, index) => {
    if (choice?.type === 'human') {
      humanCount += 1;
      return { type: 'human' };
    }
    if (choice?.type !== 'bot' || !Number.isInteger(choice.characterId) || !CHARACTERS[choice.characterId]) {
      throw new Error(`Неверно выбрано место ${index + 2}.`);
    }
    if (botIds.has(choice.characterId)) throw new Error('Один персонаж не может играть дважды.');
    botIds.add(choice.characterId);
    return { type: 'bot', characterId: choice.characterId };
  });

  if (humanCount < 1 || humanCount > 3) {
    throw new Error('Для сетевой игры нужно от одного до трёх живых оппонентов.');
  }
  return normalized;
}

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.operationQueue = Promise.resolve();
  }

  runExclusive(operation) {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.catch(() => {});
    return result;
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      const match = url.pathname.match(/^\/room\/([A-Za-z0-9_-]{12,64})\/(create|join|ws)$/);
      if (!match) return json({ ok: false, error: 'Комната не найдена.' }, 404);
      const [, roomId, action] = match;

      if (action === 'create' && request.method === 'POST') {
        return await this.runExclusive(() => this.create(roomId, request));
      }
      if (action === 'join' && request.method === 'POST') {
        return await this.runExclusive(() => this.join(roomId, request));
      }
      if (action === 'ws' && request.method === 'GET') {
        return await this.runExclusive(() => this.acceptWebSocket(roomId, request));
      }
      return json({ ok: false, error: 'Метод не поддерживается.' }, 405);
    } catch (error) {
      return json({ ok: false, error: error?.message || 'Ошибка комнаты.' }, 400);
    }
  }

  async create(roomId, request) {
    const existing = await this.getRoom();
    if (existing) return json({ ok: false, error: 'Такая комната уже существует.' }, 409);

    const { user, choices, displayName } = await request.json();
    if (!user?.id) return json({ ok: false, error: 'Нет данных игрока.' }, 401);
    const normalizedChoices = normalizeChoices(choices);
    const now = Date.now();
    const seats = [humanSeat(user, 0, displayName, true)];
    normalizedChoices.forEach((choice, index) => {
      seats.push(choice.type === 'human'
        ? pendingSeat(index + 1)
        : botSeat(index + 1, choice.characterId));
    });
    const room = {
      version: 1,
      roomId,
      hostUserId: user.id,
      status: 'lobby',
      seats,
      game: null,
      tickets: {},
      createdAt: now,
      updatedAt: now,
    };
    const ticket = this.issueTicket(room, user.id, 0);
    await this.saveRoom(room);
    return json({
      ok: true,
      ticket,
      localSeat: 0,
      room: this.publicRoom(room, user.id),
    });
  }

  async join(roomId, request) {
    const room = await this.getRoom();
    if (!room || room.roomId !== roomId) return json({ ok: false, error: 'Комната не найдена.' }, 404);
    const { user, displayName } = await request.json();
    if (!user?.id) return json({ ok: false, error: 'Нет данных игрока.' }, 401);

    let seat = room.seats.findIndex(record => record.type === 'human' && record.userId === user.id);
    if (seat < 0) {
      if (room.status !== 'lobby') return json({ ok: false, error: 'Партия уже началась.' }, 409);
      seat = room.seats.findIndex(record => record.type === 'pending');
      if (seat < 0) return json({ ok: false, error: 'В комнате нет свободного места.' }, 409);
      room.seats[seat] = humanSeat(user, seat, displayName, false);
    } else {
      room.seats[seat].name = cleanName(displayName, room.seats[seat].name || user.name);
      room.seats[seat].photoUrl = user.photoUrl || room.seats[seat].photoUrl || '';
      room.seats[seat].username = user.username || room.seats[seat].username || '';
    }

    const ticket = this.issueTicket(room, user.id, seat);
    room.updatedAt = Date.now();
    await this.saveRoom(room);
    return json({
      ok: true,
      ticket,
      localSeat: seat,
      room: this.publicRoom(room, user.id),
    });
  }

  async acceptWebSocket(roomId, request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ ok: false, error: 'Ожидается WebSocket.' }, 426);
    }
    const room = await this.getRoom();
    if (!room || room.roomId !== roomId) return json({ ok: false, error: 'Комната не найдена.' }, 404);
    const ticket = request.headers.get('x-king-room-ticket') || new URL(request.url).searchParams.get('ticket') || '';
    const admission = room.tickets?.[ticket];
    if (!admission) {
      return json({ ok: false, error: 'Ссылка на вход устарела. Откройте комнату заново.' }, 401);
    }
    delete room.tickets[ticket];
    if (admission.expiresAt < Date.now()) {
      await this.saveRoom(room);
      return json({ ok: false, error: 'Ссылка на вход устарела. Откройте комнату заново.' }, 401);
    }
    const seatRecord = room.seats[admission.seat];
    if (seatRecord?.type !== 'human' || seatRecord.userId !== admission.userId) {
      await this.saveRoom(room);
      return json({ ok: false, error: 'Место игрока больше недоступно.' }, 409);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    this.sessions.set(sessionId, {
      ws: server,
      userId: admission.userId,
      seat: admission.seat,
      rateWindowAt: now,
      rateCount: 0,
    });
    seatRecord.connected = true;
    seatRecord.disconnectedAt = null;
    room.updatedAt = now;
    await this.saveRoom(room);

    this.send(server, {
      type: 'welcome',
      roomId,
      localSeat: admission.seat,
      isHost: room.hostUserId === admission.userId,
    });
    await this.broadcast(room);

    server.addEventListener('message', event => {
      void this.runExclusive(() => this.handleMessage(sessionId, event.data));
    });
    server.addEventListener('close', () => {
      void this.runExclusive(() => this.disconnect(sessionId));
    });
    server.addEventListener('error', () => {
      void this.runExclusive(() => this.disconnect(sessionId));
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleMessage(sessionId, rawData) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (typeof rawData !== 'string' || new TextEncoder().encode(rawData).byteLength > MAX_MESSAGE_BYTES) {
      this.send(session.ws, { type: 'error', error: 'Слишком большое сообщение.' });
      return;
    }
    const now = Date.now();
    if (now - session.rateWindowAt >= 1_000) {
      session.rateWindowAt = now;
      session.rateCount = 0;
    }
    session.rateCount += 1;
    if (session.rateCount > MAX_MESSAGES_PER_SECOND) {
      this.send(session.ws, { type: 'error', error: 'Слишком много команд.' });
      return;
    }

    let message;
    try {
      message = JSON.parse(rawData);
    } catch {
      this.send(session.ws, { type: 'error', error: 'Неверное сообщение.' });
      return;
    }

    const room = await this.getRoom();
    if (!room) return;
    try {
      if (message.type === 'requestState') {
        await this.sendState(room, session);
        return;
      }

      if (message.type === 'setName') {
        const record = room.seats[session.seat];
        if (record?.type !== 'human' || record.userId !== session.userId) throw new Error('Место вам не принадлежит.');
        record.name = cleanName(message.name, record.name);
        room.updatedAt = now;
        await this.saveRoom(room);
        await this.broadcast(room);
        return;
      }

      if (message.type === 'startGame') {
        if (room.hostUserId !== session.userId) throw new Error('Начать игру может только создатель комнаты.');
        if (room.status !== 'lobby') throw new Error('Игра уже началась.');
        if (!this.canStart(room)) throw new Error('Дождитесь, пока все приглашённые игроки подключатся.');
        room.game = createNetworkGame(room.seats, undefined, now);
        room.status = 'playing';
        room.updatedAt = now;
        await this.saveRoom(room);
        await this.broadcast(room);
        return;
      }

      if (message.type === 'playCard') {
        if (room.status !== 'playing' || !room.game) throw new Error('Игра ещё не началась.');
        const record = room.seats[session.seat];
        if (record?.type !== 'human' || record.userId !== session.userId) throw new Error('Это место вам не принадлежит.');
        playHumanCard(room.game, room.seats, session.seat, String(message.cardId || ''), now);
        room.updatedAt = now;
        await this.saveRoom(room);
        await this.broadcast(room);
        return;
      }

      if (message.type === 'collectTrick') {
        if (room.status !== 'playing' || !room.game) throw new Error('Игра ещё не началась.');
        beginTrickCollection(room.game, now);
        room.updatedAt = now;
        await this.saveRoom(room);
        await this.broadcast(room);
        return;
      }

      if (message.type === 'advance') {
        if (room.status !== 'playing' || !room.game) return;
        if (!advanceNetworkGame(room.game, room.seats, now)) return;
        if (room.game.status === 'game-over') room.status = 'finished';
        room.updatedAt = now;
        await this.saveRoom(room);
        await this.broadcast(room);
      }
    } catch (error) {
      this.send(session.ws, { type: 'error', error: error?.message || 'Ошибка игры.' });
    }
  }

  async disconnect(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    const room = await this.getRoom();
    if (!room) return;
    const stillConnected = [...this.sessions.values()].some(candidate => candidate.userId === session.userId);
    const record = room.seats[session.seat];
    if (!stillConnected && record?.type === 'human' && record.userId === session.userId) {
      record.connected = false;
      record.disconnectedAt = Date.now();
      room.updatedAt = Date.now();
      await this.saveRoom(room);
      await this.broadcast(room);
    }
  }

  canStart(room) {
    return room.status === 'lobby'
      && room.seats.every(record => record.type !== 'pending')
      && room.seats.filter(record => record.type === 'human').every(record => this.isHumanConnected(record));
  }

  isHumanConnected(record) {
    return record?.type === 'human'
      && [...this.sessions.values()].some(session => session.userId === record.userId);
  }

  issueTicket(room, userId, seat) {
    room.tickets ||= {};
    const now = Date.now();
    for (const [token, ticket] of Object.entries(room.tickets)) {
      if (ticket.expiresAt < now || ticket.userId === userId) delete room.tickets[token];
    }
    const token = randomToken();
    room.tickets[token] = { userId, seat, expiresAt: now + TICKET_LIFETIME_MS };
    return token;
  }

  publicRoom(room, localUserId) {
    const localSeat = room.seats.findIndex(record => record.type === 'human' && record.userId === localUserId);
    return {
      roomId: room.roomId,
      status: room.status,
      localSeat,
      isHost: room.hostUserId === localUserId,
      canStart: room.hostUserId === localUserId && this.canStart(room),
      seats: room.seats.map(record => ({
        seat: record.seat,
        type: record.type,
        name: record.name,
        photoUrl: record.photoUrl || '',
        characterId: Number.isInteger(record.characterId) ? record.characterId : null,
        host: Boolean(record.host),
        connected: record.type === 'bot' || this.isHumanConnected(record),
      })),
    };
  }

  async sendState(room, session) {
    this.send(session.ws, {
      type: 'roomState',
      room: this.publicRoom(room, session.userId),
    });
    if (room.game) {
      this.send(session.ws, {
        type: 'gameState',
        game: gameForPlayer(room.game, session.seat),
      });
    }
  }

  async broadcast(room) {
    for (const session of this.sessions.values()) await this.sendState(room, session);
  }

  send(socket, message) {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // The close handler removes dead sockets.
    }
  }

  async getRoom() {
    return (await this.state.storage.get('room')) || null;
  }

  async saveRoom(room) {
    await this.state.storage.put('room', room);
    await this.state.storage.setAlarm?.(Date.now() + ROOM_LIFETIME_MS);
  }

  async alarm() {
    const room = await this.getRoom();
    if (!room || Date.now() - room.updatedAt >= ROOM_LIFETIME_MS) {
      await this.state.storage.deleteAll();
      return;
    }
    await this.state.storage.setAlarm?.(room.updatedAt + ROOM_LIFETIME_MS);
  }
}
