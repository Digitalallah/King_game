import {
  delay,
  DOSBOX_CONF,
  isPartnerSelectionFrame,
  mapBrowserKeyCode,
  ORIGINAL_HEIGHT,
  ORIGINAL_WIDTH,
  passOriginalPrompts,
  synchronizeOriginalPointer,
} from './original-config.js';

const tg = window.Telegram?.WebApp;
const emulator = window.emulators;

const el = {
  canvas: document.querySelector('#gameCanvas'),
  stage: document.querySelector('#gameStage'),
  loadingOverlay: document.querySelector('#loadingOverlay'),
  loadingText: document.querySelector('#loadingText'),
  loadingBar: document.querySelector('#loadingBar'),
  retryButton: document.querySelector('#retryButton'),
  restartButton: document.querySelector('#restartButton'),
  zoomButton: document.querySelector('#zoomButton'),
  fullscreenButton: document.querySelector('#fullscreenButton'),
  hint: document.querySelector('#gameHint'),
};

const context = el.canvas.getContext('2d', { alpha: false });
context.imageSmoothingEnabled = false;

let client = null;
let bootGeneration = 0;
let latestRgb = null;
let frameWidth = ORIGINAL_WIDTH;
let frameHeight = ORIGINAL_HEIGHT;
let rgbaFrame = new Uint8ClampedArray(ORIGINAL_WIDTH * ORIGINAL_HEIGHT * 4);
let archiveBufferPromise = null;
let readyForInput = false;
let pointerTapInProgress = false;

function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.disableVerticalSwipes?.();
  tg.setHeaderColor?.('#000000');
  tg.setBackgroundColor?.('#001600');
}

function updateFullscreenButton() {
  const fullscreen = Boolean(tg?.isFullscreen || document.fullscreenElement);
  el.fullscreenButton.textContent = fullscreen ? 'Выйти из полного экрана' : 'На весь экран';
}

function setLoading(text, progress) {
  el.loadingText.textContent = text;
  if (Number.isFinite(progress)) {
    el.loadingBar.style.width = `${Math.max(8, Math.min(100, progress))}%`;
  }
}

function showLoading() {
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

function renderRgb(rgb, width, height) {
  if (!rgb || width <= 0 || height <= 0) return;
  if (el.canvas.width !== width || el.canvas.height !== height) {
    el.canvas.width = width;
    el.canvas.height = height;
    rgbaFrame = new Uint8ClampedArray(width * height * 4);
    context.imageSmoothingEnabled = false;
  }

  for (let source = 0, target = 0; source < rgb.length; source += 3, target += 4) {
    rgbaFrame[target] = rgb[source];
    rgbaFrame[target + 1] = rgb[source + 1];
    rgbaFrame[target + 2] = rgb[source + 2];
    rgbaFrame[target + 3] = 255;
  }

  context.putImageData(new ImageData(rgbaFrame, width, height), 0, 0);
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
    renderRgb(rgb, image.width, image.height);
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

  // The worker transfers (and therefore detaches) the bundle buffer. Keep the
  // cached response intact and give every launch its own disposable copy.
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

async function waitForPartnerSelection(generation, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (generation !== bootGeneration) throw new Error('Запуск отменён.');
    if (isPartnerSelectionFrame(latestRgb, frameWidth, frameHeight, 3)) return true;
    await delay(100);
  }
  return false;
}

async function stopCurrentGame() {
  const previous = client;
  client = null;
  readyForInput = false;
  pointerTapInProgress = false;
  latestRgb = null;
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
    await delay(650);
    await passOriginalPrompts(activeClient);
    const selectionReady = await waitForPartnerSelection(generation);

    if (generation !== bootGeneration) return;
    readyForInput = true;
    el.loadingOverlay.hidden = true;
    el.canvas.focus({ preventScroll: true });
    el.hint.textContent = selectionReady
      ? 'Выберите касанием трёх партнёров. Затем игра начнётся автоматически.'
      : 'Автозапуск не распознал экран. Если видна заставка, нажмите «Начать заново».';
    tg?.HapticFeedback?.notificationOccurred?.('success');
  } catch (error) {
    if (generation === bootGeneration && !/отменён/i.test(error?.message || '')) showError(error);
  }
}

function pointerPosition(event) {
  const rect = el.canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  };
}

function moveOriginalPointer(event) {
  if (!client || !readyForInput) return;
  const { x, y } = pointerPosition(event);
  client.sendMouseMotion(x, y);
}

el.canvas.addEventListener('pointermove', event => {
  if (pointerTapInProgress) return;
  moveOriginalPointer(event);
  event.preventDefault();
});

el.canvas.addEventListener('pointerdown', event => {
  if (!client || !readyForInput || pointerTapInProgress) return;
  const activeClient = client;
  const generation = bootGeneration;
  const { x, y } = pointerPosition(event);
  pointerTapInProgress = true;
  event.preventDefault();

  void (async () => {
    try {
      await synchronizeOriginalPointer(activeClient);
      if (client !== activeClient || generation !== bootGeneration || !readyForInput) return;
      activeClient.sendMouseMotion(x, y);
      await delay(55);
      if (client !== activeClient || generation !== bootGeneration || !readyForInput) return;
      activeClient.sendMouseButton(0, true);
      tg?.HapticFeedback?.impactOccurred?.('light');
      await delay(45);
      activeClient.sendMouseButton(0, false);
      await delay(120);
    } catch (error) {
      console.warn('Could not send pointer tap.', error);
    } finally {
      if (generation === bootGeneration) pointerTapInProgress = false;
    }
  })();
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
  else client.resume();
});

el.restartButton.addEventListener('click', startGame);
el.retryButton.addEventListener('click', startGame);

el.zoomButton.addEventListener('click', () => {
  const enabled = el.stage.classList.toggle('native-scale');
  el.zoomButton.setAttribute('aria-pressed', String(enabled));
  el.zoomButton.textContent = enabled ? 'Вписать в экран' : 'Масштаб 1:1';
});

el.fullscreenButton.addEventListener('click', async () => {
  try {
    if (tg?.isVersionAtLeast?.('8.0') && tg.requestFullscreen) {
      if (tg.isFullscreen) tg.exitFullscreen();
      else tg.requestFullscreen();
      return;
    }
    if (!document.fullscreenElement) await el.stage.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    console.warn('Fullscreen is not available.', error);
    el.hint.textContent = 'Полноэкранный режим недоступен в этом окне Telegram.';
  }
});

tg?.onEvent?.('fullscreenChanged', updateFullscreenButton);
document.addEventListener('fullscreenchange', updateFullscreenButton);

window.addEventListener('beforeunload', () => {
  if (client) client.exit();
});

initTelegram();
startGame();
