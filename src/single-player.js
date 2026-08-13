import {
  delay,
  DOSBOX_CONF,
  isGameTableFrame,
  isPartnerSelectionFrame,
  mapBrowserKeyCode,
  moveOriginalPointer,
  ORIGINAL_HEIGHT,
  ORIGINAL_WIDTH,
  passOriginalPrompts,
} from './original-config.js?v=single-player-2';
import {
  detectPlayerCardSlots,
  partnerAtPoint,
  playerCardAtPoint,
} from './input-controller.js?v=single-player-2';

const tg = window.Telegram?.WebApp;
const emulator = window.emulators;

const el = {
  canvas: document.querySelector('#gameCanvas'),
  inputOverlay: document.querySelector('#inputOverlay'),
  loadingOverlay: document.querySelector('#loadingOverlay'),
  loadingText: document.querySelector('#loadingText'),
  loadingBar: document.querySelector('#loadingBar'),
  retryButton: document.querySelector('#retryButton'),
  restartButton: document.querySelector('#restartButton'),
  rulesButton: document.querySelector('#rulesButton'),
  aboutButton: document.querySelector('#aboutButton'),
  rulesDialog: document.querySelector('#rulesDialog'),
  aboutDialog: document.querySelector('#aboutDialog'),
  aboutLink: document.querySelector('#aboutDialog a[href^="https://t.me/"]'),
  hint: document.querySelector('#gameHint'),
};

const context = el.canvas.getContext('2d', { alpha: false });
const overlayContext = el.inputOverlay.getContext('2d');
context.imageSmoothingEnabled = false;
overlayContext.imageSmoothingEnabled = false;

const CARD_LIFT = 10;
const TAP_MOVE_LIMIT = 16;

let client = null;
let bootGeneration = 0;
let latestRgb = null;
let frameWidth = ORIGINAL_WIDTH;
let frameHeight = ORIGINAL_HEIGHT;
let rgbaFrame = new Uint8ClampedArray(ORIGINAL_WIDTH * ORIGINAL_HEIGHT * 4);
let archiveBufferPromise = null;
let readyForInput = false;
let pointerTapInProgress = false;
let renderPaused = false;
let ignoredFramesAfterClick = 0;
let selectedCard = null;
let selectedPartners = new Set();
let pointerStart = null;

function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.disableVerticalSwipes?.();
  tg.setHeaderColor?.('#000000');
  tg.setBackgroundColor?.('#001600');
}

function setLoading(text, progress) {
  el.loadingText.textContent = text;
  if (Number.isFinite(progress)) {
    el.loadingBar.style.width = `${Math.max(8, Math.min(100, progress))}%`;
  }
}

function clearCardSelection(render = true) {
  selectedCard = null;
  if (render) renderInputOverlay();
}

function showLoading() {
  clearCardSelection();
  el.loadingOverlay.hidden = false;
  el.retryButton.hidden = true;
  setLoading('Запускаем оригинальную игру…', 8);
}

function showError(error) {
  console.error(error);
  readyForInput = false;
  el.loadingOverlay.hidden = false;
  el.retryButton.hidden = false;
  setLoading(`Не удалось запустить игру: ${error?.message || error}`, 100);
  el.hint.textContent = 'Нажмите «Повторить запуск». Если ошибка повторится, откройте игру заново.';
}

function renderInputOverlay() {
  overlayContext.clearRect(0, 0, el.inputOverlay.width, el.inputOverlay.height);
  if (!selectedCard) return;

  const width = Math.max(8, selectedCard.right - selectedCard.left);
  const height = Math.min(selectedCard.bottom - selectedCard.top, ORIGINAL_HEIGHT - selectedCard.top);
  const liftedTop = selectedCard.top - CARD_LIFT;

  overlayContext.save();
  overlayContext.imageSmoothingEnabled = false;
  overlayContext.drawImage(
    el.canvas,
    selectedCard.left,
    selectedCard.top,
    width,
    height,
    selectedCard.left,
    liftedTop,
    width,
    height,
  );
  overlayContext.fillStyle = 'rgba(255, 255, 0, 0.12)';
  overlayContext.fillRect(selectedCard.left, liftedTop, width, height);
  overlayContext.strokeStyle = '#ffff00';
  overlayContext.lineWidth = 2;
  overlayContext.strokeRect(selectedCard.left + 1, liftedTop + 1, width - 2, height - 2);
  overlayContext.restore();
}

