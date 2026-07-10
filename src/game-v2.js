import { TELEGRAM_CONFIG, NETWORK_CONFIG } from './config.js';

const tg = window.Telegram?.WebApp;
const DEV_AUTH_ENABLED = Boolean(NETWORK_CONFIG?.devAuth);
const BOT_USERNAME = TELEGRAM_CONFIG.botUsername;
const APP_NAME = TELEGRAM_CONFIG.appName;

const CHARACTERS = [
  { name: 'Енот Шнырь', emoji: '🦝', bg: '#375a7f' },
  { name: 'Лиса Пикс', emoji: '🦊', bg: '#b85b20' },
  { name: 'Сова 404', emoji: '🦉', bg: '#594a7d' },
  { name: 'Барон Ус', emoji: '🧐', bg: '#6f3d2e' },
  { name: 'Жаба Босс', emoji: '🐸', bg: '#3f7d36' },
  { name: 'Кот Карман', emoji: '😼', bg: '#7c4f8f' },
  { name: 'Робо-Крендель', emoji: '🤖', bg: '#4c6a78' },
  { name: 'Маг Пыль', emoji: '🧙', bg: '#233b8f' },
  { name: 'Принцесса Вау', emoji: '👸', bg: '#b13b82' },
  { name: 'Красотка Неон', emoji: '💃', bg: '#a8325f' },
  { name: 'Русалка Байт', emoji: '🧜‍♀️', bg: '#167d8f' },
  { name: 'Вампирчик', emoji: '🧛', bg: '#4b224f' },
  { name: 'Инопуз', emoji: '👽', bg: '#2c7a54' },
  { name: 'Панда Паника', emoji: '🐼', bg: '#56606a' },
  { name: 'Единорог Глитч', emoji: '🦄', bg: '#8d4fb3' },
  { name: 'Курица Крит', emoji: '🐔', bg: '#9f6b24' },
];

const el = {
  contractTitle: document.querySelector('#contractTitle'),
  contractDescription: document.querySelector('#contractDescription'),
  roundLabel: document.querySelector('#roundLabel'),
  roundProgress: document.querySelector('#roundProgress'),
  scoreBoard: document.querySelector('#scoreBoard'),
  players: document.querySelector('#players'),
  trickArea: document.querySelector('#trickArea'),
  statusText: document.querySelector('#statusText'),
  hand: document.querySelector('#hand'),
  newGameButton: document.querySelector('#newGameButton'),
  hintButton: document.querySelector('#hintButton'),
  rulesButton: document.querySelector('#rulesButton'),
  portraitButton: document.querySelector('#portraitButton'),
  networkButton: document.querySelector('#networkButton'),
  networkGameButton: document.querySelector('#networkGameButton'),
  rulesDialog: document.querySelector('#rulesDialog'),
  portraitDialog: document.querySelector('#portraitDialog'),
  networkDialog: document.querySelector('#networkDialog'),
  portraitGrid: document.querySelector('#portraitGrid'),
  invitePreview: document.querySelector('#invitePreview'),
  lobbyPlayers: document.querySelector('#lobbyPlayers'),
  startNetworkButton: document.querySelector('#startNetworkButton'),
};

let selectedCharacter = 0;
let localSeat = 0;
let networkRole = 'host';
let networkClient = null;
let roomSnapshot = null;
let gameSnapshot = null;
let statusMessage = 'Нажмите «Начать партию», чтобы собрать общую игру.';
let networkCreating = false;
let awaitingMove = false;

const query = new URLSearchParams(window.location.search);
const startParam = tg?.initDataUnsafe?.start_param || query.get('tgWebAppStartParam') || '';
const inviteMatch = startParam.match(/^room_([A-Za-z0-9_-]+)(?:_seat_([1-4]))?$/);
const pendingInvite = {
  room: inviteMatch?.[1] || query.get('room_id') || query.get('king_room') || '',
  seat: inviteMatch?.[2] ? Number(inviteMatch[2]) - 1 : Number(query.get('king_seat') || 0),
};
const isInviteGuest = Boolean(pendingInvite.room);

