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

    if (env.ASSETS