function renderRgb(rgb, width, height) {
  if (!rgb || width <= 0 || height <= 0) return;
  if (el.canvas.width !== width || el.canvas.height !== height) {
    el.canvas.width = width;
    el.canvas.height = height;
    el.inputOverlay.width = width;
    el.inputOverlay.height = height;
    rgbaFrame = new Uint8ClampedArray(width * height * 4);
    context.imageSmoothingEnabled = false;
    overlayContext.imageSmoothingEnabled = false;
  }

  for (let source = 0, target = 0; source < rgb.length; source += 3, target += 4) {
    rgbaFrame[target] = rgb[source];
    rgbaFrame[target + 1] = rgb[source + 1];
    rgbaFrame[target + 2] = rgb[source + 2];
    rgbaFrame[target + 3] = 255;
  }

  context.putImageData(new ImageData(rgbaFrame, width, height), 0, 0);
  renderInputOverlay();
}

async function renderSnapshot(activeClient) {
  try {
    const image = await activeClient.screenshot();
    const rgb = new Uint8Array(image.width * image.height * 3);
    for (let source = 0, target = 0; source < image.data.length; source += 4, target += 3) {
      rgb[target] = image.data[source];
      rgb[target + 1] = image.data[source + 1];
      rgb[target + 2] = image.data[source + 2];
    }
    latestRgb = rgb;
    frameWidth = image.width;
    frameHeight = image.height;
    if (!renderPaused) renderRgb(rgb, image.width, image.height);
  } catch {
    // The first frame can arrive a few milliseconds after the emulator is ready.
  }
}

function attachEmulatorEvents(activeClient, generation) {
  activeClient.events().onFrameSize((width, height) => {
    if (generation !== bootGeneration) return;
    frameWidth = width;
    frameHeight = height;
  });

  activeClient.events().onFrame(rgb => {
    if (generation !== bootGeneration || !rgb) return;
    if (renderPaused) return;
    if (ignoredFramesAfterClick > 0) {
      ignoredFramesAfterClick -= 1;
      return;
    }
    latestRgb = rgb;
    renderRgb(rgb, frameWidth, frameHeight);
  });
}

async function fetchOriginalArchive() {
  if (!archiveBufferPromise) {
    archiveBufferPromise = fetch(new URL('../kingrus.zip', import.meta.url), { cache: 'force-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`архив игры недоступен (HTTP ${response.status})`);
        return response.arrayBuffer();
      })
      .catch(error => {
        archiveBufferPromise = null;
        throw error;
      });
  }

  return new Uint8Array((await archiveBufferPromise).slice(0));
}

async function createEmulator(archive) {
  const makeInit = () => [
    archive.slice(),
    { dosboxConf: DOSBOX_CONF, jsdosConf: { version: emulator.version } },
  ];
  const options = {
    onExtractProgress: (_bundleIndex, file, extracted, total) => {
      const ratio = total > 0 ? extracted / total : 0;
      setLoading(`Распаковываем ${file || 'игру'}…`, 18 + ratio * 34);
    },
  };

  try {
    return await emulator.dosboxWorker(makeInit(), options);
  } catch (workerError) {
    console.warn('Worker backend failed, using direct backend.', workerError);
    return emulator.dosboxDirect(makeInit(), options);
  }
}

async function waitForOriginalFrame(activeClient, generation, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (generation !== bootGeneration) throw new Error('Запуск отменён.');
    await renderSnapshot(activeClient);
    if (frameWidth === ORIGINAL_WIDTH && frameHeight === ORIGINAL_HEIGHT && latestRgb) return;
    await delay(100);
  }
  throw new Error('оригинальное игровое поле не появилось');
}

async function waitForPartnerSelection(generation, timeoutMs = 9000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (generation !== bootGeneration) throw new Error('Запуск отменён.');
    if (isPartnerSelectionFrame(latestRgb, frameWidth, frameHeight, 3)) return true;
    await delay(100);
  }
  return false;
}

async function performOriginalClick(activeClient, generation, x, y, settleAfter = 360) {
  renderPaused = true;
  let clicked = false;

  try {
    await moveOriginalPointer(activeClient, x, y, 65);
    if (generation !== bootGeneration || client !== activeClient || !readyForInput) return false;
    activeClient.sendMouseButton(0, true);
    tg?.HapticFeedback?.impactOccurred?.('light');
    await delay(48);
    activeClient.sendMouseButton(0, false);
    clicked = true;
    await delay(settleAfter);
  } finally {
    if (generation === bootGeneration && client === activeClient) {
      ignoredFramesAfterClick = 2;
    }
    renderPaused = false;
  }

  return clicked;
}

