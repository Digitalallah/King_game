const SEAT_HOLD_MS = 60_000;
const EMPTY_SEATS = [null, null, null, null];

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const roomId = url.pathname.split('/')[2];

    if (url.pathname.endsWith('/create') && request.method === 'POST') {
      const { user } = await request.json();
      const room = await this.getRoom(roomId);
      if (!room.hostUserId) {
        room.hostUserId = user.id;
        room.createdAt = Date.now();
        room.seats[0] = this.playerRecord(user, 0, true, false);
        await this.saveRoom(room);
      }
      return json({ ok: true, room: this.publicRoom(room) });
    }

    if (url.pathname.endsWith('/ws')) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      const user = JSON.parse(request.headers.get('x-king-user') || '{}');
      if (!user.id) return json({ error: 'Unauthorized' }, 401);
      return this.acceptWebSocket(roomId, user);
    }

    return new Response('Not found', { status: 404 });
  }

  async acceptWebSocket(roomId, user) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const room = await this.getRoom(roomId);
    const seat = this.assignSeat(room, user);
    if (seat === -1) {
      server.send(JSON.stringify({ type: 'error', error: 'Комната заполнена.' }));
      server.close(1013, 'Room is full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, { ws: server, userId: user.id, seat });
    room.seats[seat] = { ...room.seats[seat], ...this.playerRecord(user, seat, room.hostUserId === user.id, true) };
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
    const player = room.seats[session.seat];
    if (!player || player.userId !== session.userId) return;

    if (message.type === 'setReady') {
      player.ready = Boolean(message.ready);
      player.lastSeenAt = Date.now();
      await this.saveRoom(room);
      await this.broadcastState(room);
      return;
    }

    if (message.type === 'startGame') {
      const connected = room.seats.filter(seat => seat?.connected).length;
      if (room.hostUserId !== session.userId || connected < 2) {
        this.send(session.ws, { type: 'error', error: 'Начать игру может только хост при минимум двух подключённых игроках.' });
        return;
      }
      room.status = 'starting';
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
    if (player && player.userId === session.userId && !stillConnected) {
      player.connected = false;
      player.disconnectedAt = Date.now();
      await this.saveRoom(room);
      await this.broadcastState(room);
    }
  }

  assignSeat(room, user) {
    const existing = room.seats.findIndex(seat => seat?.userId === user.id);
    if (existing !== -1) return existing;
    const now = Date.now();
    const free = room.seats.findIndex(seat => !seat || (!seat.connected && seat.disconnectedAt && now - seat.disconnectedAt >= SEAT_HOLD_MS));
    return free === -1 ? -1 : free;
  }

  playerRecord(user, seat, host, connected) {
    return { userId: user.id, seat, name: user.name || 'Игрок', photoUrl: user.photoUrl || '', host, connected, ready: false, lastSeenAt: Date.now(), disconnectedAt: connected ? null : Date.now() };
  }

  async getRoom(roomId = null) {
    return (await this.state.storage.get('room')) || { roomId, hostUserId: '', status: 'lobby', createdAt: Date.now(), seats: [...EMPTY_SEATS] };
  }

  async saveRoom(room) { await this.state.storage.put('room', room); }
  publicRoom(room) { return { roomId: room.roomId, status: room.status, hostUserId: room.hostUserId, seats: room.seats.map(seat => seat && ({ seat: seat.seat, name: seat.name, photoUrl: seat.photoUrl, host: seat.host, connected: seat.connected, ready: seat.ready })) }; }
  async broadcastState(room) { await this.broadcast({ type: 'roomState', room: this.publicRoom(room) }); }
  async broadcast(message) { for (const { ws } of this.sessions.values()) this.send(ws, message); }
  send(ws, message) { try { ws.send(JSON.stringify(message)); } catch {} }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
