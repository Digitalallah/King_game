export { GameRoom } from './game-room.js';

const BUILD_MARKER = 'native-network-1';
const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_JSON_BYTES = 32 * 1024;
const TELEGRAM_AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://telegram.org",
    "style-src 'self'",
    "img-src 'self' data: https://t.me https://*.t.me https://telegram.org https://*.telegram.org https://*.telegram-cdn.org",
    "connect-src 'self' wss: https://telegram.org https://*.telegram.org",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self' https://telegram.org https://*.telegram.org",
    'upgrade-insecure-requests',
  ].join('; '),
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-XSS-Protection': '0',
};

const PUBLIC_ASSET_PATH = /^(?:\/|\/index\.html|\/src\/(?:styles\.css|native-game\.js|network-client\.js|game-engine\.js|native-assets\.js)|\/assets\/native\/(?:king\.lib\.bin|king\.fnt\.bin))$/;

function withSecurityHeaders(response, extraHeaders = {}) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  headers.delete('X-Powered-By');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(body, init = {}, extraHeaders = {}) {
  return withSecurityHeaders(Response.json(body, init), {
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
}

function apiError(message, status = 400) {
  return jsonResponse({ ok: false, error: message }, { status });
}

function roomBinding(env) {
  const binding = env?.GAME_ROOM;
  if (!binding || typeof binding.idFromName !== 'function' || typeof binding.get !== 'function') {
    throw new Error('Network rooms are not configured.');
  }
  return binding;
}

function roomStub(env, roomId) {
  const binding = roomBinding(env);
  return binding.get(binding.idFromName(roomId));
}

function internalRoomRequest(origin, roomId, action, body) {
  return new Request(`${origin}/room/${roomId}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });
}

function cleanTelegramPhotoUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    const host = url.hostname.toLowerCase();
    const allowed = url.protocol === 'https:' && (
      host === 't.me'
      || host.endsWith('.t.me')
      || host === 'telegram.org'
      || host.endsWith('.telegram.org')
      || host.endsWith('.telegram-cdn.org')
    );
    return allowed ? url.href.slice(0, 1_024) : '';
  } catch {
    return '';
  }
}

function hexBytes(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export async function verifyTelegramInitData(initData, botToken, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') || '';
  const signature = hexBytes(hash);
  const authDate = Number(params.get('auth_date') || 0);
  if (!signature || !Number.isInteger(authDate)) return null;
  if (authDate > nowSeconds + 300 || nowSeconds - authDate > TELEGRAM_AUTH_MAX_AGE_SECONDS) return null;

  params.delete('hash');
  const checkString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const encoder = new TextEncoder();
  const webAppDataKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const secret = await crypto.subtle.sign('HMAC', webAppDataKey, encoder.encode(botToken));
  const verificationKey = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify('HMAC', verificationKey, signature, encoder.encode(checkString));
  if (!valid) return null;

  let telegramUser;
  try {
    telegramUser = JSON.parse(params.get('user') || '{}');
  } catch {
    return null;
  }
  if (!telegramUser?.id) return null;
  const name = [telegramUser.first_name, telegramUser.last_name]
    .filter(Boolean)
    .join(' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return {
    id: `tg:${telegramUser.id}`,
    name: name || String(telegramUser.username || 'Игрок').slice(0, 24),
    username: String(telegramUser.username || '').slice(0, 32),
    photoUrl: cleanTelegramPhotoUrl(telegramUser.photo_url),
  };
}

async function readJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) throw new Error('Ожидается JSON.');
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_JSON_BYTES) throw new Error('Слишком большой запрос.');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) throw new Error('Слишком большой запрос.');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new Error('Неверный JSON.');
  }
}

async function authenticate(body, env) {
  const initData = typeof body?.initData === 'string' ? body.initData : '';
  if (initData && env?.BOT_TOKEN) {
    const user = await verifyTelegramInitData(initData, env.BOT_TOKEN);
    if (user) return user;
  }

  if (String(env?.DEV_AUTH).toLowerCase() === 'true') {
    const id = String(body?.devUserId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    if (!id) throw new Error('Для локальной игры нужен devUserId.');
    return {
      id: `dev:${id}`,
      name: String(body?.displayName || 'Игрок').slice(0, 24),
      username: '',
      photoUrl: '',
    };
  }

  throw new Error('Откройте игру в Telegram: данные входа отсутствуют или устарели.');
}

export function makeRoomId(length = 20) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => ROOM_ID_ALPHABET[byte & 31]).join('');
}

async function forwardRoomJson(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    return apiError('Комната временно недоступна.', 503);
  }
  return jsonResponse(body, { status: response.status });
}

async function handleApi(request, env, url) {
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return jsonResponse({
      ok: true,
      mode: 'single-and-network',
      build: BUILD_MARKER,
      networkAvailable: Boolean(env?.GAME_ROOM && (env?.BOT_TOKEN || String(env?.DEV_AUTH).toLowerCase() === 'true')),
    });
  }

  if (url.pathname === '/api/config' && request.method === 'GET') {
    const botUsername = String(env?.BOT_USERNAME || '').replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '');
    const appShortName = String(env?.APP_SHORT_NAME || '').replace(/[^A-Za-z0-9_-]/g, '');
    return jsonResponse({
      ok: true,
      appUrl: botUsername && appShortName ? `https://t.me/${botUsername}/${appShortName}` : '',
      devAuth: String(env?.DEV_AUTH).toLowerCase() === 'true',
    });
  }

  if (url.pathname === '/api/rooms' && request.method === 'POST') {
    const body = await readJson(request);
    const user = await authenticate(body, env);
    const roomId = makeRoomId();
    const response = await roomStub(env, roomId).fetch(internalRoomRequest(url.origin, roomId, 'create', {
      user,
      choices: body.choices,
      displayName: body.displayName,
    }));
    return forwardRoomJson(response);
  }

  const joinMatch = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]{12,64})\/join$/);
  if (joinMatch && request.method === 'POST') {
    const body = await readJson(request);
    const user = await authenticate(body, env);
    const roomId = joinMatch[1];
    const response = await roomStub(env, roomId).fetch(internalRoomRequest(url.origin, roomId, 'join', {
      user,
      displayName: body.displayName,
    }));
    return forwardRoomJson(response);
  }

  const wsMatch = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]{12,64})\/ws$/);
  if (wsMatch && request.method === 'GET') {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return apiError('Ожидается WebSocket.', 426);
    }
    const ticket = url.searchParams.get('ticket') || '';
    if (!/^[A-Za-z0-9_-]{24,64}$/.test(ticket)) return apiError('Неверная ссылка на вход.', 401);
    const roomId = wsMatch[1];
    const upstreamUrl = new URL(`/room/${roomId}/ws`, url.origin);
    upstreamUrl.searchParams.set('ticket', ticket);
    return roomStub(env, roomId).fetch(new Request(upstreamUrl, request));
  }

  if (url.pathname.startsWith('/api/')) return apiError('Маршрут API не найден.', 404);
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      const apiResponse = await handleApi(request, env, url);
      if (apiResponse) return apiResponse;
    } catch (error) {
      const message = error?.message || 'Внутренняя ошибка.';
      const authError = /Telegram|devUserId|данные входа/i.test(message);
      return apiError(message, authError ? 401 : 400);
    }

    if (!PUBLIC_ASSET_PATH.test(url.pathname)) {
      return withSecurityHeaders(new Response('Not found', { status: 404 }), { 'Cache-Control': 'no-store' });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return withSecurityHeaders(new Response('Method not allowed', { status: 405 }), {
        Allow: 'GET, HEAD',
        'Cache-Control': 'no-store',
      });
    }
    if (env?.ASSETS) return withSecurityHeaders(await env.ASSETS.fetch(request));
    return withSecurityHeaders(new Response('Not found', { status: 404 }));
  },
};