async function stopCurrentGame() {
  const previous = client;
  client = null;
  readyForInput = false;
  pointerTapInProgress = false;
  pointerStart = null;
  latestRgb = null;
  ignoredFramesAfterClick = 0;
  selectedPartners = new Set();
  clearCardSelection();
  if (previous) {
    try {
      await previous.exit();
    } catch (error) {
      console.warn('Could not stop previous emulator instance.', error);
    }
  }
}

async function startGame() {
  const generation = ++bootGeneration;
  showLoading();
  el.hint.textContent = 'Загружаем оригинальную версию 1993 года…';
  await stopCurrentGame();

  try {
    if (!emulator) throw new Error('модуль DOS-эмулятора не загрузился');
    emulator.pathPrefix = new URL('../vendor/emulators/', import.meta.url).href;

    setLoading('Читаем оригинальные файлы…', 12);
    const archive = await fetchOriginalArchive();
    if (generation !== bootGeneration) return;

    setLoading('Запускаем KING.EXE…', 54);
    const activeClient = await createEmulator(archive);
    if (generation !== bootGeneration) {
      await activeClient.exit();
      return;
    }

    client = activeClient;
    activeClient.mute();
    attachEmulatorEvents(activeClient, generation);
    await waitForOriginalFrame(activeClient, generation);

    setLoading('Пропускаем служебную заставку…', 72);
    await delay(700);
    await passOriginalPrompts(activeClient, 85);
    const selectionReady = await waitForPartnerSelection(generation);

    if (generation !== bootGeneration) return;
    readyForInput = true;
    el.loadingOverlay.hidden = true;
    el.canvas.focus({ preventScroll: true });
    el.hint.textContent = selectionReady
      ? 'Выберите трёх партнёров: один тап сразу выбирает персонажа.'
      : 'Автозапуск не распознал экран. Если видна заставка, нажмите «Начать заново».';
    tg?.HapticFeedback?.notificationOccurred?.('success');
  } catch (error) {
    if (generation === bootGeneration && !/отменён/i.test(error?.message || '')) showError(error);
  }
}

function logicalPointerPosition(event) {
  const rect = el.canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(ORIGINAL_WIDTH - 1, (event.clientX - rect.left) * ORIGINAL_WIDTH / rect.width)),
    y: Math.max(0, Math.min(ORIGINAL_HEIGHT - 1, (event.clientY - rect.top) * ORIGINAL_HEIGHT / rect.height)),
  };
}

function cardHelpText() {
  return 'Коснитесь карты один раз, чтобы выбрать её, и второй раз — чтобы сделать ход.';
}

async function waitForTableAfterSelection(generation, timeoutMs = 1400) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && generation === bootGeneration) {
    if (isGameTableFrame(latestRgb, frameWidth, frameHeight, 3)) return true;
    await delay(50);
  }
  return false;
}

async function waitForHandChange(previousCount, generation, timeoutMs = 1200) {
  const deadline = Date.now() + timeoutMs;
  let slots = detectPlayerCardSlots(latestRgb, frameWidth, frameHeight, 3);

  while (Date.now() < deadline && generation === bootGeneration) {
    slots = detectPlayerCardSlots(latestRgb, frameWidth, frameHeight, 3);
    if (slots.length < previousCount) return slots;
    await delay(50);
  }

  return slots;
}

async function handlePartnerTap(activeClient, generation, x, y) {
  const partner = partnerAtPoint(x, y);
  if (!partner) {
    el.hint.textContent = 'Коснитесь изображения нужного персонажа.';
    return;
  }
  if (selectedPartners.has(partner.index)) {
    el.hint.textContent = 'Этот партнёр уже выбран. Коснитесь другого персонажа.';
    return;
  }

  selectedPartners.add(partner.index);
  const isLastPartner = selectedPartners.size === 3;
  await performOriginalClick(activeClient, generation, partner.x, partner.y, isLastPartner ? 950 : 380);
  if (isLastPartner) await waitForTableAfterSelection(generation);

  if (isGameTableFrame(latestRgb, frameWidth, frameHeight, 3)) {
    clearCardSelection();
    el.hint.textContent = cardHelpText();
  } else {
    const remaining = Math.max(0, 3 - selectedPartners.size);
    el.hint.textContent = remaining > 0
      ? `Партнёр выбран. Осталось выбрать: ${remaining}.`
      : 'Начинаем раздачу…';
  }
}

