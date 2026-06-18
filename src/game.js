import { TELEGRAM_CONFIG } from './config.js';

const tg = window.Telegram?.WebApp;
const TELEGRAM_BOT_USERNAME = TELEGRAM_CONFIG.botUsername;
const TELEGRAM_APP_NAME = TELEGRAM_CONFIG.appName;

const SUITS = [
  { id: 'clubs', symbol: '♣', name: 'трефы', color: 'black' },
  { id: 'diamonds', symbol: '♦', name: 'бубны', color: 'red' },
  { id: 'spades', symbol: '♠', name: 'пики', color: 'black' },
  { id: 'hearts', symbol: '♥', name: 'червы', color: 'red' },
];
const RANKS = [
  { id: '7', value: 7 }, { id: '8', value: 8 }, { id: '9', value: 9 }, { id: '10', value: 10 },
  { id: 'J', value: 11 }, { id: 'Q', value: 12 }, { id: 'K', value: 13 }, { id: 'A', value: 14 },
];

const CHARACTERS = [
  { id: 'raccoon', name: 'Енот Шнырь', emoji: '🦝', bg: '#375a7f' },
  { id: 'fox', name: 'Лиса Пикс', emoji: '🦊', bg: '#b85b20' },
  { id: 'owl', name: 'Сова 404', emoji: '🦉', bg: '#594a7d' },
  { id: 'baron', name: 'Барон Ус', emoji: '🧐', bg: '#6f3d2e' },
  { id: 'frog', name: 'Жаба Босс', emoji: '🐸', bg: '#3f7d36' },
  { id: 'cat', name: 'Кот Карман', emoji: '😼', bg: '#7c4f8f' },
  { id: 'robot', name: 'Робо-Крендель', emoji: '🤖', bg: '#4c6a78' },
  { id: 'wizard', name: 'Маг Пыль', emoji: '🧙', bg: '#233b8f' },
  { id: 'princess', name: 'Принцесса Вау', emoji: '👸', bg: '#b13b82' },
  { id: 'beauty', name: 'Красотка Неон', emoji: '💃', bg: '#a8325f' },
  { id: 'mermaid', name: 'Русалка Байт', emoji: '🧜‍♀️', bg: '#167d8f' },
  { id: 'vampire', name: 'Вампирчик', emoji: '🧛', bg: '#4b224f' },
  { id: 'alien', name: 'Инопуз', emoji: '👽', bg: '#2c7a54' },
  { id: 'panda', name: 'Панда Паника', emoji: '🐼', bg: '#56606a' },
  { id: 'unicorn', name: 'Единорог Глитч', emoji: '🦄', bg: '#8d4fb3' },
  { id: 'chicken', name: 'Курица Крит', emoji: '🐔', bg: '#9f6b24' },
];

