import {
  CHARACTERS,
  CONTRACTS,
  chooseAiCard,
  createDeck,
  createSeededRandom,
  dealHands,
  formatScore,
  legalCards,
  matchResult,
  scoreTrick,
  shuffleDeck,
  trickWinner,
  updateCardTapSelection,
} from './game-engine.js?v=native-7';
import {
  IndexedRenderer,
  loadKingAssets,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
} from './native-assets.js?v=native-7';

const tg = window.Telegram?.WebApp;

const el = {
  canvas: document.querySelector('#gameCanvas'),
  orientationHint: document.querySelector('#orientationHint'),
  loadingOverlay: document.querySelector('#loadingOverlay'),
  loadingText: document.querySelector('#loadingText'),
  loadingBar: document.querySelector('#loadingBar'),
  retryButton: document.querySelector('#retryButton'),
  startOverlay: document.querySelector('#startOverlay'),
  savedGameInfo: document.querySelector('#savedGameInfo'),
  continueButton: document.querySelector('#continueButton'),
  newGameButton: document.querySelector('#newGameButton'),
  restartButton: document.querySelector('#restartButton'),
  soundButton: document.querySelector('#soundButton'),
  rulesButton: document.querySelector('#rulesButton'),
  aboutButton: document.querySelector('#aboutButton'),
  rulesDialog: document.querySelector('#rulesDialog'),
  aboutDialog: document.querySelector('#aboutDialog'),
  aboutLink: document.querySelector('#aboutDialog a[href^="https://t.me/"]'),
  hint: document.querySelector('#gameHint'),
};

const PLAYER_SEAT = 0;
const CARD_WIDTH = 52;
const CARD_HEIGHT = 60;
const CARD_NORMAL_Y = 280;
const CARD_SELECTED_Y = 269;
const TAP_MOVE_LIMIT_CSS = 28;
const AI_THINK_MS = 950;
const CARD_REVEAL_MS = 620;
const TRICK_COLLECT_HOLD_MS = 650;
const CONTRACT_RESULT_MS = 2600;
const ORIENTATION_HINT_MS = 3200;
const SOUND_STORAGE_KEY = 'king-sound-enabled';
const SAVE_STORAGE_KEY = 'king-single-player-save';
const SAVE_VERSION = 1;
const TRICK_POSITIONS = [
  { x: 295, y: 182 },
  { x: 243, y: 151 },
  { x: 295, y: 120 },
  { x: 347, y: 151 },
];
const TRICK_STACK_STEPS = [
  { x: 3, y: -2 },
  { x: 4, y: 2 },
  { x: 3, y: 3 },
  { x: -4, y: 2 },
];
const PARTNER_DESCRIPTIONS = [
  ['ОН ИГРАЕТ', 'НЕПЛОХО'],
  ['ОНА ИГРАЕТ', 'ОТЛИЧНО'],
  ['ОН ВСЕГДА', 'МУХЛЮЕТ'],
];
const CARD_BY_ID = new Map(createDeck().map(card => [card.id, card]));
const requestedSpeed = Number(new URLSearchParams(location.search).get('speed'));
const TIME_SCALE = Number.isFinite(requestedSpeed) && requestedSpeed > 0
  ? Math.max(0.01, Math.min(4, requestedSpeed))
  : 1;

let renderer = null;
let screen = 'loading';
let selectedPartnerIds = [];
let game = null;
let selectedCardId = null;
let inputLocked = true;
let pointerStart = null;
let runToken = 0;
let paused = false;
let orientationHintTimer = null;
let landscapeFullscreenRequested = false;
let audioContext = null;
let audioMasterGain = null;
let soundEnabled = readSoundPreference();
const landscapeMedia = window.matchMedia?.('(orientation: landscape)') ?? null;
const coarsePointerMedia = window.matchMedia?.('(pointer: coarse)') ?? null;

function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.disableVerticalSwipes?.();
  tg.unlockOrientation?.();
  tg.setHeaderColor?.('#000000');
  tg.setBackgroundColor?.('#001600');
}

function isLandscapeViewport() {
  if (landscapeMedia) return landscapeMedia.matches;
  return Number(window.innerWidth) > Number(window.innerHeight);
}

function isMobileDevice() {
  if (tg?.platform === 'android' || tg?.platform === 'ios') return true;
  return Boolean(coarsePointerMedia?.matches || Number(navigator.maxTouchPoints) > 0);
}

function hideOrientationHint() {
  if (orientationHintTimer !== null) clearTimeout(orientationHintTimer);
  orientationHintTimer = null;
  el.orientationHint.classList.remove('is-visible');
  el.orientationHint.setAttribute('aria-hidden', 'true');
}

function showOrientationHintTemporarily() {
  hideOrientationHint();
  if (isLandscapeViewport()) return;
  el.orientationHint.classList.add('is-visible');
  el.orientationHint.setAttribute('aria-hidden', 'false');
  orientationHintTimer = setTimeout(hideOrientationHint, ORIENTATION_HINT_MS);
}

