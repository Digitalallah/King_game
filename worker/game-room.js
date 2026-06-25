const EMPTY_SEATS = [
  { seat: 0, type: 'bot', name: 'Компьютер 0' },
  { seat: 1, type: 'bot', name: 'Компьютер 1' },
  { seat: 2, type: 'bot', name: 'Компьютер 2' },
  { seat: 3, type: 'bot', name: 'Компьютер 3' },
];

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      const roomId = url.pathname.split('/')[2];

      if (url.pathname.endsWith('/create') && request.method === 'POST') {
        const { user } = await request.json();
        const room = await this.getRoom(roomId);
        if (!room.hostUserId) {
          room.roomId = roomId;
          room.hostUserId = user.id;
          room.status = 'lobby';
          room.createdAt = Date.now();
          room.seats = this.defaultSeats();
          room.seats[0] = this.playerRecord(user, 0, true, true);
          await this.saveRoom(room);
        }
        return json({ ok: true, room: this.publicRoom(room) });
      }

      if (url.pathname.endsWith('/ws')) {
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
        const user = JSON.parse(request.headers.get('x-king-user') || '{}');
        if (!user.id) return json({ error: 'Unauthorized' }, 401);
        const preferredSeat = Number(url.searchParams.get('seat') || 0);
        return this.acceptWebSocket(roomId, user, preferredSeat);
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('GameRoom fetch failed', error?.stack || error);
      return json({ error: error?.message || 'Internal error' }, 500);
    }
  }

  async acceptWebSocket(roomId, user, preferredSeat) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const room = await this.getRoom(roomId);
    const seat = this.assignSeat(room, user, preferredSeat);
    if (seat === -1) {
      this.send(server, { type: 'error', error: 'Партия уже заполнена' });
      server.close(1013, 'Room is full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, { ws: server, userId: user.id, seat });
    room.seats[seat] = this.playerRecord(user, seat, room.hostUserId === user.id, true);
    await this.saveRoom(room);
    this.send(server, { type: 'welcome', roomId, seat, isHost: room.hostUserId === user.id });
    await this.broadcastState(room);

    server.addEventListener('message', async event => this.handleMessage(sessionId, event.data));
    server.addEventListener('close', async () => this.disconnect(sessionId));
    server.addEventListener('error', async () => this.disconnect(sessionId));
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleMessage(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    let message;
    try { message = JSON.parse(data); } catch { return; }
    const room = await this.getRoom();
    const isHost = room.hostUserId === session.userId;

    if (message.type === 'reserveSeat' && isHost && room.status === 'lobby') {
      const seat = Number(message.seat);
      if (seat >= 1 && seat <= 3 && room.seats[seat]?.type === 'bot') {
        room.seats[seat] = { seat, type: 'pending', name: 'Ожидаем друга', reservedAt: Date.now() };
        await this.saveRoom(room);
        await this.broadcastState(room);
      }
      return;
    }

    if (message.type === 'cancelSeat' && isHost && room.status === 'lobby') {
      const seat = Number(message.seat);
      if (seat >= 1 && seat <= 3 && room.seats[seat]?.type === 'pending') {
        room.seats[seat] = this.botRecord(seat);
        await this.saveRoom(room);
        await this.broadcastState(room);
      }
      return;
    }

    if (message.type === 'startGame') {
      if (!isHost) {
        this.send(session.ws, { type: 'error', error: 'Начать партию может только хост.' });
        return;
      }
      room.status = 'playing';
      room.seats = room.seats.map((seat, index) => seat?.type === 'pending' ? this.botRecord(index) : seat);
      await this.saveRoom(room);
      await this.broadcast({ type: 'gameStarting', room: this.publicRoom(room) });
    }
  }

  async disconnect(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    const stillConnected = [...this.sessions.values()].some(item => item.userId === session.userId);
    const room = await this.getRoom();
    const player = room.seats[session.seat];
    if (player?.type === 'human' && player.userId === session.userId && !stillConnected) {
      player.connected = false;
      player.disconnectedAt = Date.now();
      await this.saveRoom(room);
      await this.broadcastState(room);
    }
  }

  assignSeat(room, user, preferredSeat) {
    if (room.status !== 'lobby') return -1;
    const existing = room.seats.findIndex(seat => seat?.type === 'human' && seat.userId === user.id);
    if (existing !== -1) return existing;
    if (preferredSeat >= 1 && preferredSeat <= 3 && room.seats[preferredSeat]?.type !== 'human') return preferredSeat;
    const free = room.seats.findIndex((seat, index) => index > 0 && seat?.type !== 'human');
    return free === -1 ? -1 : free;
  }

  playerRecord(user, seat, host, connected) {
    return { type: 'human', userId: user.id, seat, name: user.name || 'Игрок', photoUrl: user.photoUrl || '', host, connected, lastSeenAt: Date.now(), disconnectedAt: connected ? null : Date.now() };
  }

  botRecord(seat) { return { seat, type: 'bot', name: `Компьютер ${seat}` }; }
  defaultSeats() { return EMPTY_SEATS.map((_, seat) => this.botRecord(seat)); }
  async getRoom(roomId = null) { return (await this.state.storage.get('room')) || { roomId, hostUserId: '', status: 'lobby', createdAt: Date.now(), seats: this.defaultSeats() }; }
  async saveRoom(room) { await this.state.storage.put('room', room); }
  publicRoom(room) { return { roomId: room.roomId, status: room.status, hostUserId: room.hostUserId, seats: room.seats.map(seat => seat && ({ seat: seat.seat, type: seat.type, name: seat.name, photoUrl: seat.photoUrl || '', host: Boolean(seat.host), connected: Boolean(seat.connected), userId: seat.userId || '' })) }; }
  async broadcastState(room) { await this.broadcast({ type: 'roomState', room: this.publicRoom(room) }); }
  async broadcast(message) { for (const { ws } of this.sessions.values()) this.send(ws, message); }
  send(ws, message) { try { ws.send(JSON.stringify(message)); } catch {} }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