let selectedCharacter = 0;
let playerCharacters = [0, 1, 2, 3];
let playerNames = ['Вы', 'Лиса Пикс', 'Барон Ус', 'Сова 404'];
let playerTypes = ['local', 'bot', 'bot', 'bot'];
let generatedInviteSeats = [];
let initialGameStarted = false;
let localSeat = 0;
let networkClient = null;
let networkRole = 'host';
const urlParams = new URLSearchParams(window.location.search);
const telegramStartParam = tg?.initDataUnsafe?.start_param || urlParams.get('tgWebAppStartParam') || '';
const telegramRoomInvite = telegramStartParam.startsWith('room_') ? telegramStartParam.slice('room_'.length) : '';
const browserInviteSeat = Number(urlParams.get('king_seat') || 0);
const pendingInvite = {
  room: telegramRoomInvite || urlParams.get('king_room'),
  seat: browserInviteSeat >= 1 && browserInviteSeat <= 3 ? browserInviteSeat : 0,
};
const isInviteGuest = Boolean(pendingInvite.room);
const CONTRACT_TYPES = [
  {
    id: 'tricks',
    title: 'Не брать взятки',
    positiveTitle: 'Брать взятки',
    description: 'Каждая взятка: −20 очков.',
    positiveDescription: 'Каждая взятка: +20 очков.',
    points: trick => (trick ? 20 : 0),
  },
  {
    id: 'hearts',
    title: 'Не брать червей',
    positiveTitle: 'Брать червей',
    description: 'Каждая черва во взятке: −20 очков. Нельзя начинать с червей, пока есть другие масти.',
    positiveDescription: 'Каждая черва во взятке: +20 очков. Нельзя начинать с червей, пока есть другие масти.',
    points: trick => 20 * trick.filter(card => card.suit.id === 'hearts').length,
    restrictHeartLead: true,
  },
  {
    id: 'boys',
    title: 'Не брать мальчиков',
    positiveTitle: 'Брать мальчиков',
    description: 'Каждый король и валет: −20 очков.',
    positiveDescription: 'Каждый король и валет: +20 очков.',
    points: trick => 20 * trick.filter(card => ['K', 'J'].includes(card.rank.id)).length,
  },
  {
    id: 'girls',
    title: 'Не брать девочек',
    positiveTitle: 'Брать девочек',
    description: 'Каждая дама: −40 очков.',
    positiveDescription: 'Каждая дама: +40 очков.',
    points: trick => 40 * trick.filter(card => card.rank.id === 'Q').length,
  },
  {
    id: 'last-two',
    title: 'Не брать две последние взятки',
    positiveTitle: 'Брать две последние взятки',
    description: 'Седьмая и восьмая взятки: −80 очков каждая.',
    positiveDescription: 'Седьмая и восьмая взятки: +80 очков каждая.',
    points: (_trick, trickNumber) => (trickNumber >= 7 ? 80 : 0),
  },
  {
    id: 'king',
    title: 'Не брать Кинга',
    positiveTitle: 'Брать Кинга',
    description: 'Король червей: −160 очков. Нельзя начинать с червей, пока есть другие масти.',
    positiveDescription: 'Король червей: +160 очков. Нельзя начинать с червей, пока есть другие масти.',
    points: trick => trick.some(card => card.rank.id === 'K' && card.suit.id === 'hearts') ? 160 : 0,
    restrictHeartLead: true,
  },
  {
    id: 'mishmash',
    title: 'Ералаш: не брать ничего',
    positiveTitle: 'Ералаш: брать всё',
    description: 'Суммируются штрафы за взятки, червей, мальчиков, девочек, две последние взятки и Кинга.',
    positiveDescription: 'Суммируются плюсы за взятки, червей, мальчиков, девочек, две последние взятки и Кинга.',
    points: (trick, trickNumber) => CONTRACT_TYPES.slice(0, 6).reduce((sum, contract) => sum + contract.points(trick, trickNumber), 0),
    restrictHeartLead: true,
  },
];

const CONTRACTS = [
  ...CONTRACT_TYPES.map(contract => ({
    ...contract,
    phase: 'penalty',
    score: (trick, trickNumber) => -contract.points(trick, trickNumber),
  })),
  ...CONTRACT_TYPES.map(contract => ({
    ...contract,
    phase: 'positive',
    title: contract.positiveTitle,
    description: contract.positiveDescription,
    score: (trick, trickNumber) => contract.points(trick, trickNumber),
  })),
];

const state = {
  round: 0,
  leader: 0,
  turn: 0,
  hands: [],
  scores: [0, 0, 0, 0],
  taken: [0, 0, 0, 0],
  trickNumber: 1,
  currentTrick: [],
  running: false,
  message: '',
};

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
  inviteLink: document.querySelector('#inviteLink'),
  copyInviteButton: document.querySelector('#copyInviteButton'),
  shareInviteButton: document.querySelector('#shareInviteButton'),
  startNetworkButton: document.querySelector('#startNetworkButton'),
};


function setupPlayers(mode = 'solo') {
  const pool = CHARACTERS.map((_, index) => index).filter(index => index !== selectedCharacter);
  const bots = shuffle(pool).slice(0, 3);
  playerCharacters = [selectedCharacter, ...bots];

  if (mode !== 'network') {
    playerNames = ['Вы', ...bots.map(index => CHARACTERS[index].name)];
    playerTypes = ['local', 'bot', 'bot', 'bot'];
    generatedInviteSeats = [];
    localSeat = 0;
    networkRole = 'host';
    return;
  }

  playerNames = ['Вы', ...[1, 2, 3].map(index => generatedInviteSeats.includes(index) ? `Игрок ${index} (сеть)` : CHARACTERS[bots[index - 1]].name)];
  playerTypes = ['local', ...[1, 2, 3].map(index => generatedInviteSeats.includes(index) ? 'remote' : 'bot')];
}