async function requestLandscapeFullscreen(fromUserGesture = false) {
  if (!isLandscapeViewport() || !isMobileDevice()) return;

  tg?.expand?.();
  const telegramCanFullscreen = Boolean(
    tg?.requestFullscreen
    && (!tg.isVersionAtLeast || tg.isVersionAtLeast('8.0')),
  );

  if (telegramCanFullscreen && !tg.isFullscreen && !landscapeFullscreenRequested) {
    landscapeFullscreenRequested = true;
    try {
      tg.requestFullscreen();
    } catch {
      landscapeFullscreenRequested = false;
    }
  }

  if (telegramCanFullscreen) return;

  if (!fromUserGesture || document.fullscreenElement) return;
  const target = document.documentElement;
  if (typeof target?.requestFullscreen !== 'function') return;
  try {
    await target.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    // A regular browser may reject fullscreen even after rotation. The next tap retries it.
  }
}

function handleOrientationChange() {
  if (isLandscapeViewport()) {
    hideOrientationHint();
    void requestLandscapeFullscreen();
    return;
  }

  landscapeFullscreenRequested = false;
  showOrientationHintTemporarily();
}

function initOrientationHandling() {
  landscapeMedia?.addEventListener?.('change', handleOrientationChange);
  window.addEventListener?.('orientationchange', handleOrientationChange);
  tg?.onEvent?.('fullscreenChanged', () => {
    landscapeFullscreenRequested = Boolean(tg.isFullscreen);
  });
  tg?.onEvent?.('fullscreenFailed', () => {
    landscapeFullscreenRequested = false;
  });
  handleOrientationChange();
}

function setHint(text) {
  el.hint.textContent = text;
}

function setLoadingBarState(state) {
  el.loadingBar.classList.remove('is-starting', 'is-complete');
  if (state) el.loadingBar.classList.add(state);
}

function showLoading() {
  screen = 'loading';
  inputLocked = true;
  el.startOverlay.hidden = true;
  el.loadingText.textContent = 'Загрузка';
  setLoadingBarState('is-starting');
  el.loadingOverlay.hidden = false;
  el.retryButton.hidden = true;
  setHint('Загрузка');
}

