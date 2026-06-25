export { GameRoom } from './game-room.js';

const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const API_PREFIX = '/api/';
const ROOMS_BINDING = 'GAME_ROOM';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith(API_PREFIX)) {
      return handleApiRequest(request, env, url);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};

async function handleApiRequest(request, env, url) {
  try {
    if (request.method === 'OPTIONS') return corsResponse(null, 204);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true, binding: ROOMS_BINDING, hasGameRooms: Boolean(env[ROOMS_BINDING]) });
    }

    if (url.pathname === '/api/rooms') {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      return createRoom(request, env, url);
    }

    const wsMatch = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)\/ws$/);
    if (wsMatch && request.method === 'GET') {
      const auth = await authenticateTelegram(request, env);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status || 401);
      const roomId = wsMatch[1];
      const binding = gameRoomsBinding(env);
      const id = binding.idFromName(roomId);
      const room = binding.get(id);
      const upstream = new Request(`${url.origin}/room/${roomId}/ws`, request);
      upstream.headers.set('x-king-user', JSON.stringify(auth.user));
      return room.fetch(upstream);
    }

    return json({ ok: false, error: 'API route not found' }, 404);
  } catch (error) {
    console.error('Worker API failed', error?.stack || error);
    return json({ ok: false, error: error?.message || 'Internal error', stack: error?.stack || '' }, 500);
  }
}

async function createRoom(request, env, url) {
  const binding = gameRoomsBinding(env);
  const auth = await authenticateTelegram(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status || 401);

  const roomId = makeRoomId();
  const id = binding.idFromName(roomId);
  const room = binding.get(id);
  const response = await room.fetch(new Request(`${url.origin}/room/${roomId}/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomId, user: auth.user }),
  }));

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GameRoom create failed: HTTP ${response.status} ${body}`);
  }

  return json({ ok: true, roomId });
}

function gameRoomsBinding(env) {
  const binding = env?.[ROOMS_BINDING];
  if (!binding || typeof binding.idFromName !== 'function' || typeof binding.get !== 'function') {
    throw new Error(`Durable Object binding ${ROOMS_BINDING} is missing or invalid.`);
  }
  return binding;
}

function methodNotAllowed(allow) {
  return json({ ok: false, error: `Method not allowed. Use ${allow}.` }, 405, { Allow: allow });
}

function makeRoomId(length = 6) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => ROOM_ID_ALPHABET[byte % ROOM_ID_ALPHABET.length]).join('');
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

function corsResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      Allow: 'GET, POST, OPTIONS',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-telegram-init-data, x-king-dev-auth, x-king-dev-user',
      'access-control-max-age': '86400',
    },
  });
}

async function authenticateTelegram(request, env) {
  const url = new URL(request.url);
  const bodyInitData = await readInitDataFromBody(request);
  const initData = request.headers.get('x-telegram-init-data') || url.searchParams.get('initData') || bodyInitData || '';

  if (initData && env.BOT_TOKEN) {
    const user = await verifyInitData(initData, env.BOT_TOKEN);
    if (user) return { ok: true, user };
  }

  const devEnabled = String(env.DEV_AUTH).toLowerCase() === 'true';
  const devRequested = request.headers.get('x-king-dev-auth') === 'true' || url.searchParams.get('dev') === '1';
  if (devEnabled && (devRequested || !env.BOT_TOKEN)) {
    const devUser = request.headers.get('x-king-dev-user') || url.searchParams.get('devUser') || `dev-${crypto.randomUUID()}`;
    return {
      ok: true,
      user: {
        id: `dev:${devUser}`,
        name: url.searchParams.get('devName') || 'Dev Player',
        photoUrl: '',
        isDev: true,
      },
    };
  }

  return { ok: false, status: 401, error: 'Telegram initData is missing or invalid.' };
}

async function readInitDataFromBody(request) {
  if (request.method !== 'POST') return '';
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return '';
  try {
    const body = await request.clone().json();
    return typeof body?.initData === 'string' ? body.initData : '';
  } catch {
    return '';
  }
}

async function verifyInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  const authDate = Number(params.get('auth_date') || 0);
  if (!hash || !authDate) return null;
  if (Math.floor(Date.now() / 1000) - authDate > 86400) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = await crypto.subtle.importKey('raw', new TextEncoder().encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const tokenKey = await crypto.subtle.sign('HMAC', secret, new TextEncoder().encode(botToken));
  const key = await crypto.subtle.importKey('raw', tokenKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataCheckString));
  if (hex(signature) !== hash) return null;
  const tgUser = JSON.parse(params.get('user') || '{}');
  if (!tgUser.id) return null;
  return {
    id: `tg:${tgUser.id}`,
    name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUser.username || 'Игрок',
    username: tgUser.username || '',
    photoUrl: tgUser.photo_url || '',
  };
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