function setupGuestPlayers(seat, snapshot = null) {
  localSeat = seat;
  networkRole = 'guest';
  if (snapshot) {
    applySnapshot(snapshot);
    return;
  }
  playerNames = [1, 2, 3, 4].map((_, index) => index === seat ? 'Вы' : index === 0 ? 'Хозяин' : `Игрок ${index}`);
  playerTypes = [0, 1, 2, 3].map(index => index === seat ? 'local' : 'remote');
}

function avatarHtml(index, extraClass = '') {
  const character = CHARACTERS[index] || CHARACTERS[0];
  return `<span class="avatar ${extraClass}" style="--avatar-bg:${character.bg}" title="${character.name}" aria-hidden="true"><span>${character.emoji}</span></span>`;
}

function renderPortraitPicker() {
  el.portraitGrid.innerHTML = CHARACTERS.map((character, index) => `
    <button class="portrait-choice ${index === selectedCharacter ? 'selected' : ''}" type="button" data-character-id="${index}" style="--avatar-bg:${character.bg}">
      ${avatarHtml(index, 'portrait-avatar')}
      <span>${character.name}</span>
    </button>`).join('');
}

function selectPortrait(index) {
  selectedCharacter = index;
  renderPortraitPicker();
  setupPlayers();
  render();
}

function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  document.documentElement.style.setProperty('--tg-bg', tg.themeParams.bg_color || '#101827');
  document.documentElement.style.setProperty('--tg-text', tg.themeParams.text_color || '#f8fafc');
  tg.MainButton.setText('Новая партия');
  tg.MainButton.onClick(startGame);
  tg.MainButton.show();
}

function createDeck() {
  return SUITS.flatMap(suit => RANKS.map(rank => ({ suit, rank, id: `${rank.id}-${suit.id}` })));
}

function shuffle(cards) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function startGame(options = {}) {
  state.round = 0;
  state.scores = [0, 0, 0, 0];
  state.leader = 0;
  setupPlayers(options.mode === 'network' ? 'network' : 'solo');
  if (options.mode === 'network') ensureNetworkHost();
  state.running = true;
  startRound();
  tg?.HapticFeedback?.impactOccurred('medium');
}

function startRound() {
  const deck = shuffle(createDeck());
  state.hands = [0, 1, 2, 3].map(index => sortHand(deck.slice(index * 8, index * 8 + 8)));
  state.taken = [0, 0, 0, 0];
  state.trickNumber = 1;
  state.currentTrick = [];
  state.turn = state.leader;
  state.message = `${playerNames[state.turn]} начинает контракт.`;
  render();
  maybeBotTurn();
}

function sortHand(hand) {
  return [...hand].sort((a, b) => SUITS.findIndex(s => s.id === a.suit.id) - SUITS.findIndex(s => s.id === b.suit.id) || a.rank.value - b.rank.value);
}

function legalCards(player) {
  const hand = state.hands[player];
  const leadSuit = state.currentTrick[0]?.card.suit.id;
  if (!leadSuit) {
    const contract = CONTRACTS[state.round];
    if (!contract?.restrictHeartLead) return hand;
    const nonHearts = hand.filter(card => card.suit.id !== 'hearts');
    return nonHearts.length ? nonHearts : hand;
  }
  const sameSuit = hand.filter(card => card.suit.id === leadSuit);
  return sameSuit.length ? sameSuit : hand;
}

function playCard(player, cardId) {
  if (networkRole === 'guest') {
    if (!state.running || state.turn !== localSeat || player !== localSeat) return;
    networkClient?.send({ type: 'play', seat: localSeat, cardId });
    state.message = 'Ход отправлен хозяину партии…';
    render();
    return;
  }
  if (!state.running || state.turn !== player) return;
  const legal = legalCards(player);
  if (!legal.some(card => card.id === cardId)) {
    state.message = state.currentTrick.length === 0
      ? 'В этом контракте нельзя начинать с червей, пока есть другие масти.'
      : 'Нужно ходить в масть, если она есть.';
    render();
    tg?.HapticFeedback?.notificationOccurred('error');
    return;
  }
  const card = state.hands[player].find(item => item.id === cardId);
  state.hands[player] = state.hands[player].filter(item => item.id !== cardId);
  state.currentTrick.push({ player, card });
  state.turn = (player + 1) % 4;
  state.message = `${playerNames[player]} сыграл ${formatCard(card)}.`;
  render();
  if (state.currentTrick.length === 4) window.setTimeout(resolveTrick, 650);
  else maybeBotTurn();
}

