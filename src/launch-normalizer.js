(() => {
  const BUILD = 'launch-normalizer-1';
  const tg = window.Telegram?.WebApp;

  function parseHashParams() {
    const raw = String(window.location.hash || '').replace(/^#/, '');
    if (!raw) return new URLSearchParams();
    const queryIndex = raw.indexOf('?');
    return new URLSearchParams(queryIndex >= 0 ? raw.slice(queryIndex + 1) : raw);
  }

  function firstNonEmpty(candidates) {
    for (const candidate of candidates) {
      if (typeof candidate.value === 'string' && candidate.value.trim()) {
        return { value: candidate.value.trim(), source: candidate.source };
      }
    }
    return { value: '', source: 'none' };
  }

  function launchParam() {
    const search = new URLSearchParams(window.location.search);
    const hash = parseHashParams();
    let rawInit = '';
    try {
      rawInit = new URLSearchParams(tg?.initData || '').get('start_param') || '';
    } catch {
      rawInit = '';
    }

    return firstNonEmpty([
      { value: tg?.initDataUnsafe?.start_param || '', source: 'initDataUnsafe.start_param' },
      { value: rawInit, source: 'initData.start_param' },
      { value: search.get('tgWebAppStartParam') || '', source: 'query.tgWebAppStartParam' },
      { value: search.get('startapp') || '', source: 'query.startapp' },
      { value: hash.get('tgWebAppStartParam') || '', source: 'hash.tgWebAppStartParam' },
      { value: hash.get('startapp') || '', source: 'hash.startapp' },
    ]);
  }

  function roomFromValue(value) {
    const match = String(value || '').match(/^room_([A-Za-z0-9_-]+)(?:_seat_([1-4]))?$/);
    if (!match) return null;
    return {
      room: match[1],
      seat: match[2] ? Number(match[2]) - 1 : 0,
    };
  }

  const detected = launchParam();
  const parsed = roomFromValue(detected.value);
  const url = new URL(window.location.href);

  if (parsed) {
    url.searchParams.set('king_room', parsed.room);
    url.searchParams.set('king_seat', String(parsed.seat));
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  window.__KING_LAUNCH_DEBUG__ = {
    build: BUILD,
    startParam: detected.value,
    source: detected.source,
    room: parsed?.room || url.searchParams.get('king_room') || '',
    seat: parsed ? parsed.seat : Number(url.searchParams.get('king_seat') || 0),
  };

  function joinByCode() {
    const entered = window.prompt('Введите код комнаты из приглашения, например W39Q6B:');
    if (!entered) return;
    const room = entered.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!room) return;

    const seatInput = window.prompt('Номер места: 2, 3 или 4', '2');
    const seatHuman = Math.max(2, Math.min(4, Number(seatInput) || 2));
    const target = new URL(window.location.href);
    target.searchParams.set('king_room', room);
    target.searchParams.set('king_seat', String(seatHuman - 1));
    window.location.assign(target.toString());
  }

  function addDiagnostics() {
    const status = document.querySelector('#statusText');
    if (!status || document.querySelector('#kingLaunchDiagnostics')) return;

    const panel = document.createElement('div');
    panel.id = 'kingLaunchDiagnostics';
    panel.style.cssText = [
      'margin-top:10px',
      'padding:10px',
      'border:1px solid rgba(255,255,255,.18)',
      'border-radius:10px',
      'font:12px/1.35 system-ui,sans-serif',
      'opacity:.9',
      'word-break:break-word',
    ].join(';');

    const debug = window.__KING_LAUNCH_DEBUG__;
    panel.innerHTML = `
      <div><b>Сеть:</b> ${BUILD}</div>
      <div><b>start_param:</b> ${escapeHtml(debug.startParam || 'не получен')}</div>
      <div><b>источник:</b> ${escapeHtml(debug.source)}</div>
      <div><b>комната:</b> ${escapeHtml(debug.room || 'нет')} · <b>место:</b> ${Number(debug.seat) + 1}</div>
      <button id="kingJoinByCode" type="button" style="margin-top:8px;padding:8px 10px;border-radius:8px;cursor:pointer">Войти по коду комнаты</button>
    `;
    status.insertAdjacentElement('afterend', panel);
    panel.querySelector('#kingJoinByCode')?.addEventListener('click', joinByCode);
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addDiagnostics, { once: true });
  } else {
    addDiagnostics();
  }
})();
