const ORIGINAL_ENTRYPOINT = './original/index.html';
const tg = window.Telegram?.WebApp;

const frame = document.querySelector('#gameFrame');
const fallback = document.querySelector('#fallback');

function initTelegramMiniApp() {
  if (!tg) return;

  tg.ready();
  tg.expand();
  tg.disableVerticalSwipes?.();

  const backgroundColor = tg.themeParams.bg_color || '#000000';
  const textColor = tg.themeParams.text_color || '#ffffff';

  document.documentElement.style.setProperty('--tg-bg', backgroundColor);
  document.documentElement.style.setProperty('--tg-text', textColor);
  tg.setBackgroundColor?.(backgroundColor);
  tg.setHeaderColor?.(backgroundColor);
}

async function originalBuildExists() {
  try {
    const response = await fetch(ORIGINAL_ENTRYPOINT, { method: 'HEAD', cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}

function showFallback() {
  frame.hidden = true;
  fallback.hidden = false;
}

async function boot() {
  initTelegramMiniApp();

  if (!(await originalBuildExists())) {
    showFallback();
  }
}

frame.addEventListener('load', () => {
  tg?.HapticFeedback?.impactOccurred?.('light');
});

boot();