function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  document.documentElement.style.setProperty('--tg-bg', tg.themeParams.bg_color || '#101827');
  document.documentElement.style.setProperty('--tg-text', tg.themeParams.text_color || '#f8fafc');
  tg.MainButton.setText('Начать партию');
  tg.MainButton.onClick(openNetworkLobby);
  tg.MainButton.show();
}

function networkConfigError() {
  if (!BOT_USERNAME) return 'Не задано имя Telegram-бота.';
  if (!APP_NAME) return 'Не задан short name Telegram Mini App.';
  if (!tg?.initData && !DEV_AUTH_ENABLED) return 'Откройте игру внутри Telegram.';
  return '';
}

function playerDisplayName() {
  const user = tg?.initDataUnsafe?.user;
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ')
    || user?.username
    || CHARACTERS[selectedCharacter].name;
}

function telegramPhotoUrl() {
  return tg?.initDataUnsafe?.user?.photo_url || '';
}

function getDevUserId() {
  const key = 'king-dev-user-id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto?.randomUUID?.() || String(Date.now());
    localStorage.setItem(key, id);
  }
  return id;
}

function avatarHtml(index, extraClass = '', photoUrl = '') {
  if (photoUrl) {
    return `<img class="avatar ${extraClass} telegram-avatar" src="${escapeHtml(photoUrl)}" alt="" />`;
  }
  const character = CHARACTERS[index % CHARACTERS.length];
  return `<span class="avatar ${extraClass}" style="--avatar-bg:${character.bg}" aria-hidden="true"><span>${character.emoji}</span></span>`;
}

function renderPortraitPicker() {
  if (!el.portraitGrid) return;
  el.portraitGrid.innerHTML = CHARACTERS.map((character, index) => `
    <button class="portrait-choice ${index === selectedCharacter ? 'selected' : ''}" type="button" data-character-id="${index}" style="--avatar-bg:${character.bg}">
      ${avatarHtml(index, 'portrait-avatar')}
      <span>${escapeHtml(character.name)}</span>
    </button>
  `).join('');
}

function defaultSeats() {
  return [0, 1, 2, 3].map(seat => ({
    seat,
    type: seat === 0 ? 'human' : 'bot',
    name: seat === 0 ? playerDisplayName() : `Компьютер ${seat}`,
    photoUrl: seat === 0 ? telegramPhotoUrl() : '',
    host: seat === 0,
    connected: seat === 0,
    userId: '',
  }));
}

function seats() {
  return roomSnapshot?.seats || defaultSeats();
}

function seatName(seat) {
  const record = seats()[seat];
  if (!record) return `Место ${seat + 1}`;
  if (seat === localSeat && record.type === 'human') return 'Вы';
  return record.name || (record.type === 'bot' ? `Компьютер ${seat}` : `Игрок ${seat + 1}`);
}

function render() {
  renderContract();
  renderScores();
  renderPlayers();
  renderTrick();
  renderHand();
  renderLobby();
  el.statusText.textContent = statusMessage || gameSnapshot?.message || '';
  if (el.hintButton) {
    el.hintButton.hidden = !gameSnapshot?.running;
    el.hintButton.disabled = !gameSnapshot?.legalCardIds?.length;
  }
}

function renderContract() {
  const contract = gameSnapshot?.contract;
  el.contractTitle.textContent = contract?.title || '—';
  el.contractDescription.textContent = contract?.description || 'Сначала соберите состав партии.';
  const round = Math.min((gameSnapshot?.round || 0) + 1, gameSnapshot?.totalRounds || 14);
  const total = gameSnapshot?.totalRounds || 14;
  el.roundLabel.textContent = `Раунд ${round}/${total}`;
  el.roundProgress.style.width = `${gameSnapshot ? (round / total) * 100 : 0}%`;
}

