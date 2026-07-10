(() => {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;

  // Telegram may provide start_param only inside raw initData on some clients.
  // Populate initDataUnsafe before the main app module reads it.
  try {
    const rawStartParam = new URLSearchParams(tg.initData || '').get('start_param');
    if (rawStartParam && tg.initDataUnsafe && !tg.initDataUnsafe.start_param) {
      tg.initDataUnsafe.start_param = rawStartParam;
    }
  } catch {
    // Keep launching even when a client exposes a read-only object.
  }

  function rewriteInviteShareUrl(value) {
    if (typeof value !== 'string') return value;

    try {
      const shareUrl = new URL(value);
      if (shareUrl.hostname !== 't.me' || shareUrl.pathname !== '/share/url') return value;

      const nestedValue = shareUrl.searchParams.get('url');
      if (!nestedValue) return value;

      const inviteUrl = new URL(nestedValue);
      const startParam = inviteUrl.searchParams.get('startapp');
      const path = inviteUrl.pathname.split('/').filter(Boolean);

      if (!startParam || path[0]?.toLowerCase() !== 'kingigrabot') return value;

      // King is configured as the bot's Main Mini App. Main Mini App links must
      // use /botusername?startapp=..., not /botusername/appname?startapp=....
      const fixedInviteUrl = new URL(`https://t.me/${path[0]}`);
      fixedInviteUrl.searchParams.set('startapp', startParam);

      const mode = inviteUrl.searchParams.get('mode');
      if (mode) fixedInviteUrl.searchParams.set('mode', mode);

      shareUrl.searchParams.set('url', fixedInviteUrl.toString());
      return shareUrl.toString();
    } catch {
      return value;
    }
  }

  const originalOpenTelegramLink = typeof tg.openTelegramLink === 'function'
    ? tg.openTelegramLink.bind(tg)
    : null;

  if (originalOpenTelegramLink) {
    try {
      tg.openTelegramLink = url => originalOpenTelegramLink(rewriteInviteShareUrl(url));
    } catch {
      // Some Telegram clients may expose a non-writable method.
    }
  }

  const originalWindowOpen = window.open.bind(window);
  window.open = (url, ...args) => originalWindowOpen(rewriteInviteShareUrl(url), ...args);
})();
