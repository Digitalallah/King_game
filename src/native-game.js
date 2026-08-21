import {
  CHARACTERS,
  CONTRACTS,
  GAME_MODES,
  SUIT_SYMBOLS,
  chooseAiCard,
  chooseAiContract,
  contractIsResolved,
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
} from './game-engine.js?v=native-10';
import {
  IndexedRenderer,
  loadKingAssets,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
} from './native-assets.js?v=native-8';
import {
  KingRoomClient,
  defaultPlayerName,
  parseRoomInvite,
} from './network-client.js?v=native-10';

const tg = window.Telegram?.WebApp;

const el = {
  canvas: document.querySelector('#gameCanvas'),
  avatarLayer: document.querySelector('#avatarLayer'),
  orientationHint: document.querySelector('#orientationHint'),
  loadingOverlay: document.querySelector('#loadingOverlay'),
  loadingText: document.querySelector('#loadingText'),
  loadingBar: document.querySelector('#loadingBar'),
  retryButton: document.querySelector('#retryButton'),
  startOverlay: document.querySelector('#startOverlay'),
  modeDialog: document.querySelector('#modeDialog'),
  classicModeButton: document.querySelector('#classicModeButton'),
  orderedModeButton: document.querySelector('#orderedModeButton'),
  contractDialog: document.querySelector('#contractDialog'),
  contractChoiceTitle: document.querySelector('#contractChoiceTitle'),
  contractChoiceLead: document.querySelector('#contractChoiceLead'),
  contractChoices: document.querySelector('#contractChoices'),
  savedGameInfo: document.querySelector('#savedGameInfo'),
  continueButton: document.querySelector('#continueButton'),
  continueNetworkButton: document.querySelector('#continueNetworkButton'),
  newGameButton: document.querySelector('#newGameButton'),
  restartButton: document.querySelector('#restartButton'),
  soundButton: document.querySelector('#soundButton'),
  rulesButton: document.querySelector('#rulesButton'),
  aboutButton: document.querySelector('#aboutButton'),
  rulesDialog: document.querySelector('#rulesDialog'),
  aboutDialog: document.querySelector('#aboutDialog'),
  networkDialog: document.querySelector('#networkDialog'),
  networkDialogTitle: document.querySelector('#networkDialogTitle'),
  networkLead: document.querySelector('#networkLead'),
  networkNameInput: document.querySelector('#networkNameInput'),
  networkConnectButton: document.querySelector('#networkConnectButton'),
  networkCloseButton: document.querySelector('#networkCloseButton'),
  networkStatus: document.querySelector('#networkStatus'),
  networkLobby: document.querySelector('#networkLobby'),
  networkRoomCode: document.querySelector('#networkRoomCode'),
  networkPlayers: document.querySelector('#networkPlayers'),
  networkInviteButton: document.querySelector('#networkInviteButton'),
  networkCopyButton: document.querySelector('#networkCopyButton'),
  networkStartButton: document.querySelector('#networkStartButton'),
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
const SAVE_VERSION = 2;
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
const LIVE_PLAYER_TILE = { x: 14, y: 107, width: 116, height: 114 };
const CARD_BY_ID = new Map(createDeck().map(card => [card.id, card]));
const requestedSpeed = Number(new URLSearchParams(location.search).get('speed'));
const TIME_SCALE = Number.isFinite(requestedSpeed) && requestedSpeed > 0
  ? Math.max(0.01, Math.min(4, requestedSpeed))
  : 1;

let renderer = null;
let screen = 'loading';
let selectedPartnerIds = [];
let selectedSeatChoices = [];
let selectedGameMode = GAME_MODES.CLASSIC;
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
let networkMode = false;
let networkRoom = null;
let networkSnapshot = null;
let networkAdvanceTimer = null;
let networkCommandPending = false;
let networkSetupRole = 'host';
let networkSetupRoomId = '';
let lastNetworkStatus = '';
let lastNetworkTrickLength = 0;
const pendingInviteRoomId = parseRoomInvite({ telegram: tg, search: location.search });
const networkClient = new KingRoomClient({ telegram: tg });
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
    if (saved.version === 1) {
      saved.mode = GAME_MODES.CLASSIC;
      saved.roundNumber = saved.contractIndex;
      saved.ordererSeat = null;
      saved.remainingContracts = null;
    }
    if (![1, SAVE_VERSION].includes(saved.version)) throw new Error('Invalid saved version');

    const mode = saved.mode === GAME_MODES.ORDERED ? GAME_MODES.ORDERED : GAME_MODES.CLASSIC;
    const totalRounds = mode === GAME_MODES.ORDERED ? CONTRACTS.length * 4 : CONTRACTS.length;
    const partnerIds = saved.selectedPartnerIds;
    const validPartners = Array.isArray(partnerIds)
      && partnerIds.length === 3
      && new Set(partnerIds).size === 3
      && partnerIds.every(id => Number.isInteger(id) && CHARACTERS[id]);
    const validStatus = ['contract-choice', 'playing', 'trick-await', 'contract-result'].includes(saved.status);
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
    const validContract = saved.status === 'contract-choice'
      ? saved.contractIndex === null
      : Number.isInteger(saved.contractIndex)
        && saved.contractIndex >= 0
        && saved.contractIndex < CONTRACTS.length;
    const validRound = Number.isInteger(saved.roundNumber)
      && saved.roundNumber >= 0
      && saved.roundNumber < totalRounds;
    const validNumbers = Number.isInteger(saved.randomState)
      && saved.randomState > 0
      && validContract
      && validRound
      && Number.isInteger(saved.currentSeat)
      && saved.currentSeat >= 0
      && saved.currentSeat < 4
      && Number.isInteger(saved.trickNumber)
      && saved.trickNumber >= 0
      && saved.trickNumber <= 8;
    const validOrder = mode === GAME_MODES.CLASSIC
      ? saved.ordererSeat === null
      : Number.isInteger(saved.ordererSeat) && saved.ordererSeat >= 0 && saved.ordererSeat < 4;
    const validRemaining = mode === GAME_MODES.CLASSIC
      ? saved.remainingContracts === null
      : Array.isArray(saved.remainingContracts)
        && saved.remainingContracts.length === 4
        && saved.remainingContracts.every(list => (
          Array.isArray(list)
          && new Set(list).size === list.length
          && list.every(index => Number.isInteger(index) && CONTRACTS[index])
        ));

    if (
      !validPartners
      || !validStatus
      || !validHands
      || !validTrick
      || !validNumbers
      || !validOrder
      || !validRemaining
      || !scoreArray(saved.scores)
      || !scoreArray(saved.dealScores)
      || (saved.status === 'playing' && saved.trick.length >= 4)
      || (saved.status === 'trick-await' && saved.trick.length !== 4)
      || ((saved.status === 'contract-choice' || saved.status === 'contract-result') && saved.trick.length !== 0)
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
      mode,
      randomState: saved.randomState,
      scores: [...saved.scores],
      dealScores: [...saved.dealScores],
      hands,
      trick,
      trickWinnerSeat,
      trickNumber: saved.trickNumber,
      currentSeat: saved.currentSeat,
      contractIndex: saved.contractIndex,
      roundNumber: saved.roundNumber,
      ordererSeat: saved.ordererSeat,
      remainingContracts: saved.remainingContracts?.map(list => [...list]) ?? null,
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
    networkMode
    || screen !== 'table'
    || !game
    || !['contract-choice', 'playing', 'trick-await', 'contract-result'].includes(game.status)
  ) return;

  try {
    const payload = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      selectedPartnerIds: game.characters.map(character => character.id),
      mode: game.mode,
      randomState: game.random.getState(),
      scores: [...game.scores],
      dealScores: [...game.dealScores],
      hands: game.hands.map(hand => hand.map(card => card.id)),
      trick: game.trick.map(entry => ({ seat: entry.seat, cardId: entry.card.id })),
      trickWinnerSeat: game.trickWinnerSeat,
      trickNumber: game.trickNumber,
      currentSeat: game.currentSeat,
      contractIndex: game.contractIndex,
      roundNumber: game.roundNumber,
      ordererSeat: game.ordererSeat,
      remainingContracts: game.remainingContracts?.map(list => [...list]) ?? null,
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

function drawLivePlayerTile() {
  const { x, y, width, height } = LIVE_PLAYER_TILE;
  const selectedOrders = selectedSeatChoices
    .map((choice, index) => (choice.type === 'human' ? index + 1 : null))
    .filter(Boolean);
  renderer.fillRect(x, y, width, height, selectedOrders.length ? 1 : 2);
  renderer.strokeRect(x, y, width, height, selectedOrders.length ? 14 : 15, 2);

  renderer.fillRect(x + 43, y + 15, 30, 28, 14);
  renderer.fillRect(x + 36, y + 43, 44, 38, 14);
  renderer.fillRect(x + 48, y + 22, 5, 5, 0);
  renderer.fillRect(x + 63, y + 22, 5, 5, 0);
  renderer.fillRect(x + 52, y + 33, 13, 3, 0);
  printCenteredShadowed('ЖИВОЙ', x + width / 2, y + 84, 15, 8, 7);
  printCenteredShadowed('ИГРОК', x + width / 2, y + 96, 15, 8, 7);
  if (selectedOrders.length) {
    const label = `МЕСТА: ${selectedOrders.join(',')}`;
    printCenteredShadowed(label, x + width / 2, y + 2, 14, 8, 6);
  }
}

function renderPartnerPicker() {
  renderer.clear(2);
  drawSelectionBorder();
  drawLivePlayerTile();
  renderer.drawSprite(52, 160, 15);
  renderer.drawSprite(53, 160, 119);
  renderer.drawSprite(54, 160, 223);

  for (const character of CHARACTERS) {
    const column = character.id % 4;
    const row = Math.floor(character.id / 4);
    const selectedOrder = selectedSeatChoices.findIndex(choice => (
      choice.type === 'bot' && choice.characterId === character.id
    ));
    if (selectedOrder >= 0) drawSelectedPartner(character, selectedOrder);
    else printCenteredShadowed(character.name, 200 + column * 80, 97 + row * 104, 15, 14, 7);
  }

  const prompt = selectedSeatChoices.length >= 3
    ? 'Партнёры выбраны...'
    : `Выберите ${selectedSeatChoices.length + 1}-го партнера...`;
  renderer.printCentered(prompt, 320, 333, 14, 14, 7);
  renderer.present();
}

function drawCharacter(character, x, y) {
  renderer.drawSpriteRegion(character.spriteId, character.cropX, 0, 80, 88, x, y, 2);
}

function drawHumanPlaceholder(x, y) {
  renderer.fillRect(x, y, 80, 88, 2);
  renderer.strokeRect(x, y, 80, 88, 0, 2);
  renderer.fillRect(x + 25, y + 8, 30, 29, 14);
  renderer.fillRect(x + 16, y + 37, 48, 36, 14);
  renderer.fillRect(x + 31, y + 18, 5, 5, 0);
  renderer.fillRect(x + 45, y + 18, 5, 5, 0);
  renderer.fillRect(x + 34, y + 29, 13, 3, 0);
}

function drawBackFan(count, x, y, maxWidth = 136) {
  if (count <= 0) return;
  const step = count > 1 ? Math.max(7, Math.min(14, Math.floor((maxWidth - CARD_WIDTH) / (count - 1)))) : 0;
  for (let index = 0; index < count; index += 1) renderer.drawSprite(49, x + step * index, y);
}

function drawOpponentSeat(seat, character, x, y, backsX, backsY) {
  const record = game.seatRecords?.[seat];
  if (record?.type === 'human') drawHumanPlaceholder(x, y);
  else drawCharacter(character, x, y);
  printCenteredShadowed(compactName(record?.name || character?.name || 'Игрок'), x + 40, y + 74, 15, 14, 7);
  drawBackFan(game.hands[seat].length, backsX, backsY);
}

function syncAvatarLayer() {
  if (!el.avatarLayer?.replaceChildren) return;
  el.avatarLayer.replaceChildren();
  if (!networkMode || screen !== 'table' || !game?.seatRecords) return;
  for (let seat = 1; seat <= 3; seat += 1) {
    const record = game.seatRecords[seat];
    if (record?.type !== 'human' || !record.photoUrl) continue;
    const image = document.createElement('img');
    image.className = `table-avatar seat-${seat}`;
    image.src = record.photoUrl;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => image.remove());
    el.avatarLayer.append(image);
  }
}

function drawTableSurface() {
  renderer.fillRect(186, 115, 267, 131, 2);
  renderer.strokeRect(186, 115, 267, 131, 0, 2);
  renderer.fillRect(188, 117, 263, 1, 9);
  renderer.drawSprite(60, 188, 118, 2);
  renderer.drawSprite(60, 431, 118, 2);
}

function drawContractPanel() {
  renderer.fillRect(12, 253, 121, 59, 2);
  renderer.strokeRect(12, 253, 121, 59, 0, 2);
  if (game.status === 'contract-choice' || game.contractIndex === null) {
    renderer.printCentered('ЗАКАЗ', 72, 257, 15, 14, 8);
    renderer.printCentered('КОНТРАКТА', 72, 274, 15, 14, 7);
    renderer.printCentered(String(game.roundNumber + 1) + '/' + String(game.totalRounds || CONTRACTS.length * 4), 72, 291, 14, 14, 8);
    return;
  }
  const contract = CONTRACTS[game.contractIndex];
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
    renderer.printCentered((game.playerNames[0] || 'Товарищ').slice(0, 18), 320, 251, 15, 14, 8);
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
  const thinkingText = game.seatRecords?.[game.currentSeat]?.type === 'human' ? 'Ждём...' : 'Думаю...';
  renderer.print(thinkingText, box.x + 7, box.y + 4, 0, 8, 7);
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
    : `ОБЩИЙ СЧЁТ ПОСЛЕ ${game.roundNumber + 1} ИЗ ${game.totalRounds || CONTRACTS.length}`;
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
  syncAvatarLayer();
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

function livePlayerAtPoint(x, y) {
  return x >= LIVE_PLAYER_TILE.x
    && x < LIVE_PLAYER_TILE.x + LIVE_PLAYER_TILE.width
    && y >= LIVE_PLAYER_TILE.y
    && y < LIVE_PLAYER_TILE.y + LIVE_PLAYER_TILE.height;
}

function finishPartnerSelection() {
  inputLocked = true;
  const token = runToken;
  const humanCount = selectedSeatChoices.filter(choice => choice.type === 'human').length;
  if (humanCount > 0) {
    setHint('Состав выбран. Создаём сетевую комнату…');
    void gameDelay(280, token).then(active => {
      if (active) openNetworkSetup({ role: 'host' });
    });
    return;
  }

  selectedPartnerIds = selectedSeatChoices.map(choice => choice.characterId);
  setHint('Партнёры выбраны. Начинаем раздачу…');
  void gameDelay(650, token).then(active => {
    if (active) startMatch();
  });
}

function handlePartnerTap(x, y) {
  if (livePlayerAtPoint(x, y)) {
    selectedSeatChoices.push({ type: 'human' });
    tg?.HapticFeedback?.selectionChanged?.();
    playSelectionSound();
    renderPartnerPicker();
    if (selectedSeatChoices.length >= 3) finishPartnerSelection();
    else setHint(`Живой игрок выбран. Осталось выбрать: ${3 - selectedSeatChoices.length}.`);
    return;
  }

  const character = characterAtPoint(x, y);
  if (!character) {
    setHint('Коснитесь изображения нужного персонажа.');
    return;
  }
  if (selectedSeatChoices.some(choice => choice.type === 'bot' && choice.characterId === character.id)) {
    setHint('Этот партнёр уже выбран. Коснитесь другого персонажа.');
    return;
  }

  selectedPartnerIds.push(character.id);
  selectedSeatChoices.push({ type: 'bot', characterId: character.id });
  tg?.HapticFeedback?.selectionChanged?.();
  playSelectionSound();
  renderPartnerPicker();

  if (selectedSeatChoices.length < 3) {
    setHint(`${character.name} выбран. Осталось выбрать: ${3 - selectedSeatChoices.length}.`);
    return;
  }
  finishPartnerSelection();
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

function illegalCardHint(hand, trick, contract, card) {
  const leadSuit = trick?.[0]?.card?.suit;
  if (leadSuit && hand.some(candidate => candidate.suit === leadSuit) && card.suit !== leadSuit) {
    const symbol = SUIT_SYMBOLS[leadSuit] || '';
    return `Нужно ходить ${symbol}: масть задаёт первая карта взятки. Вторая карта масть хода не меняет.`;
  }
  if (!leadSuit && contract?.heartLeadRestricted && card.suit === 'hearts' && hand.some(candidate => candidate.suit !== 'hearts')) {
    return 'С червей нельзя начинать эту взятку, пока на руке есть другая масть.';
  }
  if (leadSuit && contract?.forceKingDiscard && !hand.some(candidate => candidate.suit === leadSuit)) {
    const king = hand.find(candidate => candidate.suit === 'hearts' && candidate.rank === 13);
    if (king && card.id !== king.id) return 'Нет масти хода: в этом контракте нужно сбросить Кинга.';
  }
  return 'Этой картой сейчас нельзя ходить: соблюдайте масть первой карты.';
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

  const legal = networkMode
    ? game.hands[PLAYER_SEAT].filter(candidate => game.legalCardIds?.includes(candidate.id))
    : legalCards(game.hands[PLAYER_SEAT], game.trick, CONTRACTS[game.contractIndex]);
  if (!legal.some(candidate => candidate.id === card.id)) {
    selectedCardId = card.id;
    render();
    setHint(illegalCardHint(game.hands[PLAYER_SEAT], game.trick, CONTRACTS[game.contractIndex], card));
    tg?.HapticFeedback?.notificationOccurred?.('error');
    return;
  }

  selectedCardId = null;
  inputLocked = true;
  tg?.HapticFeedback?.impactOccurred?.('light');
  if (networkMode) {
    networkCommandPending = true;
    if (!networkClient.playCard(card.id)) {
      networkCommandPending = false;
      inputLocked = false;
    }
    return;
  }
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
  const character = game.characters[game.currentSeat - 1];
  const card = chooseAiCard(hand, game.trick, contract, game.trickNumber, game.random, {
    character,
    skill: character?.skill,
    seat: game.currentSeat,
    hands: game.hands,
  });
  if (!card) return;
  await playCard(game.currentSeat, card, token);
}

async function collectCompletedTrick(token) {
  if (token !== runToken || game.status !== 'trick-await') return;
  if (networkMode) {
    if (networkCommandPending) return;
    networkCommandPending = true;
    inputLocked = true;
    setHint('Собираем взятку…');
    if (!networkClient.collectTrick()) {
      networkCommandPending = false;
      inputLocked = false;
    }
    return;
  }
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

  if (game.trickNumber >= 8 || contractIsResolved(CONTRACTS[game.contractIndex], game.hands)) {
    game.hands = [[], [], [], []];
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

function finishLocalGame() {
  game.status = 'game-over';
  removeSavedGame();
  closeContractDialog();
  render();
  const { winningScore, winnerSeats } = matchResult(game.scores);
  const winnerNames = winnerSeats.map(seat => game.playerNames[seat]).join(', ');
  const resultText = winnerSeats.length === 1
    ? `Победитель: ${winnerNames}`
    : `Ничья: ${winnerNames}`;
  setHint(`${resultText}. Лучший счёт: ${formatScore(winningScore)}. Для новой партии нажмите «Начать заново».`);
  tg?.HapticFeedback?.notificationOccurred?.('success');
}

async function finishContract(token) {
  if (token !== runToken) return;
  game.status = 'contract-result';
  inputLocked = true;
  closeContractDialog();
  saveCurrentGame();
  render();
  setHint('Раздача окончена. Следующая начнётся через несколько секунд.');

  if (!await gameDelay(CONTRACT_RESULT_MS, token)) return;
  if (game.mode === GAME_MODES.ORDERED) {
    if (game.roundNumber >= CONTRACTS.length * 4 - 1) finishLocalGame();
    else startOrderedRound(game.roundNumber + 1);
    return;
  }
  if (game.contractIndex >= CONTRACTS.length - 1) {
    finishLocalGame();
    return;
  }
  startContract(game.contractIndex + 1);
}

function activateOrderedContract(contractIndex, token = runToken) {
  if (!game || game.mode !== GAME_MODES.ORDERED || game.status !== 'contract-choice') return false;
  const seat = game.ordererSeat;
  const available = game.remainingContracts?.[seat] || [];
  if (!available.includes(contractIndex)) return false;
  game.remainingContracts[seat] = available.filter(index => index !== contractIndex);
  game.contractIndex = contractIndex;
  game.currentSeat = seat;
  game.status = 'playing';
  inputLocked = true;
  closeContractDialog();
  saveCurrentGame();
  render();
  setHint(`${CONTRACTS[contractIndex].name}. Заказ принят.`);
  void continueCurrentTurn(token, 520);
  return true;
}

async function continueContractChoice(token, extraDelay = 0) {
  if (token !== runToken || !game || game.status !== 'contract-choice') return;
  if (game.ordererSeat === PLAYER_SEAT) {
    inputLocked = true;
    render();
    showContractChoice();
    setHint('Ваш заказ. Выберите контракт для этой раздачи.');
    return;
  }
  inputLocked = true;
  closeContractDialog();
  render();
  setHint(`${game.playerNames[game.ordererSeat]} выбирает контракт…`);
  if (!await gameDelay(AI_THINK_MS + extraDelay, token)) return;
  const seat = game.ordererSeat;
  const character = game.characters[seat - 1];
  const available = game.remainingContracts[seat];
  const contractIndex = chooseAiContract(game.hands[seat], available, game.random, {
    character,
    skill: character?.skill,
    seat,
    hands: game.hands,
  });
  activateOrderedContract(contractIndex, token);
}

function startOrderedRound(roundNumber) {
  const token = ++runToken;
  game.mode = GAME_MODES.ORDERED;
  game.roundNumber = roundNumber;
  game.totalRounds = CONTRACTS.length * 4;
  game.contractIndex = null;
  game.ordererSeat = (roundNumber + 1) % 4;
  game.hands = dealHands(shuffleDeck(createDeck(), game.random));
  game.trick = [];
  game.trickWinnerSeat = null;
  game.trickNumber = 0;
  game.dealScores = [0, 0, 0, 0];
  game.currentSeat = game.ordererSeat;
  game.status = 'contract-choice';
  selectedCardId = null;
  inputLocked = true;
  saveCurrentGame();
  render();
  void continueContractChoice(token, 720);
}

function startContract(contractIndex) {
  const token = ++runToken;
  game.mode = GAME_MODES.CLASSIC;
  game.roundNumber = contractIndex;
  game.totalRounds = CONTRACTS.length;
  game.contractIndex = contractIndex;
  game.ordererSeat = null;
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

function visualSeat(canonicalSeat, localSeat) {
  return (canonicalSeat - localSeat + 4) % 4;
}

function rotateSeats(values, localSeat, fallback = null) {
  const rotated = [fallback, fallback, fallback, fallback];
  for (let canonicalSeat = 0; canonicalSeat < 4; canonicalSeat += 1) {
    rotated[visualSeat(canonicalSeat, localSeat)] = values?.[canonicalSeat] ?? fallback;
  }
  return rotated;
}

function compactName(value, fallback = 'Игрок') {
  const name = String(value || fallback).trim() || fallback;
  return name.length > 12 ? `${name.slice(0, 11)}…` : name;
}

function buildNetworkTableGame(snapshot, room) {
  const localSeat = room.localSeat;
  const seatRecords = rotateSeats(room.seats, localSeat).map((record, seat) => ({
    ...record,
    seat,
    name: String(record?.name || (record?.type === 'bot' ? 'Компьютер' : 'Игрок')).slice(0, 24),
  }));
  const counts = rotateSeats(snapshot.handCounts, localSeat, 0);
  const hands = counts.map(count => Array.from({ length: Number(count) || 0 }, () => null));
  hands[0] = snapshot.handIds.map(cardId => CARD_BY_ID.get(cardId)).filter(Boolean);
  const trick = snapshot.trick.map(entry => ({
    seat: visualSeat(entry.seat, localSeat),
    card: CARD_BY_ID.get(entry.cardId),
  })).filter(entry => entry.card);
  const characters = seatRecords.slice(1).map(record => (
    record.type === 'bot' ? CHARACTERS[record.characterId] : null
  ));
  return {
    network: true,
    characters,
    seatRecords,
    playerNames: seatRecords.map(record => record.name),
    scores: rotateSeats(snapshot.scores, localSeat, 0),
    dealScores: rotateSeats(snapshot.dealScores, localSeat, 0),
    hands,
    trick,
    mode: snapshot.mode || room.mode || GAME_MODES.CLASSIC,
    roundNumber: Number.isInteger(snapshot.roundNumber) ? snapshot.roundNumber : (snapshot.contractIndex || 0),
    totalRounds: Number(snapshot.totalRounds) || CONTRACTS.length,
    ordererSeat: snapshot.ordererSeat === null || snapshot.ordererSeat === undefined
      ? null
      : visualSeat(snapshot.ordererSeat, localSeat),
    availableContractIndexes: [...(snapshot.availableContractIndexes || [])],
    trickWinnerSeat: snapshot.trickWinnerSeat === null
      ? null
      : visualSeat(snapshot.trickWinnerSeat, localSeat),
    trickNumber: snapshot.trickNumber,
    currentSeat: visualSeat(snapshot.currentSeat, localSeat),
    contractIndex: snapshot.contractIndex,
    status: snapshot.status,
    winners: snapshot.winners.map(seat => visualSeat(seat, localSeat)),
    legalCardIds: [...snapshot.legalCardIds],
    serverMessage: snapshot.message,
  };
}

function scheduleNetworkAdvance(snapshot) {
  clearTimeout(networkAdvanceTimer);
  networkAdvanceTimer = null;
  if (!Number.isFinite(snapshot?.nextActionAt) || !Number.isFinite(snapshot?.serverNow)) return;
  const waitMs = Math.max(35, snapshot.nextActionAt - snapshot.serverNow + 35);
  networkAdvanceTimer = setTimeout(() => networkClient.advance(), waitMs);
}

function describeNetworkTurn() {
  if (!game || !networkRoom) return;
  const disconnected = game.seatRecords.find((record, seat) => (
    seat > 0 && record.type === 'human' && !record.connected
  ));
  if (disconnected) {
    setHint(`${disconnected.name} потерял связь. Партия сохранена, ждём возврата.`);
    return;
  }

  if (game.status === 'contract-choice') {
    if (game.currentSeat === PLAYER_SEAT) setHint('Ваш заказ. Выберите контракт для этой раздачи.');
    else setHint(`${game.playerNames[game.currentSeat]} выбирает контракт…`);
  } else if (game.status === 'playing' && game.currentSeat === PLAYER_SEAT) {
    setHint(playerHelpText());
  } else if (game.status === 'playing') {
    const record = game.seatRecords[game.currentSeat];
    setHint(record.type === 'bot' ? `${record.name} думает…` : `Ходит ${record.name}…`);
  } else if (game.status === 'trick-await') {
    const winner = game.playerNames[game.trickWinnerSeat ?? game.currentSeat];
    setHint(`${winner} берёт взятку. Нажмите в любую часть экрана.`);
  } else if (game.status === 'trick-collecting') {
    setHint('Взятка уходит к победителю…');
  } else if (game.status === 'contract-result') {
    setHint('Раздача окончена. Следующая начнётся через несколько секунд.');
  } else if (game.status === 'game-over') {
    const { winningScore, winnerSeats } = matchResult(game.scores);
    const winners = winnerSeats.map(seat => game.playerNames[seat]).join(', ');
    setHint(`${winnerSeats.length === 1 ? 'Победитель' : 'Ничья'}: ${winners}. Лучший счёт: ${formatScore(winningScore)}.`);
  }
}

function applyNetworkGame(snapshot) {
  if (!networkRoom || !Number.isInteger(networkRoom.localSeat) || networkRoom.localSeat < 0) return;
  const previousStatus = lastNetworkStatus;
  const previousTrickLength = lastNetworkTrickLength;
  networkSnapshot = snapshot;
  networkMode = true;
  el.restartButton.textContent = 'Выйти в меню';
  networkCommandPending = false;
  game = buildNetworkTableGame(snapshot, networkRoom);
  screen = 'table';
  selectedCardId = game.hands[0].some(card => card.id === selectedCardId) ? selectedCardId : null;
  inputLocked = !(
    game.status === 'trick-await'
    || (game.status === 'playing' && game.currentSeat === PLAYER_SEAT && game.legalCardIds.length > 0)
  );
  if (game.status === 'contract-choice' && game.currentSeat === PLAYER_SEAT && game.availableContractIndexes.length > 0) {
    showContractChoice();
  } else {
    closeContractDialog();
  }
  el.loadingOverlay.hidden = true;
  el.startOverlay.hidden = true;
  if (el.networkDialog.open) el.networkDialog.close();

  if (snapshot.trick.length > previousTrickLength) playCardSound();
  if (snapshot.status === 'trick-collecting' && previousStatus !== 'trick-collecting') playTrickSound();
  if (
    snapshot.status === 'playing'
    && game.currentSeat === PLAYER_SEAT
    && !(previousStatus === 'playing' && previousTrickLength === snapshot.trick.length)
  ) tg?.HapticFeedback?.notificationOccurred?.('success');
  lastNetworkStatus = snapshot.status;
  lastNetworkTrickLength = snapshot.trick.length;
  if (snapshot.status === 'game-over') networkClient.clearActiveRoom();
  describeNetworkTurn();
  render();
  scheduleNetworkAdvance(snapshot);
}

function setNetworkStatus(text, isError = false) {
  el.networkStatus.textContent = text;
  el.networkStatus.dataset.error = String(isError);
}

function makeLobbyAvatar(record) {
  if (record.photoUrl) {
    const image = document.createElement('img');
    image.src = record.photoUrl;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      const fallback = document.createElement('span');
      fallback.className = 'network-player-avatar';
      fallback.textContent = '☺';
      image.replaceWith(fallback);
    });
    return image;
  }
  const fallback = document.createElement('span');
  fallback.className = 'network-player-avatar';
  fallback.textContent = record.type === 'bot' ? 'ИИ' : record.type === 'pending' ? '?' : '☺';
  return fallback;
}

function renderNetworkLobby() {
  const room = networkRoom;
  if (!room) return;
  el.networkLobby.hidden = false;
  el.networkConnectButton.hidden = true;
  el.networkRoomCode.textContent = room.roomId;
  el.networkPlayers.replaceChildren();

  for (const record of room.seats) {
    const item = document.createElement('div');
    const ready = record.type === 'bot' || (record.type === 'human' && record.connected);
    item.className = `network-player ${ready ? 'is-ready' : 'is-waiting'}`;
    item.append(makeLobbyAvatar(record));
    const name = document.createElement('strong');
    name.textContent = record.type === 'pending' ? 'Ожидаем игрока' : record.name;
    item.append(name);
    const status = document.createElement('small');
    status.textContent = record.type === 'bot'
      ? 'Компьютер'
      : record.type === 'pending'
        ? 'Ещё не подключился'
        : record.connected
          ? (record.host ? 'Создатель · в комнате' : 'Подключился')
          : 'Связь потеряна';
    item.append(status);
    el.networkPlayers.append(item);
  }

  const pending = room.seats.filter(record => record.type === 'pending').length;
  const disconnected = room.seats.filter(record => record.type === 'human' && !record.connected).length;
  el.networkStartButton.hidden = !room.isHost;
  el.networkStartButton.disabled = !room.canStart;
  el.networkInviteButton.hidden = pending === 0;
  el.networkCopyButton.hidden = pending === 0;
  if (room.status !== 'lobby') setNetworkStatus('Партия уже началась. Возвращаемся за стол…');
  else if (room.canStart) setNetworkStatus('Все приглашённые подключились. Можно начинать.');
  else if (pending > 0) setNetworkStatus(`Ждём игроков: ${pending}. Отправьте им одну ссылку на комнату.`);
  else if (disconnected > 0) setNetworkStatus('Один из игроков потерял связь. Ждём его возврата.');
  else setNetworkStatus('Вы в комнате. Игру начнёт её создатель.');
}

function applyNetworkRoom(room) {
  networkRoom = room;
  selectedGameMode = room.mode === GAME_MODES.ORDERED ? GAME_MODES.ORDERED : GAME_MODES.CLASSIC;
  networkSetupRole = room.isHost ? 'host' : 'guest';
  renderNetworkLobby();
  if (networkSnapshot && screen === 'table') applyNetworkGame(networkSnapshot);
}

function openNetworkSetup({ role, roomId = '', displayName = '' }) {
  clearTimeout(networkAdvanceTimer);
  networkAdvanceTimer = null;
  networkClient.disconnect({ forget: false });
  networkRoom = null;
  networkSnapshot = null;
  networkCommandPending = false;
  networkSetupRole = role;
  networkSetupRoomId = roomId;
  if (role !== 'host') {
    screen = 'network-lobby';
    inputLocked = true;
    renderer?.clear(2);
    renderer?.present();
  }
  el.networkDialogTitle.textContent = role === 'host' ? 'Создать комнату' : 'Войти в комнату';
  el.networkLead.textContent = role === 'host'
    ? 'Введите имя. Затем пригласите выбранное число живых оппонентов.'
    : 'Введите имя и присоединитесь к игре.';
  el.networkNameInput.value = displayName || defaultPlayerName(tg);
  el.networkConnectButton.textContent = role === 'host' ? 'Создать комнату' : 'Присоединиться';
  el.networkConnectButton.hidden = false;
  el.networkConnectButton.disabled = false;
  el.networkLobby.hidden = true;
  setNetworkStatus('');
  if (!el.networkDialog.open) el.networkDialog.showModal();
  updatePauseState();
  el.networkNameInput.focus();
}

async function connectNetworkRoom() {
  const displayName = el.networkNameInput.value;
  el.networkConnectButton.disabled = true;
  setNetworkStatus(networkSetupRole === 'host' ? 'Создаём комнату…' : 'Входим в комнату…');
  try {
    const result = networkSetupRole === 'host'
      ? await networkClient.create({ choices: selectedSeatChoices, displayName, mode: selectedGameMode })
      : await networkClient.join({ roomId: networkSetupRoomId, displayName });
    applyNetworkRoom(result.room);
  } catch (error) {
    el.networkConnectButton.disabled = false;
    setNetworkStatus(error?.message || 'Не удалось подключиться.', true);
  }
}

function leaveNetworkView({ forget = false } = {}) {
  clearTimeout(networkAdvanceTimer);
  networkAdvanceTimer = null;
  networkClient.disconnect({ forget });
  networkMode = false;
  el.restartButton.textContent = 'Начать заново';
  networkRoom = null;
  networkSnapshot = null;
  networkCommandPending = false;
  lastNetworkStatus = '';
  lastNetworkTrickLength = 0;
  syncAvatarLayer();
}

function closeNetworkSetup() {
  const wasTable = screen === 'table' && networkMode;
  leaveNetworkView({ forget: false });
  if (el.networkDialog.open) el.networkDialog.close();
  updatePauseState();
  if (wasTable || networkSetupRole !== 'host') showStartMenu();
  else resetToPartnerPicker();
}

function startMatch() {
  leaveNetworkView({ forget: false });
  const querySeed = Number(new URLSearchParams(location.search).get('seed'));
  const seed = Number.isFinite(querySeed) && querySeed !== 0 ? querySeed : (Date.now() ^ 0x19930822);
  const characters = selectedPartnerIds.map(id => CHARACTERS[id]);
  game = {
    characters,
    playerNames: ['Товарищ', ...characters.map(character => character.name)],
    random: createSeededRandom(seed),
    mode: selectedGameMode,
    scores: [0, 0, 0, 0],
    dealScores: [0, 0, 0, 0],
    hands: [[], [], [], []],
    trick: [],
    trickWinnerSeat: null,
    trickNumber: 0,
    currentSeat: 0,
    contractIndex: selectedGameMode === GAME_MODES.ORDERED ? null : 0,
    roundNumber: 0,
    totalRounds: selectedGameMode === GAME_MODES.ORDERED ? CONTRACTS.length * 4 : CONTRACTS.length,
    ordererSeat: selectedGameMode === GAME_MODES.ORDERED ? 1 : null,
    remainingContracts: selectedGameMode === GAME_MODES.ORDERED
      ? Array.from({ length: 4 }, () => CONTRACTS.map(contract => contract.id))
      : null,
    status: selectedGameMode === GAME_MODES.ORDERED ? 'contract-choice' : 'playing',
  };
  screen = 'table';
  if (selectedGameMode === GAME_MODES.ORDERED) startOrderedRound(0);
  else startContract(0);
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
  selectedSeatChoices = [];
  selectedCardId = null;
  pointerStart = null;
  inputLocked = false;
  networkMode = false;
  syncAvatarLayer();
  render();
  setHint('Выберите трёх партнёров: один тап сразу выбирает персонажа.');
}

function showStartMenu() {
  if (!renderer) return;
  runToken += 1;
  screen = 'start';
  game = null;
  selectedPartnerIds = [];
  selectedSeatChoices = [];
  selectedCardId = null;
  pointerStart = null;
  inputLocked = true;
  const saved = loadSavedGame();
  const savedNetworkRoom = networkClient.savedRoom();
  el.loadingOverlay.hidden = true;
  el.startOverlay.hidden = false;
  el.continueButton.disabled = !saved;
  el.continueButton.setAttribute('aria-disabled', String(!saved));
  el.continueNetworkButton.hidden = !savedNetworkRoom;
  el.savedGameInfo.textContent = saved
    ? (saved.mode === GAME_MODES.ORDERED
      ? `Сохранено: заказной режим, раздача ${saved.roundNumber + 1} из ${CONTRACTS.length * 4}`
      : `Сохранено: контракт ${saved.contractIndex + 1} из ${CONTRACTS.length}`)
    : (savedNetworkRoom ? 'Можно вернуться в сетевую комнату' : 'Сохранённой игры нет');
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
  selectedGameMode = saved.mode;
  selectedPartnerIds = [...saved.selectedPartnerIds];
  selectedSeatChoices = selectedPartnerIds.map(characterId => ({ type: 'bot', characterId }));
  selectedCardId = null;
  pointerStart = null;
  const characters = selectedPartnerIds.map(id => CHARACTERS[id]);
  game = {
    characters,
    playerNames: ['Товарищ', ...characters.map(character => character.name)],
    random: createSeededRandom(saved.randomState),
    mode: saved.mode,
    scores: [...saved.scores],
    dealScores: [...saved.dealScores],
    hands: saved.hands.map(hand => [...hand]),
    trick: saved.trick.map(entry => ({ ...entry })),
    trickWinnerSeat: saved.trickWinnerSeat,
    trickNumber: saved.trickNumber,
    currentSeat: saved.currentSeat,
    contractIndex: saved.contractIndex,
    roundNumber: saved.roundNumber,
    totalRounds: saved.mode === GAME_MODES.ORDERED ? CONTRACTS.length * 4 : CONTRACTS.length,
    ordererSeat: saved.ordererSeat,
    remainingContracts: saved.remainingContracts?.map(list => [...list]) ?? null,
    status: saved.status,
  };
  screen = 'table';
  inputLocked = true;
  el.startOverlay.hidden = true;

  if (game.status === 'contract-choice') {
    render();
    void continueContractChoice(token, 260);
    return;
  }
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
    if (pendingInviteRoomId) {
      openNetworkSetup({ role: 'guest', roomId: pendingInviteRoomId });
      setHint('Вы перешли по пригласительной ссылке. Введите имя, чтобы войти.');
    } else showStartMenu();
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
  paused = document.hidden
    || el.rulesDialog.open
    || el.aboutDialog.open
    || el.networkDialog.open
    || el.modeDialog.open
    || el.contractDialog.open;
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

function closeContractDialog() {
  if (el.contractDialog.open) el.contractDialog.close();
}

function showContractChoice() {
  if (!game || game.status !== 'contract-choice' || game.currentSeat !== PLAYER_SEAT) return;
  const available = networkMode
    ? game.availableContractIndexes
    : (game.remainingContracts?.[PLAYER_SEAT] || []);
  el.contractChoiceTitle.textContent = 'Заказать контракт';
  el.contractChoiceLead.textContent = `Раздача ${game.roundNumber + 1} из ${game.totalRounds || CONTRACTS.length * 4}. Этот контракт больше нельзя будет заказать вам ещё раз.`;
  el.contractChoices.replaceChildren();
  for (const index of available) {
    const contract = CONTRACTS[index];
    if (!contract) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.contractIndex = String(index);
    button.textContent = `${contract.titleLines[0]} ${contract.titleLines[1]} (${contract.titleLines[2]})`;
    el.contractChoices.append(button);
  }
  if (!el.contractDialog.open) el.contractDialog.showModal();
  updatePauseState();
}

function openModeSelection() {
  if (!el.modeDialog.open) el.modeDialog.showModal();
  updatePauseState();
}

function chooseGameMode(mode) {
  selectedGameMode = mode === GAME_MODES.ORDERED ? GAME_MODES.ORDERED : GAME_MODES.CLASSIC;
  if (el.modeDialog.open) el.modeDialog.close();
  updatePauseState();
  resetToPartnerPicker();
}

el.continueButton.addEventListener('click', continueSavedGame);
el.continueNetworkButton.addEventListener('click', () => {
  const saved = networkClient.savedRoom();
  if (!saved) {
    showStartMenu();
    return;
  }
  openNetworkSetup({ role: 'guest', roomId: saved.roomId, displayName: saved.displayName });
});
el.newGameButton.addEventListener('click', openModeSelection);
el.classicModeButton.addEventListener('click', () => chooseGameMode(GAME_MODES.CLASSIC));
el.orderedModeButton.addEventListener('click', () => chooseGameMode(GAME_MODES.ORDERED));
el.modeDialog.addEventListener('close', updatePauseState);
el.contractDialog.addEventListener('close', updatePauseState);
el.contractDialog.addEventListener('cancel', event => event.preventDefault());
el.contractChoices.addEventListener('click', event => {
  const button = event.target?.closest?.('button[data-contract-index]');
  if (!button || !game || game.status !== 'contract-choice') return;
  const contractIndex = Number(button.dataset.contractIndex);
  if (!Number.isInteger(contractIndex)) return;
  if (networkMode) {
    networkCommandPending = true;
    if (!networkClient.chooseContract(contractIndex)) networkCommandPending = false;
  } else activateOrderedContract(contractIndex);
});
el.restartButton.addEventListener('click', () => {
  if (networkMode) {
    leaveNetworkView({ forget: false });
    showStartMenu();
    return;
  }
  resetToPartnerPicker();
});
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
el.networkDialog.addEventListener('close', updatePauseState);
el.networkDialog.addEventListener('cancel', event => {
  event.preventDefault();
  closeNetworkSetup();
});

el.networkConnectButton.addEventListener('click', () => {
  void connectNetworkRoom();
});
el.networkCloseButton.addEventListener('click', closeNetworkSetup);
el.networkStartButton.addEventListener('click', () => {
  if (networkRoom?.canStart) networkClient.startGame();
});
el.networkNameInput.addEventListener('change', () => {
  if (networkRoom) networkClient.setName(el.networkNameInput.value);
});
el.networkInviteButton.addEventListener('click', () => {
  const shareUrl = networkClient.shareUrl();
  if (!shareUrl) {
    setNetworkStatus('Не задана ссылка Telegram Mini App. Проверьте BOT_USERNAME и APP_SHORT_NAME.', true);
    return;
  }
  if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
  else window.open?.(shareUrl, '_blank', 'noopener,noreferrer');
});
el.networkCopyButton.addEventListener('click', async () => {
  const inviteLink = networkClient.inviteLink();
  if (!inviteLink) {
    setNetworkStatus('Не удалось собрать ссылку на комнату.', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(inviteLink);
    setNetworkStatus('Ссылка скопирована.');
  } catch {
    setNetworkStatus('Браузер не дал скопировать ссылку. Используйте кнопку приглашения.', true);
  }
});

networkClient
  .on('room', applyNetworkRoom)
  .on('game', applyNetworkGame)
  .on('error', message => {
    networkCommandPending = false;
    if (screen === 'table' && networkMode) {
      inputLocked = !(game?.status === 'trick-await' || (game?.status === 'playing' && game.currentSeat === 0));
      setHint(message);
      render();
    } else setNetworkStatus(message, true);
  })
  .on('connection', state => {
    if (state === 'reconnecting') {
      if (screen === 'table' && networkMode) setHint('Связь пропала. Возвращаемся в комнату…');
      else setNetworkStatus('Связь пропала. Повторяем подключение…');
    } else if (state === 'connecting' && !networkRoom) {
      setNetworkStatus('Подключаемся к комнате…');
    }
  });

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
      selectedSeatChoices: selectedSeatChoices.map(choice => ({ ...choice })),
      selectedCardId,
      inputLocked,
      networkMode,
      selectedGameMode,
      networkRoom: networkRoom ? {
        roomId: networkRoom.roomId,
        localSeat: networkRoom.localSeat,
        isHost: networkRoom.isHost,
        canStart: networkRoom.canStart,
        seats: networkRoom.seats.map(record => ({ ...record })),
      } : null,
      game: game ? {
        mode: game.mode,
        status: game.status,
        contractIndex: game.contractIndex,
        roundNumber: game.roundNumber,
        ordererSeat: game.ordererSeat,
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
        legalPlayerCardIds: game.status === 'playing' && game.contractIndex !== null
          ? (networkMode
            ? [...(game.legalCardIds || [])]
            : legalCards(game.hands[0], game.trick, CONTRACTS[game.contractIndex]).map(card => card.id))
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