function showLoadError(error) {
  console.error(error);
  el.loadingText.textContent = 'Загрузка';
  setLoadingBarState('is-complete');
  el.retryButton.hidden = false;
  setHint('Не удалось загрузить игру. Нажмите «Повторить запуск».');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readSoundPreference() {
  try {
    return window.localStorage?.getItem(SOUND_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function saveSoundPreference() {
  try {
    window.localStorage?.setItem(SOUND_STORAGE_KEY, String(soundEnabled));
  } catch {
    // The game still works when Telegram or the browser blocks persistent storage.
  }
}

function syncSoundButton() {
  el.soundButton.textContent = soundEnabled ? 'Звук: вкл' : 'Звук: выкл';
  el.soundButton.setAttribute('aria-pressed', String(soundEnabled));
}

function removeSavedGame() {
  try {
    window.localStorage?.removeItem(SAVE_STORAGE_KEY);
  } catch {
    // A blocked storage API must not prevent starting a new game.
  }
}

function scoreArray(value) {
  return Array.isArray(value)
    && value.length === 4
    && value.every(score => Number.isFinite(score));
}

function loadSavedGame() {
  try {
    const raw = window.localStorage?.getItem(SAVE_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const partnerIds = saved.selectedPartnerIds;
    const validPartners = Array.isArray(partnerIds)
      && partnerIds.length === 3
      && new Set(partnerIds).size === 3
      && partnerIds.every(id => Number.isInteger(id) && CHARACTERS[id]);
    const validStatus = ['playing', 'trick-await', 'contract-result'].includes(saved.status);
    const validHands = Array.isArray(saved.hands)
      && saved.hands.length === 4
      && saved.hands.every(hand => Array.isArray(hand) && hand.length <= 8);
    const validTrick = Array.isArray(saved.trick)
      && saved.trick.length <= 4
      && saved.trick.every(entry => (
        Number.isInteger(entry?.seat)
        && entry.seat >= 0
        && entry.seat < 4
        && typeof entry.cardId === 'string'
      ));
    const validNumbers = Number.isInteger(saved.randomState)
      && saved.randomState > 0
      && Number.isInteger(saved.contractIndex)
      && saved.contractIndex >= 0
      && saved.contractIndex < CONTRACTS.length
      && Number.isInteger(saved.currentSeat)
      && saved.currentSeat >= 0
      && saved.currentSeat < 4
      && Number.isInteger(saved.trickNumber)
      && saved.trickNumber >= 0
      && saved.trickNumber <= 8;
    if (
      saved.version !== SAVE_VERSION
      || !validPartners
      || !validStatus
      || !validHands
      || !validTrick
      || !validNumbers
      || !scoreArray(saved.scores)
      || !scoreArray(saved.dealScores)
      || (saved.status === 'playing' && saved.trick.length >= 4)
      || (saved.status === 'trick-await' && saved.trick.length !== 4)
      || (saved.status === 'contract-result' && saved.trick.length !== 0)
    ) throw new Error('Invalid saved game');

    const usedCardIds = new Set();
    const restoreCard = cardId => {
      const card = CARD_BY_ID.get(cardId);
      if (!card || usedCardIds.has(cardId)) throw new Error('Invalid saved cards');
      usedCardIds.add(cardId);
      return card;
    };
    const hands = saved.hands.map(hand => hand.map(restoreCard));
    const trickSeats = new Set();
    const trick = saved.trick.map(entry => {
      if (trickSeats.has(entry.seat)) throw new Error('Invalid saved trick');
      trickSeats.add(entry.seat);
      return { seat: entry.seat, card: restoreCard(entry.cardId) };
    });
    const trickWinnerSeat = saved.trickWinnerSeat === null
      ? null
      : Number(saved.trickWinnerSeat);
    if (
      trickWinnerSeat !== null
      && (!Number.isInteger(trickWinnerSeat) || trickWinnerSeat < 0 || trickWinnerSeat > 3)
    ) throw new Error('Invalid saved trick winner');
    if (
      (saved.status === 'trick-await' && trickWinnerSeat !== saved.currentSeat)
      || (saved.status !== 'trick-await' && trickWinnerSeat !== null)
      || (saved.status === 'contract-result' && hands.some(hand => hand.length !== 0))
    ) throw new Error('Inconsistent saved state');

    return {
      selectedPartnerIds: [...partnerIds],
      randomState: saved.randomState,
      scores: [...saved.scores],
      dealScores: [...saved.dealScores],
      hands,
      trick,
      trickWinnerSeat,
      trickNumber: saved.trickNumber,
      currentSeat: saved.currentSeat,
      contractIndex: saved.contractIndex,
      status: saved.status,
      savedAt: Number(saved.savedAt) || 0,
    };
  } catch {
    removeSavedGame();
    return null;
  }
}

function saveCurrentGame() {
  if (
    screen !== 'table'
    || !game
    || !['playing', 'trick-await', 'contract-result'].includes(game.status)
  ) return;

  try {
    const payload = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      selectedPartnerIds: game.characters.map(character => character.id),
      randomState: game.random.getState(),
      scores: [...game.scores],
      dealScores: [...game.dealScores],
      hands: game.hands.map(hand => hand.map(card => card.id)),
      trick: game.trick.map(entry => ({ seat: entry.seat, cardId: entry.card.id })),
      trickWinnerSeat: game.trickWinnerSeat,
      trickNumber: game.trickNumber,
      currentSeat: game.currentSeat,
      contractIndex: game.contractIndex,
      status: game.status,
    };
    window.localStorage?.setItem(SAVE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Saving is best-effort when private mode or the host blocks localStorage.
  }
}

function prepareAudio(force = false) {
  if (!soundEnabled && !force) return null;
  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    if (!audioContext) audioContext = new AudioContextClass();
    if (!audioMasterGain) {
      audioMasterGain = audioContext.createGain();
      audioMasterGain.gain.setValueAtTime(soundEnabled ? 1 : 0, audioContext.currentTime);
      audioMasterGain.connect(audioContext.destination);
    }
    if (audioContext.state === 'suspended') {
      const resumePromise = audioContext.resume();
      resumePromise?.catch?.(() => {});
    }
    return audioContext;
  } catch {
    return null;
  }
}

function playSpeakerSequence(tones) {
  if (!soundEnabled) return;
  const context = prepareAudio();
  if (!context || context.state === 'closed') return;

  let startAt = context.currentTime;
  for (const tone of tones) {
    try {
      const duration = Math.max(0.012, tone.duration / 1000);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(tone.frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.linearRampToValueAtTime(tone.volume ?? 0.018, startAt + 0.004);
      gain.gain.setValueAtTime(tone.volume ?? 0.018, Math.max(startAt + 0.004, startAt + duration - 0.012));
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      oscillator.connect(gain);
      gain.connect(audioMasterGain ?? context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.004);
      startAt += duration + ((tone.gap ?? 0) / 1000);
    } catch {
      return;
    }
  }
}

function playSelectionSound() {
  playSpeakerSequence([{ frequency: 420, duration: 24, volume: 0.012 }]);
}

function playCardSound() {
  playSpeakerSequence([{ frequency: 520, duration: 34, volume: 0.014 }]);
}

function playTrickSound() {
  playSpeakerSequence([{ frequency: 100, duration: 100, volume: 0.012 }]);
}

async function holdForOnePaint(token) {
  const requestFrame = typeof window.requestAnimationFrame === 'function'
    ? callback => window.requestAnimationFrame(callback)
    : callback => setTimeout(callback, Math.max(1, 16 * TIME_SCALE));
  const nextFrame = () => new Promise(resolve => requestFrame(resolve));
  await nextFrame();
  if (token !== runToken) return false;
  await nextFrame();
  return token === runToken;
}

async function gameDelay(ms, token) {
  let remaining = ms * TIME_SCALE;
  let previous = performance.now();

  while (remaining > 0 && token === runToken) {
    await delay(Math.min(80, remaining));
    const now = performance.now();
    if (!paused) remaining -= now - previous;
    previous = now;
  }

  return token === runToken;
}

function drawSelectionBorder() {
  for (let x = 144; x <= 496; x += 16) {
    renderer.drawSprite(60, x, 0, 2);
    renderer.drawSprite(60, x, 326, 2);
  }
  for (let y = 0; y <= 325; y += 13) {
    renderer.drawSprite(60, 144, y, 2);
    renderer.drawSprite(60, 496, y, 2);
  }
}

function printCenteredShadowed(text, centerX, y, color = 15, glyphHeight = 8, spacing = 8) {
  const x = Math.round(centerX - renderer.textWidth(text, spacing) / 2);
  renderer.print(text, x + 1, y + 1, 0, glyphHeight, spacing);
  renderer.print(text, x, y, color, glyphHeight, spacing);
}

function drawSelectedPartner(character, order) {
  const column = character.id % 4;
  const row = Math.floor(character.id / 4);
  const x = 160 + column * 80;
  const y = 15 + row * 104;
  const description = PARTNER_DESCRIPTIONS[row];

  renderer.fillRect(x, y, 80, 96, 2);
  printCenteredShadowed(character.name, x + 40, y + 3, 14, 14, 6);
  printCenteredShadowed(`${order + 1}-й`, x + 40, y + 23, 14, 8, 6);
  printCenteredShadowed('ПАРТНЕР', x + 40, y + 38, 14, 8, 6);
  printCenteredShadowed(description[0], x + 40, y + 55, 14, 8, 6);
  printCenteredShadowed(description[1], x + 40, y + 70, 14, 8, 6);
}

function renderPartnerPicker() {
  renderer.clear(2);
  drawSelectionBorder();
  renderer.drawSprite(52, 160, 15);
  renderer.drawSprite(53, 160, 119);
  renderer.drawSprite(54, 160, 223);

  for (const character of CHARACTERS) {
    const column = character.id % 4;
    const row = Math.floor(character.id / 4);
    const selectedOrder = selectedPartnerIds.indexOf(character.id);
    if (selectedOrder >= 0) drawSelectedPartner(character, selectedOrder);
    else printCenteredShadowed(character.name, 200 + column * 80, 97 + row * 104, 15, 14, 7);
  }

  const prompt = selectedPartnerIds.length >= 3
    ? 'Партнёры выбраны...'
    : `Выберите ${selectedPartnerIds.length + 1}-го партнера...`;
  renderer.printCentered(prompt, 320, 333, 14, 14, 7);
  renderer.present();
}

function drawCharacter(character, x, y) {
  renderer.drawSpriteRegion(character.spriteId, character.cropX, 0, 80, 88, x, y, 2);
}

function drawBackFan(count, x, y, maxWidth = 136) {
  if (count <= 0) return;
  const step = count > 1 ? Math.max(7, Math.min(14, Math.floor((maxWidth - CARD_WIDTH) / (count - 1)))) : 0;
  for (let index = 0; index < count; index += 1) renderer.drawSprite(49, x + step * index, y);
}

function drawOpponentSeat(seat, character, x, y, backsX, backsY) {
  drawCharacter(character, x, y);
  printCenteredShadowed(character.name, x + 40, y + 74, 15, 14, 7);
  drawBackFan(game.hands[seat].length, backsX, backsY);
}

function drawTableSurface() {
  renderer.fillRect(186, 115, 267, 131, 2);
  renderer.strokeRect(186, 115, 267, 131, 0, 2);
  renderer.fillRect(188, 117, 263, 1, 9);
  renderer.drawSprite(60, 188, 118, 2);
  renderer.drawSprite(60, 431, 118, 2);
}

function drawContractPanel() {
  const contract = CONTRACTS[game.contractIndex];
  renderer.fillRect(12, 253, 121, 59, 2);
  renderer.strokeRect(12, 253, 121, 59, 0, 2);
  renderer.printCentered(contract.titleLines[0], 72, 257, 15, 14, 8);
  renderer.printCentered(contract.titleLines[1], 72, 274, 15, 14, 8);
  renderer.printCentered(contract.titleLines[2], 72, 291, contract.direction > 0 ? 10 : 11, 14, 8);
}

function drawScoreBox() {
  renderer.fillRect(519, 253, 98, 72, 2);
  renderer.strokeRect(519, 253, 98, 72, 0, 2);
  renderer.fillRect(551, 254, 1, 70, 0);
  renderer.fillRect(584, 254, 1, 70, 0);
  renderer.fillRect(520, 277, 96, 1, 0);
  renderer.fillRect(520, 301, 96, 1, 0);
  renderer.drawSprite(61, 521, 255, 2);
  renderer.drawSprite(61, 598, 255, 2);
  renderer.drawSprite(61, 521, 305, 2);
  renderer.drawSprite(61, 598, 305, 2);

  renderer.printCentered('ОБЩИЙ СЧЁТ', 568, 237, 0, 8, 7);
  const values = game.scores;
  renderer.printCentered(formatScore(values[2]), 568, 256, 15, 14, 7);
  renderer.printCentered(formatScore(values[1]), 535, 280, 15, 14, 7);
  renderer.printCentered(formatScore(values[3]), 601, 280, 15, 14, 7);
  renderer.printCentered(formatScore(values[0]), 568, 304, 14, 14, 7);
}

function playerCardLayout() {
  if (!game?.hands?.[PLAYER_SEAT]) return [];
  const cards = game.hands[PLAYER_SEAT];
  const step = cards.length > 1 ? Math.min(60, Math.floor((312 - CARD_WIDTH) / (cards.length - 1))) : 0;
  const totalWidth = CARD_WIDTH + step * Math.max(0, cards.length - 1);
  const startX = Math.round((SCREEN_WIDTH - totalWidth) / 2);

  return cards.map((card, index) => ({
    card,
    x: startX + index * step,
    y: card.id === selectedCardId ? CARD_SELECTED_Y : CARD_NORMAL_Y,
    visibleRight: index < cards.length - 1 ? startX + (index + 1) * step : startX + index * step + CARD_WIDTH,
  }));
}

function drawPlayerHand() {
  const layout = playerCardLayout();
  for (const item of layout) renderer.drawSprite(item.card.spriteId, item.x, item.y);
}

function trickDrawLayout() {
  if (game.status !== 'trick-collecting') {
    return game.trick.map(entry => ({ ...entry, ...TRICK_POSITIONS[entry.seat] }));
  }

  const winnerSeat = game.trickWinnerSeat ?? game.currentSeat;
  const anchor = TRICK_POSITIONS[winnerSeat];
  const step = TRICK_STACK_STEPS[winnerSeat];
  const ordered = [
    ...game.trick.filter(entry => entry.seat !== winnerSeat),
    ...game.trick.filter(entry => entry.seat === winnerSeat),
  ];

  return ordered.map((entry, index) => {
    const depth = ordered.length - index - 1;
    return {
      ...entry,
      x: anchor.x + step.x * depth,
      y: anchor.y + step.y * depth,
    };
  });
}

function drawTrick() {
  for (const entry of trickDrawLayout()) renderer.drawSprite(entry.card.spriteId, entry.x, entry.y);
}

function drawPlayerSeatLabel() {
  const isPlayerTurn = game.status === 'playing'
    && game.currentSeat === PLAYER_SEAT
    && !inputLocked;
  if (!isPlayerTurn) {
    renderer.printCentered('Товарищ', 320, 251, 15, 14, 8);
    return;
  }

  renderer.fillRect(270, 248, 100, 20, 0);
  renderer.strokeRect(270, 248, 100, 20, 14, 1);
  renderer.printCentered('ВАШ ХОД', 320, 251, 14, 14, 8);
}

function drawThinkingBubble() {
  if (game.status !== 'playing' || game.currentSeat === PLAYER_SEAT || !inputLocked) return;
  const boxes = {
    1: { x: 68, y: 25 },
    2: { x: 276, y: 8 },
    3: { x: 480, y: 25 },
  };
  const box = boxes[game.currentSeat];
  if (!box) return;
  renderer.fillRect(box.x, box.y, 93, 18, 7);
  renderer.strokeRect(box.x, box.y, 93, 18, 1, 1);
  renderer.print('Думаю...', box.x + 7, box.y + 4, 0, 8, 7);
}

function drawResultOverlay() {
  if (game.status !== 'contract-result' && game.status !== 'game-over') return;
  const isFinal = game.status === 'game-over';
  const { winningScore, winnerSeats } = matchResult(game.scores);
  const names = game.playerNames;
  const seats = [0, 1, 2, 3];
  const displaySeats = isFinal
    ? [...seats].sort((left, right) => game.scores[right] - game.scores[left] || left - right)
    : seats;

  renderer.fillRect(112, 67, 416, 218, 0);
  renderer.strokeRect(112, 67, 416, 218, 15, 2);
  renderer.strokeRect(117, 72, 406, 208, 2, 2);

  const title = isFinal ? 'ИГРА ОКОНЧЕНА' : 'РАЗДАЧА ОКОНЧЕНА';
  renderer.printCentered(title, 320, 81, 14, 14, 9);

  const summary = isFinal
    ? `${winnerSeats.length === 1 ? 'ПОБЕДИТЕЛЬ' : 'НИЧЬЯ'}: ${winnerSeats.map(seat => names[seat]).join(', ')}`
    : `ОБЩИЙ СЧЁТ ПОСЛЕ ${game.contractIndex + 1} ИЗ ${CONTRACTS.length}`;
  renderer.printCentered(summary, 320, 105, isFinal ? 14 : 10, 14, 7);

  for (let row = 0; row < displaySeats.length; row += 1) {
    const seat = displaySeats[row];
    const y = 132 + row * 25;
    const rank = isFinal
      ? 1 + displaySeats.findIndex(candidate => game.scores[candidate] === game.scores[seat])
      : null;
    const name = isFinal ? `${rank}. ${names[seat]}` : names[seat];
    const color = isFinal
      ? (winnerSeats.includes(seat) ? 14 : 15)
      : (seat === PLAYER_SEAT ? 14 : 15);
    renderer.print(name, 154, y, color, 14, 8);
    renderer.printCentered(formatScore(game.scores[seat]), 468, y, color, 14, 8);
  }

  const footer = isFinal
    ? `ЛУЧШИЙ СЧЁТ: ${formatScore(winningScore)}`
    : 'СЛЕДУЮЩАЯ РАЗДАЧА СКОРО';
  renderer.printCentered(footer, 320, 247, 10, 8, 7);
  if (isFinal) renderer.printCentered('НАЧАТЬ ЗАНОВО: КНОПКА ВНИЗУ', 320, 265, 15, 8, 7);
}

function renderGameTable() {
  renderer.clear(7);
  drawOpponentSeat(1, game.characters[0], 28, 20, 13, 115);
  drawOpponentSeat(2, game.characters[1], 200, 20, 297, 46);
  drawOpponentSeat(3, game.characters[2], 520, 20, 493, 115);
  drawTableSurface();
  drawContractPanel();
  drawScoreBox();
  drawPlayerSeatLabel();
  drawTrick();
  drawPlayerHand();
  drawThinkingBubble();
  drawResultOverlay();
  renderer.present();
}

function render() {
  if (!renderer) return;
  if (screen === 'partners') renderPartnerPicker();
  else if (screen === 'table') renderGameTable();
}

function logicalPoint(event) {
  const rect = el.canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(SCREEN_WIDTH - 1, (event.clientX - rect.left) * SCREEN_WIDTH / rect.width)),
    y: Math.max(0, Math.min(SCREEN_HEIGHT - 1, (event.clientY - rect.top) * SCREEN_HEIGHT / rect.height)),
  };
}

function characterAtPoint(x, y) {
  if (x < 156 || x >= 484 || y < 10 || y >= 327) return null;
  const column = Math.max(0, Math.min(3, Math.floor((x - 160) / 80)));
  const row = Math.max(0, Math.min(2, Math.floor((y - 8) / 104)));
  return CHARACTERS[row * 4 + column] ?? null;
}

function handlePartnerTap(x, y) {
  const character = characterAtPoint(x, y);
  if (!character) {
    setHint('Коснитесь изображения нужного персонажа.');
    return;
  }
  if (selectedPartnerIds.includes(character.id)) {
    setHint('Этот партнёр уже выбран. Коснитесь другого персонажа.');
    return;
  }

  selectedPartnerIds.push(character.id);
  tg?.HapticFeedback?.selectionChanged?.();
  playSelectionSound();
  renderPartnerPicker();

  if (selectedPartnerIds.length < 3) {
    setHint(`${character.name} выбран. Осталось выбрать: ${3 - selectedPartnerIds.length}.`);
    return;
  }

  setHint('Партнёры выбраны. Начинаем раздачу…');
  inputLocked = true;
  const token = runToken;
  void gameDelay(650, token).then(active => {
    if (active) startMatch();
  });
}

function cardAtPoint(x, y) {
  const layout = playerCardLayout();
  for (let index = 0; index < layout.length; index += 1) {
    const item = layout[index];
    if (x >= item.x && x < item.visibleRight && y >= item.y && y <= item.y + CARD_HEIGHT) return item.card;
  }
  return null;
}

function playerHelpText() {
  return 'Ваш ход. Один тап выбирает карту, второй тап по ней кладёт её на стол.';
}

function handleCardTap(x, y) {
  if (!game || game.status !== 'playing') return;
  if (inputLocked || game.currentSeat !== PLAYER_SEAT) {
    setHint(`Сейчас ходит ${game.playerNames[game.currentSeat]}. Дождитесь своего хода.`);
    return;
  }

  const card = cardAtPoint(x, y);
  if (!card) {
    selectedCardId = null;
    render();
    setHint(playerHelpText());
    return;
  }

  const selection = updateCardTapSelection(selectedCardId, card.id);
  selectedCardId = selection.selectedCardId;

  if (!selection.shouldPlay) {
    render();
    setHint('Ваш ход. Карта выбрана — коснитесь её ещё раз, чтобы положить на стол.');
    tg?.HapticFeedback?.selectionChanged?.();
    playSelectionSound();
    return;
  }

  const legal = legalCards(game.hands[PLAYER_SEAT], game.trick, CONTRACTS[game.contractIndex]);
  if (!legal.some(candidate => candidate.id === card.id)) {
    selectedCardId = card.id;
    render();
    setHint('Этой картой сейчас нельзя ходить: соблюдайте масть первой карты.');
    tg?.HapticFeedback?.notificationOccurred?.('error');
    return;
  }

  selectedCardId = null;
  inputLocked = true;
  tg?.HapticFeedback?.impactOccurred?.('light');
  void playCard(PLAYER_SEAT, card, runToken);
}

function handleCanvasTap(x, y) {
  if (screen === 'partners' && !inputLocked) handlePartnerTap(x, y);
  else if (screen === 'table' && game?.status === 'trick-await' && !inputLocked) {
    void collectCompletedTrick(runToken);
  } else if (screen === 'table') handleCardTap(x, y);
}

function removeCard(hand, cardId) {
  const index = hand.findIndex(card => card.id === cardId);
  if (index < 0) return null;
  return hand.splice(index, 1)[0];
}

function announceCurrentTurn() {
  if (game.currentSeat === PLAYER_SEAT) {
    inputLocked = false;
    setHint(playerHelpText());
    tg?.HapticFeedback?.notificationOccurred?.('success');
  } else {
    inputLocked = true;
    setHint(`${game.playerNames[game.currentSeat]} думает…`);
  }
  saveCurrentGame();
  render();
}

async function continueCurrentTurn(token, extraDelay = 0) {
  if (token !== runToken || game.status !== 'playing') return;
  announceCurrentTurn();
  if (game.currentSeat === PLAYER_SEAT) return;

  if (!await gameDelay(AI_THINK_MS + extraDelay, token)) return;
  const contract = CONTRACTS[game.contractIndex];
  const hand = game.hands[game.currentSeat];
  const card = chooseAiCard(hand, game.trick, contract, game.trickNumber, game.random);
  if (!card) return;
  await playCard(game.currentSeat, card, token);
}

async function collectCompletedTrick(token) {
  if (token !== runToken || game.status !== 'trick-await') return;
  game.status = 'trick-collecting';
  inputLocked = true;
  setHint('Собираем взятку…');
  playTrickSound();
  render();
  if (!await holdForOnePaint(token)) return;
  if (!await gameDelay(TRICK_COLLECT_HOLD_MS, token)) return;

  game.trick = [];
  game.trickWinnerSeat = null;
  render();

  if (game.trickNumber >= 8) {
    await finishContract(token);
    return;
  }

  game.status = 'playing';
  await continueCurrentTurn(token, 260);
}

async function playCard(seat, card, token) {
  if (token !== runToken || game.status !== 'playing' || game.currentSeat !== seat) return;
  const played = removeCard(game.hands[seat], card.id);
  if (!played) return;

  inputLocked = true;
  game.trick.push({ seat, card: played });
  playCardSound();
  setHint(`${game.playerNames[seat]} делает ход.`);
  render();

  if (!await gameDelay(CARD_REVEAL_MS, token)) return;

  if (game.trick.length < 4) {
    game.currentSeat = (seat + 1) % 4;
    await continueCurrentTurn(token);
    return;
  }

  const winner = trickWinner(game.trick);
  const points = scoreTrick(CONTRACTS[game.contractIndex], game.trick, game.trickNumber);
  game.dealScores[winner.seat] += points;
  game.scores[winner.seat] += points;
  game.trickNumber += 1;
  game.currentSeat = winner.seat;
  game.trickWinnerSeat = winner.seat;
  game.status = 'trick-await';
  inputLocked = false;
  saveCurrentGame();
  setHint(`${game.playerNames[winner.seat]} берёт взятку${points === 0 ? '.' : `: ${formatScore(points)}.`} Нажмите в любую часть экрана.`);
  render();
  tg?.HapticFeedback?.notificationOccurred?.('success');
}

async function finishContract(token) {
  if (token !== runToken) return;
  game.status = 'contract-result';
  inputLocked = true;
  saveCurrentGame();
  render();
  setHint(`Раздача окончена. Следующая начнётся через несколько секунд.`);

  if (!await gameDelay(CONTRACT_RESULT_MS, token)) return;
  if (game.contractIndex >= CONTRACTS.length - 1) {
    game.status = 'game-over';
    removeSavedGame();
    render();
    const { winningScore, winnerSeats } = matchResult(game.scores);
    const winnerNames = winnerSeats.map(seat => game.playerNames[seat]).join(', ');
    const resultText = winnerSeats.length === 1
      ? `Победитель: ${winnerNames}`
      : `Ничья: ${winnerNames}`;
    setHint(`${resultText}. Лучший счёт: ${formatScore(winningScore)}. Для новой партии нажмите «Начать заново».`);
    tg?.HapticFeedback?.notificationOccurred?.('success');
    return;
  }

  startContract(game.contractIndex + 1);
}

function startContract(contractIndex) {
  const token = ++runToken;
  game.contractIndex = contractIndex;
  game.hands = dealHands(shuffleDeck(createDeck(), game.random));
  game.trick = [];
  game.trickWinnerSeat = null;
  game.trickNumber = 0;
  game.dealScores = [0, 0, 0, 0];
  game.currentSeat = (contractIndex + 1) % 4;
  game.status = 'playing';
  selectedCardId = null;
  inputLocked = true;
  saveCurrentGame();
  render();
  setHint(`${CONTRACTS[contractIndex].name}. Раздаём карты…`);
  void continueCurrentTurn(token, 720);
}

function startMatch() {
  const querySeed = Number(new URLSearchParams(location.search).get('seed'));
  const seed = Number.isFinite(querySeed) && querySeed !== 0 ? querySeed : (Date.now() ^ 0x19930822);
  const characters = selectedPartnerIds.map(id => CHARACTERS[id]);
  game = {
    characters,
    playerNames: ['Товарищ', ...characters.map(character => character.name)],
    random: createSeededRandom(seed),
    scores: [0, 0, 0, 0],
    dealScores: [0, 0, 0, 0],
    hands: [[], [], [], []],
    trick: [],
    trickWinnerSeat: null,
    trickNumber: 0,
    currentSeat: 0,
    contractIndex: 0,
    status: 'playing',
  };
  screen = 'table';
  startContract(0);
}

function resetToPartnerPicker() {
  if (!renderer) return;
  runToken += 1;
  removeSavedGame();
  el.loadingOverlay.hidden = true;
  el.startOverlay.hidden = true;
  screen = 'partners';
  game = null;
  selectedPartnerIds = [];
  selectedCardId = null;
  pointerStart = null;
  inputLocked = false;
  render();
  setHint('Выберите трёх партнёров: один тап сразу выбирает персонажа.');
}

function showStartMenu() {
  if (!renderer) return;
  runToken += 1;
  screen = 'start';
  game = null;
  selectedPartnerIds = [];
  selectedCardId = null;
  pointerStart = null;
  inputLocked = true;
  const saved = loadSavedGame();
  el.loadingOverlay.hidden = true;
  el.startOverlay.hidden = false;
  el.continueButton.disabled = !saved;
  el.continueButton.setAttribute('aria-disabled', String(!saved));
  el.savedGameInfo.textContent = saved
    ? `Сохранено: контракт ${saved.contractIndex + 1} из ${CONTRACTS.length}`
    : 'Сохранённой игры нет';
  renderer.clear(2);
  renderer.present();
  setHint('Продолжите сохранённую партию или начните новую.');
}

function continueSavedGame() {
  const saved = loadSavedGame();
  if (!saved) {
    showStartMenu();
    return;
  }

  const token = ++runToken;
  selectedPartnerIds = [...saved.selectedPartnerIds];
  selectedCardId = null;
  pointerStart = null;
  const characters = selectedPartnerIds.map(id => CHARACTERS[id]);
  game = {
    characters,
    playerNames: ['Товарищ', ...characters.map(character => character.name)],
    random: createSeededRandom(saved.randomState),
    scores: [...saved.scores],
    dealScores: [...saved.dealScores],
    hands: saved.hands.map(hand => [...hand]),
    trick: saved.trick.map(entry => ({ ...entry })),
    trickWinnerSeat: saved.trickWinnerSeat,
    trickNumber: saved.trickNumber,
    currentSeat: saved.currentSeat,
    contractIndex: saved.contractIndex,
    status: saved.status,
  };
  screen = 'table';
  inputLocked = true;
  el.startOverlay.hidden = true;

  if (game.status === 'trick-await') {
    inputLocked = false;
    setHint(`${game.playerNames[game.currentSeat]} берёт взятку. Нажмите в любую часть экрана.`);
    render();
    return;
  }
  if (game.status === 'contract-result') {
    void finishContract(token);
    return;
  }

  setHint(`Продолжаем контракт «${CONTRACTS[game.contractIndex].name}».`);
  void continueCurrentTurn(token, 260);
}

async function startApplication() {
  const token = ++runToken;
  showLoading();
  try {
    const assets = await loadKingAssets();
    if (token !== runToken) return;
    renderer = new IndexedRenderer(el.canvas, assets);
    setLoadingBarState('is-complete');
    await delay(180 * TIME_SCALE);
    if (token !== runToken) return;
    el.loadingOverlay.hidden = true;
    showStartMenu();
    el.canvas.focus({ preventScroll: true });
  } catch (error) {
    if (token === runToken) showLoadError(error);
  }
}

el.canvas.addEventListener('pointerdown', event => {
  if (!event.isPrimary) return;
  if (screen === 'loading') return;
  prepareAudio();
  const point = logicalPoint(event);
  pointerStart = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    ...point,
  };
  el.canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});

el.canvas.addEventListener('pointerup', event => {
  if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;
  const start = pointerStart;
  const point = logicalPoint(event);
  pointerStart = null;
  el.canvas.releasePointerCapture?.(event.pointerId);
  event.preventDefault();

  const movement = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY);
  if (movement <= TAP_MOVE_LIMIT_CSS) handleCanvasTap(point.x, point.y);
});

el.canvas.addEventListener('pointercancel', () => {
  pointerStart = null;
});
el.canvas.addEventListener('contextmenu', event => event.preventDefault());

function updatePauseState() {
  paused = document.hidden || el.rulesDialog.open || el.aboutDialog.open;
}

document.addEventListener('visibilitychange', updatePauseState);
document.addEventListener('pointerdown', event => {
  prepareAudio();
  if (event.isPrimary !== false && isLandscapeViewport()) void requestLandscapeFullscreen(true);
});
document.addEventListener('pointerup', event => {
  if (screen !== 'table' || game?.status !== 'trick-await' || inputLocked) return;
  if (event.target?.closest?.('button, a, dialog')) return;
  void collectCompletedTrick(runToken);
});

function openInfoDialog(dialog) {
  dialog.showModal();
  updatePauseState();
}

el.continueButton.addEventListener('click', continueSavedGame);
el.newGameButton.addEventListener('click', resetToPartnerPicker);
el.restartButton.addEventListener('click', resetToPartnerPicker);
el.soundButton.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  saveSoundPreference();
  syncSoundButton();
  if (audioMasterGain && audioContext?.state !== 'closed') {
    audioMasterGain.gain.setValueAtTime(soundEnabled ? 1 : 0, audioContext.currentTime);
  }
  if (soundEnabled) {
    prepareAudio(true);
    playSelectionSound();
  }
});
el.retryButton.addEventListener('click', startApplication);
el.rulesButton.addEventListener('click', () => openInfoDialog(el.rulesDialog));
el.aboutButton.addEventListener('click', () => openInfoDialog(el.aboutDialog));
el.rulesDialog.addEventListener('close', updatePauseState);
el.aboutDialog.addEventListener('close', updatePauseState);

