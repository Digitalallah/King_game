const ACTIVE_ROOM_KEY = 'king-active-network-room';
const DEV_USER_KEY = 'king-network-dev-user';
const INVITE_TEXT = 'Привет, я решил поиграть в игру Кинг, присоединяйся!';

export function parseRoomInvite({ telegram, search = '' } = {}) {
  const query = new URLSearchParams(search);
  const startParam = telegram?.initDataUnsafe?.start_param
    || query.get('tgWebAppStartParam')
    || query.get('startapp')
    || '';
  const match = String(startParam).match(/^room_([A-Za-z0-9_-]{12,64})$/);
  const fallback = query.get('king_room') || '';
  if (match) return match[1];
  return /^[A-Za-z0-9_-]{12,64}$/.test(fallback) ? fallback : '';
}

export function defaultPlayerName(telegram) {
  const user = telegram?.initDataUnsafe?.user;
  return [user?.first_name, user?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()
    || user?.username
    || 'Игрок';
}

export function makeInviteLink(appUrl, roomId) {
  if (!appUrl || !/^[A-Za-z0-9_-]{12,64}$/.test(roomId)) return '';
  const url = new URL(appUrl);
  url.searchParams.set('startapp', `room_${roomId}`);
  return url.href;
}

export function makeTelegramShareUrl(inviteLink) {
  const url = new URL('https://t.me/share/url');
  url.searchParams.set('url', inviteLink);
  url.searchParams.set('text', INVITE_TEXT);
  return url.href;
}

function safeStorage(storage) {
  try {
    storage?.getItem('king-storage-check');
    return storage;
  } catch {
    return null;
  }
}

function cleanDisplayName(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
    || 'Игрок';
}

export class KingRoomClient {
  constructor({
    telegram = globalThis.window?.Telegram?.WebApp,
    baseUrl = globalThis.location?.origin || 'http://localhost',
    fetchImpl = globalThis.fetch,
    WebSocketImpl = globalThis.WebSocket,
    storage = globalThis.window?.localStorage,
  } = {}) {
    this.telegram = telegram;
    this.baseUrl = baseUrl;
    this.fetchImpl = typeof fetchImpl === 'function'
      ? fetchImpl.bind(globalThis.window ?? globalThis)
      : null;
    this.WebSocketImpl = WebSocketImpl;
    this.storage = safeStorage(storage);
    this.config = null;
    this.roomId = '';
    this.displayName = defaultPlayerName(telegram);
    this.socket = null;
    this.closedIntentionally = false;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.callbacks = {
      welcome: () => {},
      room: () => {},
      game: () => {},
      error: () => {},
      connection: () => {},
    };
  }

  on(type, callback) {
    if (type in this.callbacks && typeof callback === 'function') this.callbacks[type] = callback;
    return this;
  }

  async loadConfig() {
    if (this.config) return this.config;
    if (!this.fetchImpl) throw new Error('Браузер не поддерживает сетевые запросы.');
    const response = await this.fetchImpl(new URL('/api/config', this.baseUrl), {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.error || 'Сетевая игра не настроена.');
    this.config = body;
    return body;
  }

  authBody(displayName) {
    const body = {
      initData: this.telegram?.initData || '',
      displayName: cleanDisplayName(displayName),
    };
    if (this.config?.devAuth) body.devUserId = this.getDevUserId();
    return body;
  }

  getDevUserId() {
    let id = this.storage?.getItem(DEV_USER_KEY) || '';
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try {
        this.storage?.setItem(DEV_USER_KEY, id);
      } catch {
        // Local development still works for the current page without persistence.
      }
    }
    return id;
  }

  async post(path, payload) {
    const response = await this.fetchImpl(new URL(path, this.baseUrl), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.error || 'Не удалось подключиться к комнате.');
    return body;
  }

  async create({ choices, displayName }) {
    await this.loadConfig();
    this.displayName = cleanDisplayName(displayName);
    const body = await this.post('/api/rooms', {
      ...this.authBody(this.displayName),
      choices,
    });
    this.roomId = body.room.roomId;
    this.saveActiveRoom();
    this.connectSocket(body.ticket);
    return body;
  }

  async join({ roomId, displayName }) {
    await this.loadConfig();
    if (!/^[A-Za-z0-9_-]{12,64}$/.test(roomId)) throw new Error('Неверная ссылка на комнату.');
    this.displayName = cleanDisplayName(displayName);
    const body = await this.post(`/api/rooms/${encodeURIComponent(roomId)}/join`, this.authBody(this.displayName));
    this.roomId = roomId;
    this.saveActiveRoom();
    this.connectSocket(body.ticket);
    return body;
  }

  connectSocket(ticket) {
    if (!this.WebSocketImpl) throw new Error('Браузер не поддерживает сетевую игру.');
    this.closedIntentionally = false;
    const previousSocket = this.socket;
    const url = new URL(`/api/rooms/${encodeURIComponent(this.roomId)}/ws`, this.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('ticket', ticket);
    const socket = new this.WebSocketImpl(url.href);
    this.socket = socket;
    if (previousSocket && previousSocket.readyState < 2) previousSocket.close(1000, 'Reconnect');
    this.callbacks.connection('connecting');
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.callbacks.connection('open');
    });
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return;
      this.handleMessage(event.data);
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.callbacks.connection('closed');
      if (!this.closedIntentionally) this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      if (this.socket === socket) this.callbacks.connection('error');
    });
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      this.callbacks.error('Сервер прислал неверный ответ.');
      return;
    }
    if (message.type === 'welcome') this.callbacks.welcome(message);
    else if (message.type === 'roomState') this.callbacks.room(message.room);
    else if (message.type === 'gameState') this.callbacks.game(message.game);
    else if (message.type === 'error') this.callbacks.error(message.error || 'Ошибка сетевой игры.');
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const delay = Math.min(8_000, 700 * (2 ** this.reconnectAttempt));
    this.reconnectAttempt += 1;
    this.callbacks.connection('reconnecting');
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.join({ roomId: this.roomId, displayName: this.displayName });
      } catch (error) {
        this.callbacks.error(error?.message || 'Не удалось вернуться в комнату.');
        if (!this.closedIntentionally) this.scheduleReconnect();
      }
    }, delay);
  }

  send(type, payload = {}) {
    if (!this.socket || this.socket.readyState !== 1) {
      this.callbacks.error('Связь с комнатой ещё не восстановлена.');
      return false;
    }
    this.socket.send(JSON.stringify({ type, ...payload }));
    return true;
  }

  setName(name) {
    this.displayName = cleanDisplayName(name);
    return this.send('setName', { name: this.displayName });
  }

  startGame() { return this.send('startGame'); }
  playCard(cardId) { return this.send('playCard', { cardId }); }
  collectTrick() { return this.send('collectTrick'); }
  advance() { return this.send('advance'); }
  requestState() { return this.send('requestState'); }

  inviteLink() {
    return makeInviteLink(this.config?.appUrl || '', this.roomId);
  }

  shareUrl() {
    const invite = this.inviteLink();
    return invite ? makeTelegramShareUrl(invite) : '';
  }

  saveActiveRoom() {
    try {
      this.storage?.setItem(ACTIVE_ROOM_KEY, JSON.stringify({
        roomId: this.roomId,
        displayName: this.displayName,
        savedAt: Date.now(),
      }));
    } catch {
      // Reopening through the Telegram invite still works when storage is blocked.
    }
  }

  savedRoom() {
    try {
      const value = JSON.parse(this.storage?.getItem(ACTIVE_ROOM_KEY) || 'null');
      if (!value || !/^[A-Za-z0-9_-]{12,64}$/.test(value.roomId)) return null;
      if (Date.now() - Number(value.savedAt || 0) > 7 * 24 * 60 * 60 * 1000) return null;
      return {
        roomId: value.roomId,
        displayName: cleanDisplayName(value.displayName),
      };
    } catch {
      return null;
    }
  }

  clearActiveRoom() {
    try {
      this.storage?.removeItem(ACTIVE_ROOM_KEY);
    } catch {
      // Nothing else is required.
    }
  }

  disconnect({ forget = false } = {}) {
    this.closedIntentionally = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close?.(1000, 'Closed by player');
    this.socket = null;
    if (forget) this.clearActiveRoom();
  }
}

export { INVITE_TEXT };
