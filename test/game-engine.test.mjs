import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceBots,
  createGame,
  gameForPlayer,
  legalCards,
  playCard,
  TOTAL_ROUNDS,
} from '../worker/game-engine.js';

function deterministicRandom() {
  let value = 0;
  return () => {
    value = (value + 0.38196601125) % 1;
    return value;
  };
}

test('one server game deals one unique 32-card deck', () => {
  const game = createGame(deterministicRandom());
  assert.equal(game.hands.length, 4);
  assert.deepEqual(game.hands.map(hand => hand.length), [8, 8, 8, 8]);
  const ids = game.hands.flat().map(card => card.id);
  assert.equal(new Set(ids).size, 32);
});

test('server rejects a move from the wrong seat', () => {
  const game = createGame(deterministicRandom());
  const wrongSeat = (game.turn + 1) % 4;
  assert.throws(
    () => playCard(game, wrongSeat, game.hands[wrongSeat][0].id),
    /ход другого игрока/i,
  );
});

test('server enforces following the lead suit', () => {
  const game = createGame(deterministicRandom());
  const leader = game.turn;
  const first = legalCards(game, leader)[0];
  playCard(game, leader, first.id, deterministicRandom());

  const nextSeat = game.turn;
  const matching = game.hands[nextSeat].filter(card => card.suit.id === first.suit.id);
  const offSuit = game.hands[nextSeat].find(card => card.suit.id !== first.suit.id);
  if (matching.length && offSuit) {
    assert.throws(
      () => playCard(game, nextSeat, offSuit.id, deterministicRandom()),
      /ходить в масть/i,
    );
  }
});

test('each player receives only their own hand', () => {
  const game = createGame(deterministicRandom());
  const view = gameForPlayer(game, 2);
  assert.deepEqual(view.hand.map(card => card.id), game.hands[2].map(card => card.id));
  assert.deepEqual(view.handCounts, [8, 8, 8, 8]);
  assert.equal('hands' in view, false);
});

test('bots advance on the server until a human turn', () => {
  const game = createGame(deterministicRandom());
  const seats = [
    { type: 'bot' },
    { type: 'bot' },
    { type: 'human' },
    { type: 'bot' },
  ];
  advanceBots(game, seats, deterministicRandom());
  assert.equal(game.turn, 2);
  assert.equal(game.running, true);
});

test('an all-bot simulation completes all fourteen contracts', () => {
  const game = createGame(deterministicRandom());
  const seats = [0, 1, 2, 3].map(() => ({ type: 'bot' }));
  advanceBots(game, seats, deterministicRandom());
  assert.equal(game.finished, true);
  assert.equal(game.running, false);
  assert.equal(game.round, TOTAL_ROUNDS);
  assert.equal(game.hands.every(hand => hand.length === 0), true);
  assert.equal(game.winners.length > 0, true);
});