function chooseBotCard(player) {
  const legal = legalCards(player);
  const contract = CONTRACTS[state.round];
  const leadSuit = state.currentTrick[0]?.card.suit.id;
  const risky = card => Math.abs(contract.score([card], state.trickNumber));
  if (!leadSuit) return [...legal].sort((a, b) => risky(a) - risky(b) || a.rank.value - b.rank.value)[0];
  const winningValue = Math.max(...state.currentTrick.filter(t => t.card.suit.id === leadSuit).map(t => t.card.rank.value));
  const safe = legal.filter(card => card.suit.id !== leadSuit || card.rank.value < winningValue);
  return [...(safe.length ? safe : legal)].sort((a, b) => risky(b) - risky(a) || a.rank.value - b.rank.value)[0];
}

function maybeBotTurn() {
  if (!state.running || playerTypes[state.turn] !== 'bot') return;
  const delay = playerTypes[state.turn] === 'remote' ? 900 : 550;
  window.setTimeout(() => playCard(state.turn, chooseBotCard(state.turn).id), delay);
}

function resolveTrick() {
  const leadSuit = state.currentTrick[0].card.suit.id;
  const winnerPlay = state.currentTrick
    .filter(play => play.card.suit.id === leadSuit)
    .sort((a, b) => b.card.rank.value - a.card.rank.value)[0];
  const winner = winnerPlay.player;
  const trickCards = state.currentTrick.map(play => play.card);
  const delta = CONTRACTS[state.round].score(trickCards, state.trickNumber);
  state.scores[winner] += delta;
  state.taken[winner] += 1;
  state.leader = winner;
  state.turn = winner;
  state.currentTrick = [];
  state.message = `${playerNames[winner]} забирает взятку ${state.trickNumber} (${delta > 0 ? '+' : ''}${delta}).`;
  state.trickNumber += 1;
  if (state.hands.every(hand => hand.length === 0)) {
    state.round += 1;
    if (state.round >= CONTRACTS.length) finishGame();
    else window.setTimeout(startRound, 1100);
  } else {
    render();
    maybeBotTurn();
  }
}

function finishGame() {
  state.running = false;
  const best = Math.max(...state.scores);
  const winners = playerNames.filter((_, index) => state.scores[index] === best).join(', ');
  state.message = `Партия окончена. Победитель: ${winners}!`;
  tg?.HapticFeedback?.notificationOccurred(state.scores[0] === best ? 'success' : 'warning');
  render();
}

function formatCard(card) {
  return `${card.rank.id}${card.suit.symbol}`;
}

function makeRoomId() {
  return (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`).replaceAll('-', '').slice(0, 16);
}

function inviteSeat() {
  return [1, 2, 3].find(seat => !generatedInviteSeats.includes(seat));
}

function inviteConfigError() {
  if (!TELEGRAM_BOT_USERNAME) return 'Не задано имя Telegram-бота в конфиге.';
  if (!TELEGRAM_APP_NAME) return 'Не задано имя Telegram Mini App в конфиге.';
  return '';
}

function buildInviteLink() {
  const configError = inviteConfigError();
  if (configError) throw new Error(configError);
  const room = networkClient?.room || ensureNetworkHost();
  const link = new URL(`https://t.me/${TELEGRAM_BOT_USERNAME}/${TELEGRAM_APP_NAME}`);
  link.searchParams.set('startapp', `room_${room}`);
  return link.toString();
}

function updateInvitePreview(link = '') {
  const configError = inviteConfigError();
  const nextSeat = inviteSeat();
  const connected = generatedInviteSeats.length;
  el.invitePreview.textContent = configError || (nextSeat
    ? `Подключено игроков: ${connected}/3. Ссылка подключит следующего игрока на место ${nextSeat}.`
    : 'Все три бота заменены приглашенными игроками. Можно начинать сетевую партию.');
  if (el.inviteLink) el.inviteLink.value = configError ? '' : link;
  if (el.shareInviteButton) el.shareInviteButton.disabled = Boolean(configError) || !nextSeat;
  if (el.copyInviteButton) el.copyInviteButton.disabled = Boolean(configError) || !link;
}

function copyInvite() {
  const link = el.inviteLink?.value;
  if (!link) return;
  navigator.clipboard?.writeText(link);
  state.message = 'Ссылка скопирована. Отправьте ее игроку.';
  render();
}

function shareInvite() {
  const seat = inviteSeat();
  if (!seat) return updateInvitePreview();
  let link;
  try {
    link = buildInviteLink();
  } catch (error) {
    state.message = error.message;
    updateInvitePreview();
    render();
    return;
  }
  updateInvitePreview(link);
  const text = `Присоединяйся к сетевой партии в Кинг: ${link}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Присоединяйся к сетевой партии в Кинг')}`);
  else if (navigator.share) navigator.share({ title: 'Кинг', text, url: link }).catch(() => {});
  else navigator.clipboard?.writeText(text);
  render();
  broadcastSnapshot();
}