el.aboutLink.addEventListener('click', event => {
  if (!tg?.openTelegramLink) return;
  event.preventDefault();
  tg.openTelegramLink(el.aboutLink.href);
});

window.__kingDebug = {
  tap(x, y) {
    handleCanvasTap(x, y);
  },
  snapshot() {
    return {
      screen,
      selectedPartnerIds: [...selectedPartnerIds],
      selectedCardId,
      inputLocked,
      game: game ? {
        status: game.status,
        contractIndex: game.contractIndex,
        currentSeat: game.currentSeat,
        trickNumber: game.trickNumber,
        trick: game.trick.map(entry => ({ seat: entry.seat, cardId: entry.card.id })),
        trickWinnerSeat: game.trickWinnerSeat,
        trickVisualPositions: trickDrawLayout().map(entry => ({
          seat: entry.seat,
          cardId: entry.card.id,
          x: entry.x,
          y: entry.y,
        })),
        handCounts: game.hands.map(hand => hand.length),
        playerCards: game.hands[0].map(card => ({ id: card.id, x: playerCardLayout().find(item => item.card.id === card.id)?.x })),
        legalPlayerCardIds: game.status === 'playing'
          ? legalCards(game.hands[0], game.trick, CONTRACTS[game.contractIndex]).map(card => card.id)
          : [],
        scores: [...game.scores],
        ...matchResult(game.scores),
      } : null,
    };
  },
};

initTelegram();
initOrientationHandling();
syncSoundButton();
startApplication();