function renderScores() {
  const roomSeats = seats();
  const scores = gameSnapshot?.scores || [0, 0, 0, 0];
  const taken = gameSnapshot?.taken || [0, 0, 0, 0];
  el.scoreBoard.innerHTML = roomSeats.map((seat, index) => `
    <div class="score ${gameSnapshot?.running && gameSnapshot.turn === index ? 'active' : ''}">
      ${avatarHtml(index + selectedCharacter, 'score-avatar', seat.photoUrl)}
      <span>${escapeHtml(index === localSeat && seat.type === 'human' ? 'Вы' : seat.name)}</span>
      <strong>${scores[index] || 0}</strong>
      <small>${seat.type === 'bot' ? 'Бот' : (index === localSeat ? 'Вы' : 'Сеть')} · Взяток: ${taken[index] || 0}</small>
    </div>
  `).join('');
}

function renderPlayers() {
  const counts = gameSnapshot?.handCounts || [0, 0, 0, 0];
  el.players.innerHTML = seats().map((seat, index) => `
    <div class="player player-${index} ${gameSnapshot?.running && gameSnapshot.turn === index ? 'active' : ''}">
      ${avatarHtml(index + selectedCharacter, 'mini-avatar', seat.photoUrl)}
      <span>${escapeHtml(index === localSeat && seat.type === 'human' ? 'Вы' : seat.name)}</span>
      <b>${counts[index] || 0}</b>
    </div>
  `).join('');
}

function renderTrick() {
  const trick = gameSnapshot?.currentTrick?.length
    ? gameSnapshot.currentTrick
    : gameSnapshot?.lastTrick || [];
  el.trickArea.innerHTML = trick.map(play => cardHtml(
    play.card,
    `played-card seat-${play.player}`,
    seatName(play.player),
    '',
  )).join('');
}

function renderHand() {
  const legal = new Set(gameSnapshot?.legalCardIds || []);
  const hand = gameSnapshot?.hand || [];
  el.hand.innerHTML = hand.map(card => {
    const disabled = awaitingMove || !gameSnapshot?.running || gameSnapshot.turn !== localSeat || !legal.has(card.id);
    return cardHtml(
      card,
      `hand-card ${disabled ? 'disabled' : ''}`,
      '',
      disabled ? '' : `data-card-id="${escapeHtml(card.id)}"`,
    );
  }).join('');
}

function cardHtml(card, className, label = '', attrs = '') {
  return `<button class="card ${className} ${card.suit.color}" data-corner="${card.rank.id}${card.suit.symbol}" ${attrs} type="button" aria-label="${escapeHtml(label)} ${card.rank.id}${card.suit.symbol}">
    <span>${card.rank.id}</span><strong>${card.suit.symbol}</strong>
  </button>`;
}

function renderLobby() {
  const configError = networkConfigError();
  const roomSeats = seats();
  const humans = roomSeats.filter(seat => seat.type === 'human').length;
  el.invitePreview.textContent = configError || `Игроков: ${humans}/4. Остальные места будут компьютерами.`;
  el.lobbyPlayers.innerHTML = roomSeats.map(lobbySeatHtml).join('');
  el.startNetworkButton.hidden = networkRole !== 'host';
  el.startNetworkButton.disabled = Boolean(configError) || networkCreating || networkRole !== 'host' || roomSnapshot?.status === 'playing';
}

function lobbySeatHtml(seat) {
  const title = `Место ${seat.seat + 1}`;
  const label = seat.type === 'pending'
    ? 'Ожидаем друга'
    : seat.type === 'bot'
      ? `Компьютер ${seat.seat}`
      : seat.seat === localSeat
        ? 'Вы'
        : seat.name;
  const status = seat.type === 'human'
    ? seat.host ? 'Хост' : seat.connected ? 'Подключён' : 'Отключён'
    : seat.type === 'pending' ? 'Ожидаем друга' : 'Компьютер';
  const action = networkRole === 'host' && seat.seat > 0 && seat.type === 'bot'
    ? `<button class="secondary-button seat-action" type="button" data-invite-seat="${seat.seat}">Пригласить друга</button>`
    : networkRole === 'host' && seat.seat > 0 && seat.type === 'pending'
      ? `<button class="secondary-button seat-action" type="button" data-cancel-seat="${seat.seat}">Отменить</button>`
      : '';
  return `<div class="lobby-player lobby-seat ${seat.type}">
    ${avatarHtml(seat.seat + selectedCharacter, 'mini-avatar', seat.photoUrl)}
    <span><b>${title}</b>: ${escapeHtml(label)}<small>${status}</small></span>${action}
  </div>`;
}