function startNetworkGame() {
  ensureNetworkHost();
  startGame({ mode: 'network' });
}

function ensureNetworkHost() {
  if (networkClient) return networkClient.room;
  networkRole = 'host';
  networkClient = new RelayClient(makeRoomId());
  networkClient.onMessage = message => {
    if (message.type === 'join') {
      const requestedSeat = message.seat >= 1 && message.seat <= 3 ? message.seat : 0;
      const seat = requestedSeat || inviteSeat();
      if (!seat) return;
      if (!generatedInviteSeats.includes(seat)) generatedInviteSeats.push(seat);
      playerTypes[seat] = 'remote';
      playerNames[seat] = `Игрок ${seat} (сеть)`;
      state.message = `${playerNames[seat]} подключился.`;
      render();
      networkClient?.send({ type: 'welcome', targetClientId: message.guestId, seat, snapshot: snapshot() });
      broadcastSnapshot();
    }
    if (message.type === 'play' && playerTypes[message.seat] === 'remote') playCard(message.seat, message.cardId);
  };
  networkClient.connect();
  return networkClient.room;
}

function snapshot() {
  return { playerCharacters, playerNames, playerTypes, state: JSON.parse(JSON.stringify(state)) };
}

function applySnapshot(data) {
  playerCharacters = data.playerCharacters;
  playerNames = data.playerNames.map((name, index) => index === localSeat ? 'Вы' : name);
  playerTypes = data.playerTypes.map((type, index) => index === localSeat ? 'local' : type);
  Object.assign(state, data.state);
  render();
}

function broadcastSnapshot() {
  if (networkRole === 'host') networkClient?.send({ type: 'snapshot', snapshot: snapshot() });
}

function connectGuest() {
  el.newGameButton.disabled = true;
  el.networkButton.disabled = true;
  el.networkGameButton.disabled = true;
  networkClient = new RelayClient(pendingInvite.room);
  networkClient.onMessage = message => {
    if (message.type === 'welcome' && (!message.targetClientId || message.targetClientId === networkClient.clientId)) {
      setupGuestPlayers(message.seat, message.snapshot);
    }
    if (message.type === 'snapshot' && localSeat) applySnapshot(message.snapshot);
  };
  networkClient.connect();
  if (pendingInvite.seat) setupGuestPlayers(pendingInvite.seat);
  networkClient.send({ type: 'join', seat: pendingInvite.seat, guestId: networkClient.clientId });
  state.message = 'Подключаемся к сетевой партии…';
  render();
}

class RelayClient {
  constructor(room) {
    this.room = room;
    this.clientId = makeRoomId();
    this.onMessage = () => {};
  }

  connect() {
    this.events?.close();
    this.events = new EventSource(`/api/rooms/${encodeURIComponent(this.room)}/events?client=${encodeURIComponent(this.clientId)}`);
    this.events.addEventListener('message', event => {
      const envelope = JSON.parse(event.data);
      if (envelope.clientId !== this.clientId) this.onMessage(envelope.payload);
    });
    this.events.addEventListener('error', () => {
      state.message = 'Нет соединения с сетевым сервером. Запустите игру через node server.mjs.';
      render();
    });
  }

