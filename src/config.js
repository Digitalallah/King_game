export const TELEGRAM_CONFIG = {
  botUsername: 'KingIgraBot',
  appName: 'King',
};

export const NETWORK_CONFIG = {
  // Только для локальной разработки без Telegram initData.
  // В продакшене оставьте false и включайте доступ через валидный Telegram Mini App.
  devAuth: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
};
