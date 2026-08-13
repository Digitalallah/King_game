const BUILD_MARKER = 'native-single-player-2';

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://telegram.org",
    "style-src 'self'",
    "img-src 'self' data: https://telegram.org https://*.telegram.org",
    "connect-src 'self' https://telegram.org https://*.telegram.org",
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

const PUBLIC_ASSET_PATH = /^(?:\/|\/index\.html|\/src\/(?:styles\.css|native-game\.js|game-engine\.js|native-assets\.js)|\/assets\/native\/(?:king\.lib\.bin|king\.fnt\.bin))$/;

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
  return withSecurityHeaders(Response.json(body, init), extraHeaders);
}

// Keep the already-provisioned Durable Object namespace deployable without
// exposing network play. No active route forwards requests to this class.
export class GameRoom {
  async fetch() {
    return jsonResponse(
      { ok: false, error: 'Network mode is disabled in this prototype.' },
      { status: 404 },
      { 'Cache-Control': 'no-store' },
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return jsonResponse(
        { ok: true, mode: 'single-player', build: BUILD_MARKER },
        {},
        { 'Cache-Control': 'no-store' },
      );
    }

    if (url.pathname.startsWith('/api/')) {
      return jsonResponse(
        { ok: false, error: 'Network mode is disabled in this prototype.' },
        { status: 404 },
        { 'Cache-Control': 'no-store' },
      );
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

    if (env.ASSETS) return withSecurityHeaders(await env.ASSETS.fetch(request));
    return withSecurityHeaders(new Response('Not found', { status: 404 }));
  },
};