  send(payload) {
    return fetch(`/api/rooms/${encodeURIComponent(this.room)}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: this.clientId, payload }),
    }).catch(() => {
      state.message = 'Не удалось отправить сетевое сообщение.';
      render();
    });
  }
}


function hint() {
  if (!state.running || state.turn !== localSeat) return;
  const card = chooseBotCard(localSeat);
  state.message = `Подсказка: можно сыграть ${formatCard(card)}.`;
  render();
}

function render() {
  const contract = CONTRACTS[Math.min(state.round, CONTRACTS.length - 1)];
  el.contractTitle.textContent = contract.title;
  el.contractDescription.textContent = contract.description;
  el.roundLabel.textContent = `Раунд ${Math.min(state.round + 1, CONTRACTS.length)}/${CONTRACTS.length}`;
  el.roundProgress.style.width = `${(Math.min(state.round + 1, CONTRACTS.length) / CONTRACTS.length) * 100}%`;
  el.statusText.textContent = state.message;
  renderScores();
  renderPlayers();
  renderTrick();
  renderHand();
  if (networkRole === 'host' && networkClient) window.clearTimeout(render._broadcastTimer), render._broadcastTimer = window.setTimeout(broadcastSnapshot, 0);
}

function renderScores() {
  el.scoreBoard.innerHTML = playerNames.map((name, index) => `
    <div class="score ${index === state.turn && state.running ? 'active' : ''}">
      ${avatarHtml(playerCharacters[index], 'score-avatar')}<span>${name}</span><strong>${state.scores[index]}</strong><small>${playerTypes[index] === 'remote' ? 'Сеть' : playerTypes[index] === 'bot' ? 'Бот' : 'Вы'} · Взяток: ${state.taken[index] || 0}</small>
    </div>`).join('');
}

function renderPlayers() {
  el.players.innerHTML = playerNames.map((name, index) => `
    <div class="player player-${index} ${index === state.turn && state.running ? 'active' : ''}">
      ${avatarHtml(playerCharacters[index], 'mini-avatar')}<span>${index === localSeat ? 'Вы' : name}</span><b>${state.hands[index]?.length || 0}</b>
    </div>`).join('');
}

function renderTrick() {
  el.trickArea.innerHTML = state.currentTrick.map(play => cardHtml(play.card, `played-card seat-${play.player}`, playerNames[play.player])).join('');
}

function renderHand() {
  const seat = localSeat;
  const legal = state.turn === seat ? new Set(legalCards(seat).map(card => card.id)) : new Set();
  el.hand.innerHTML = (state.hands[seat] || []).map(card => {
    const disabled = !state.running || state.turn !== seat || !legal.has(card.id);
    return cardHtml(card, `hand-card ${disabled ? 'disabled' : ''}`, '', disabled ? '' : `data-card-id="${card.id}"`);
  }).join('');
}

function cardHtml(card, className, label = '', attrs = '') {
  return `<button class="card ${className} ${card.suit.color}" data-corner="${card.rank.id}${card.suit.symbol}" ${attrs} type="button" aria-label="${label} ${formatCard(card)}">
    <span>${card.rank.id}</span><strong>${card.suit.symbol}</strong>
  </button>`;
}

el.hand.addEventListener('click', event => {
  const button = event.target.closest('[data-card-id]');
  if (button) playCard(localSeat, button.dataset.cardId);
});
el.newGameButton.addEventListener('click', startGame);
el.hintButton.addEventListener('click', hint);
el.networkButton.addEventListener('click', () => { updateInvitePreview(); el.networkDialog.showModal(); });
el.networkGameButton.addEventListener('click', () => { updateInvitePreview(); el.networkDialog.showModal(); });
el.copyInviteButton.addEventListener('click', copyInvite);
el.shareInviteButton.addEventListener('click', shareInvite);
el.startNetworkButton.addEventListener('click', startNetworkGame);
el.rulesButton.addEventListener('click', () => el.rulesDialog.showModal());
el.portraitButton.addEventListener('click', () => el.portraitDialog.showModal());
el.portraitGrid.addEventListener('click', event => {
  const button = event.target.closest('[data-character-id]');
  if (!button) return;
  selectPortrait(Number(button.dataset.characterId));
});
el.portraitDialog.addEventListener('close', () => {
  if (initialGameStarted) return;
  initialGameStarted = true;
  startGame();
});

renderPortraitPicker();
updateInvitePreview();
initTelegram();
if (isInviteGuest) {
  connectGuest();
} else {
  setupPlayers();
  render();
  el.portraitDialog.showModal();
}