async function ensureNetworkHost() {
  if (networkClient) {
    await networkClient.ready();
    return networkClient.room;
  }
  const configError = networkConfigError();
  if (configError) throw new Error(configError);

  networkRole = 'host';
  const response = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: tg?.initData || '' }),
  });
  if (!response.ok) {
    throw new Error(`Не удалось создать комнату: HTTP ${response.status} ${await response.text()}`);
  }
  const body = await response.json();
  if (!body.roomId) throw new Error('Сервер не вернул roomId.');

  networkClient = createNetworkClient(body.roomId, 0);
  await networkClient.ready();
  return body.roomId;
}

function createNetworkClient(room, preferredSeat) {
  const client = new WorkerRoomClient(room, preferredSeat);
  client.onWelcome = message => {
    localSeat = message.seat;
    networkRole = message.isHost ? 'host' : 'guest';
    statusMessage = message.isHost ? 'Комната создана.' : 'Вы подключились к общей партии.';
    render();
  };
  client.onRoom = snapshot => {
    roomSnapshot = snapshot;
    render();
  };
  client.onGame = snapshot => {
    gameSnapshot = snapshot;
    awaitingMove = false;
    statusMessage = snapshot.message || '';
    if (el.networkDialog?.open) el.networkDialog.close();
    render();
  };
  client.onError = error => {
    awaitingMove = false;
    statusMessage = error;
    render();
  };
  client.onClose = () => {
    statusMessage = 'Соединение потеряно. Пытаемся подключиться снова…';
    render();
  };
  client.connect();
  return client;
}

async function openNetworkLobby(event) {
  event?.preventDefault?.();
  if (!el.networkDialog.open) el.networkDialog.showModal();
  if (isInviteGuest) return;

  networkCreating = true;
  render();
  try {
    await ensureNetworkHost();
  } catch (error) {
    statusMessage = error.message;
  } finally {
    networkCreating = false;
    render();
  }
}

async function inviteFriend(seat) {
  networkCreating = true;
  render();
  try {
    const roomId = await ensureNetworkHost();
    networkClient.reserveSeat(seat);
    const inviteUrl = `https://t.me/${BOT_USERNAME}/${APP_NAME}?startapp=room_${roomId}_seat_${seat + 1}`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent('Присоединяйся к моей игре в Кинг')}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
    else window.open(shareUrl, '_blank', 'noopener,noreferrer');
  } catch (error) {
    statusMessage = error.message;
  } finally {
    networkCreating = false;
    render();
  }
}

function startNetworkGame(event) {
  event?.preventDefault();
  if (!networkClient) {
    statusMessage = 'Сначала создайте комнату.';
    render();
    return;
  }
  statusMessage = 'Сервер раздаёт карты…';
  networkClient.startGame();
  render();
}

function playSelectedCard(cardId) {
  if (!networkClient || !gameSnapshot?.running || gameSnapshot.turn !== localSeat) return;
  if (!gameSnapshot.legalCardIds.includes(cardId)) return;
  awaitingMove = true;
  statusMessage = 'Ход отправлен на сервер…';
  networkClient.playCard(cardId);
  render();
}

function connectGuest() {
  const configError = networkConfigError();
  if (configError) {
    statusMessage = configError;
    render();
    return;
  }
  networkRole = 'guest';
  el.newGameButton.disabled = true;
  networkClient = createNetworkClient(pendingInvite.room, pendingInvite.seat);
  statusMessage = 'Подключаемся к общей партии…';
  if (!el.networkDialog.open) el.networkDialog.showModal();
  render();
}

