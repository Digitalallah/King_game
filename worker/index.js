const BUILD_MARKER = 'native-single-player-1';

// Keep the already-provisioned Durable Object namespace deployable without
// exposing network play. No active route forwards requests to this class.
export class GameRoom {
  async fetch() {
    return Response.json(
      { ok: false, error: 'Network mode is disabled in this prototype.' },
      { status: 404 },
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return Response.json({
        ok: true,
        mode: 'single-player',
        build: BUILD_MARKER,
        hasAssets: Boolean(env.ASSETS),
      });
    }

    if (url.pathname.startsWith('/api/')) {
      return Response.json({ ok: false, error: 'Network mode is disabled in this prototype.' }, { status: 404 });
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