async function handleCardTap(activeClient, generation, x, y) {
  const slots = detectPlayerCardSlots(latestRgb, frameWidth, frameHeight, 3);
  const tappedCard = playerCardAtPoint(slots, x, y);
  if (!tappedCard) {
    clearCardSelection();
    el.hint.textContent = cardHelpText();
    return;
  }

  if (!selectedCard || selectedCard.left !== tappedCard.left) {
    selectedCard = tappedCard;
    renderInputOverlay();
    el.hint.textContent = 'Карта выбрана. Коснитесь её ещё раз, чтобы положить на стол.';
    tg?.HapticFeedback?.selectionChanged?.();
    return;
  }

  const beforeCount = slots.length;
  clearCardSelection();
  await performOriginalClick(activeClient, generation, tappedCard.clickX, tappedCard.clickY, 520);
  const updatedSlots = await waitForHandChange(beforeCount, generation);

  if (updatedSlots.length < beforeCount) {
    el.hint.textContent = 'Ход принят. Дождитесь следующего хода.';
    return;
  }

  const sameCard = updatedSlots.find(slot => slot.left === tappedCard.left);
  if (sameCard) {
    selectedCard = sameCard;
    renderInputOverlay();
  }
  el.hint.textContent = 'Этой картой сейчас нельзя ходить. Выберите допустимую карту.';
  tg?.HapticFeedback?.notificationOccurred?.('error');
}

async function handleCanvasTap(x, y) {
  if (!client || !readyForInput || pointerTapInProgress) return;
  const activeClient = client;
  const generation = bootGeneration;
  pointerTapInProgress = true;

  try {
    if (isPartnerSelectionFrame(latestRgb, frameWidth, frameHeight, 3)) {
      await handlePartnerTap(activeClient, generation, x, y);
    } else if (isGameTableFrame(latestRgb, frameWidth, frameHeight, 3)) {
      await handleCardTap(activeClient, generation, x, y);
    } else {
      clearCardSelection();
      await performOriginalClick(activeClient, generation, x, y, 420);
    }
  } catch (error) {
    console.warn('Could not handle tap.', error);
    el.hint.textContent = 'Не удалось обработать касание. Попробуйте ещё раз.';
  } finally {
    if (generation === bootGeneration) pointerTapInProgress = false;
  }
}

el.canvas.addEventListener('pointerdown', event => {
  if (!event.isPrimary || !client || !readyForInput || pointerTapInProgress) return;
  const point = logicalPointerPosition(event);
  pointerStart = { pointerId: event.pointerId, ...point };
  el.canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});

el.canvas.addEventListener('pointerup', event => {
  if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;
  const start = pointerStart;
  const point = logicalPointerPosition(event);
  pointerStart = null;
  el.canvas.releasePointerCapture?.(event.pointerId);
  event.preventDefault();

  if (Math.hypot(point.x - start.x, point.y - start.y) <= TAP_MOVE_LIMIT) {
    void handleCanvasTap(point.x, point.y);
  }
});

el.canvas.addEventListener('pointercancel', () => {
  pointerStart = null;
});
el.canvas.addEventListener('contextmenu', event => event.preventDefault());

window.addEventListener('keydown', event => {
  if (!client || !readyForInput || document.activeElement !== el.canvas) return;
  client.sendKeyEvent(mapBrowserKeyCode(event.keyCode), true);
  event.preventDefault();
});

window.addEventListener('keyup', event => {
  if (!client || !readyForInput || document.activeElement !== el.canvas) return;
  client.sendKeyEvent(mapBrowserKeyCode(event.keyCode), false);
  event.preventDefault();
});

document.addEventListener('visibilitychange', () => {
  if (!client) return;
  if (document.hidden) client.pause();
  else if (!el.rulesDialog.open && !el.aboutDialog.open) client.resume();
});

function openInfoDialog(dialog) {
  client?.pause();
  dialog.showModal();
}

function resumeAfterDialog() {
  if (client && !document.hidden && !el.rulesDialog.open && !el.aboutDialog.open) client.resume();
}

el.restartButton.addEventListener('click', startGame);
el.retryButton.addEventListener('click', startGame);
el.rulesButton.addEventListener('click', () => openInfoDialog(el.rulesDialog));
el.aboutButton.addEventListener('click', () => openInfoDialog(el.aboutDialog));
el.rulesDialog.addEventListener('close', resumeAfterDialog);
el.aboutDialog.addEventListener('close', resumeAfterDialog);

el.aboutLink.addEventListener('click', event => {
  if (!tg?.openTelegramLink) return;
  event.preventDefault();
  tg.openTelegramLink(el.aboutLink.href);
});

window.addEventListener('beforeunload', () => {
  if (client) client.exit();
});

initTelegram();
startGame();