class WorkerRoomClient {
  constructor(room, seat = 0) {
    this.room = room;
    this.seat = seat;
    this.ws = null;
    this.queue = [];
    this.manualClose = false;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.onWelcome = () => {};
    this.onRoom = () => {};
    this.onGame = () => {};
    this.onError = () => {};
    this.onClose = () => {};
  }

  ready() {
    return this.readyPromise;
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = new URL(`${protocol}//${window.location.host}/api/rooms/${this.room}/ws`);
    if (this.seat) url.searchParams.set('seat', String(this.seat));
    if (tg?.initData) url.searchParams.set('initData', tg.initData);
    if (DEV_AUTH_ENABLED && !tg?.initData) {
      url.searchParams.set('dev', '1');
      url.searchParams.set('devUser', getDevUserId());
      url.searchParams.set('devName', playerDisplayName());
    }

    this.ws = new WebSocket(url);
    this.ws.addEventListener('open', () => {
      while (this.queue.length) this.ws.send(JSON.stringify(this.queue.shift()));
    });
    this.ws.addEventListener('message', event => this.handleMessage(event.data));
    this.ws.addEventListener('error', () => {
      this.rejectReady?.(new Error('Не удалось открыть WebSocket.'));
    });
    this.ws.addEventListener('close', () => {
      this.onClose();
      if (!this.manualClose) window.setTimeout(() => this.connect(), 1500);
    });
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.type === 'welcome') {
      this.seat = message.seat;
      this.resolveReady?.(message);
      this.resolveReady = null;
      this.rejectReady = null;
      this.onWelcome(message);
      return;
    }
    if (message.type === 'roomState') this.onRoom(message.room);
    if (message.type === 'gameState') this.onGame(message.game);
    if (message.type === 'error') this.onError(message.error || 'Ошибка сервера.');
  }

  send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
    else this.queue.push(payload);
  }

  reserveSeat(seat) { this.send({ type: 'reserveSeat', seat }); }
  cancelSeat(seat) { this.send({ type: 'cancelSeat', seat }); }
  startGame() { this.send({ type: 'startGame' }); }
  playCard(cardId) { this.send({ type: 'playCard', cardId }); }
  requestState() { this.send({ type: 'requestState' }); }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

el.hand.addEventListener('click', event => {
  const card = event.target.closest('[data-card-id]');
  if (card) playSelectedCard(card.dataset.cardId);
});
el.newGameButton.addEventListener('click', openNetworkLobby);
el.startNetworkButton.addEventListener('click', startNetworkGame);
el.lobbyPlayers.addEventListener('click', event => {
  const invite = event.target.closest('[data-invite-seat]');
  const cancel = event.target.closest('[data-cancel-seat]');
  if (invite) inviteFriend(Number(invite.dataset.inviteSeat));
  if (cancel) networkClient?.cancelSeat(Number(cancel.dataset.cancelSeat));
});
el.hintButton.addEventListener('click', () => {
  const cardId = gameSnapshot?.legalCardIds?.[0];
  const card = gameSnapshot?.hand?.find(item => item.id === cardId);
  if (card) {
    statusMessage = `Подсказка: можно сыграть ${card.rank.id}${card.suit.symbol}.`;
    render();
  }
});
el.rulesButton.addEventListener('click', () => el.rulesDialog.showModal());
el.portraitButton.addEventListener('click', () => el.portraitDialog.showModal());
el.portraitGrid.addEventListener('click', event => {
  const choice = event.target.closest('[data-character-id]');
  if (!choice) return;
  selectedCharacter = Number(choice.dataset.characterId);
  renderPortraitPicker();
  render();
});
el.networkButton?.addEventListener('click', openNetworkLobby);
el.networkGameButton?.addEventListener('click', openNetworkLobby);

renderPortraitPicker();
initTelegram();
render();
if (isInviteGuest) connectGuest();
