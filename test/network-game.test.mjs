import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceNetworkGame,
  beginTrickCollection,
  chooseHumanContract,
  createNetworkGame,
  gameForPlayer,
  playHumanCard,
} from '../worker/network-game.js';

const mixedSeats = [
  { type: 'human' },
  { type: 'human' },
  { type: 'bot' },
  { type: 'bot' },
];

test('the authoritative deal contains one shared 32-card deck and hides other hands', () => {
  const game = createNetworkGame(mixedSeats, 0x19930822, 1_000);
  assert.deepEqual(game.hands.map(hand => hand.length), [8, 8, 8, 8]);
  const cardIds = game.hands.flat().map(card => card.id);
  assert.equal(new Set(cardIds).size, 32);

  const first = gameForPlayer(game, 0, 1_000);
  const second = gameForPlayer(game, 1, 1_000);
  assert.deepEqual(first.handIds, game.hands[0].map(card => card.id));
  assert.deepEqual(second.handIds, game.hands[1].map(card => card.id));
  assert.equal('hands' in first, false);
  assert.equal('randomState' in first, false);
  assert.equal(first.handCounts.reduce((sum, count) => sum + count, 0), 32);
});

test('only the current human may play one of the server-approved cards', () => {
  const seats = [{ type: 'human' }, { type: 'human' }, { type: 'human' }, { type: 'human' }];
  const game = createNetworkGame(seats, 12345, 0);
  assert.equal(game.currentSeat, 1);
  assert.throws(
    () => playHumanCard(game, seats, 0, game.hands[0][0].id, 0),
    /ход другого игрока/i,
  );
  const view = gameForPlayer(game, 1, 0);
  assert.ok(view.legalCardIds.length > 0);
  playHumanCard(game, seats, 1, view.legalCardIds[0], 0);
  assert.equal(game.trick.length, 1);
  assert.equal(game.hands[1].length, 7);
  assert.equal(game.currentSeat, 2);
});

test('a completed trick waits for a tap and visibly stays collected for the configured delay', () => {
  const seats = [{ type: 'human' }, { type: 'human' }, { type: 'human' }, { type: 'human' }];
  const game = createNetworkGame(seats, 777, 0);
  let now = 0;
  while (game.trick.length < 4) {
    const view = gameForPlayer(game, game.currentSeat, now);
    playHumanCard(game, seats, game.currentSeat, view.legalCardIds[0], now);
  }
  assert.equal(game.status, 'trick-await');
  assert.equal(game.trick.length, 4);
  assert.equal(game.nextActionAt, null);

  beginTrickCollection(game, 2_000);
  assert.equal(game.status, 'trick-collecting');
  assert.equal(game.trick.length, 4);
  assert.equal(advanceNetworkGame(game, seats, 2_649), false);
  assert.equal(game.trick.length, 4);
  assert.equal(advanceNetworkGame(game, seats, 2_650), true);
  assert.equal(game.trick.length, 0);
});

test('ordered mode exposes all fourteen contracts only to the current orderer', () => {
  const seats = [{ type: 'human' }, { type: 'human' }, { type: 'human' }, { type: 'human' }];
  const game = createNetworkGame(seats, 1993, 0, 'ordered');

  assert.equal(game.mode, 'ordered');
  assert.equal(game.status, 'contract-choice');
  assert.equal(game.roundNumber, 0);
  assert.equal(game.ordererSeat, 1);
  assert.equal(game.contractIndex, null);
  assert.equal(gameForPlayer(game, 0, 0).availableContractIndexes.length, 0);
  assert.equal(gameForPlayer(game, 1, 0).availableContractIndexes.length, 14);

  chooseHumanContract(game, seats, 1, 5, 0);
  assert.equal(game.status, 'playing');
  assert.equal(game.contractIndex, 5);
  assert.equal(game.currentSeat, 1);
  assert.equal(game.remainingContracts[1].includes(5), false);
});

test('ordered mode completes 56 rounds and every player orders every contract once', () => {
  const seats = [{ type: 'human' }, { type: 'human' }, { type: 'human' }, { type: 'human' }];
  const game = createNetworkGame(seats, 50057, 0, 'ordered');
  let now = 0;
  let steps = 0;
  const orderedBySeat = Array.from({ length: 4 }, () => []);

  while (game.status !== 'game-over' && steps < 20_000) {
    steps += 1;
    if (game.status === 'contract-choice') {
      const seat = game.ordererSeat;
      const view = gameForPlayer(game, seat, now);
      const contractIndex = view.availableContractIndexes[0];
      assert.ok(Number.isInteger(contractIndex), `seat ${seat} must have a contract to order`);
      orderedBySeat[seat].push(contractIndex);
      chooseHumanContract(game, seats, seat, contractIndex, now);
    } else if (game.status === 'playing') {
      const seat = game.currentSeat;
      const view = gameForPlayer(game, seat, now);
      assert.ok(view.legalCardIds.length > 0, `seat ${seat} must have a legal card`);
      playHumanCard(game, seats, seat, view.legalCardIds[0], now);
    } else if (game.status === 'trick-await') {
      beginTrickCollection(game, now);
    } else if (game.nextActionAt !== null) {
      now = Math.max(now, game.nextActionAt);
      advanceNetworkGame(game, seats, now);
    } else {
      assert.fail(`ordered game stalled in ${game.status}`);
    }
  }

  assert.equal(game.status, 'game-over');
  assert.equal(game.roundNumber, 55);
  assert.deepEqual(game.remainingContracts, [[], [], [], []]);
  for (const orders of orderedBySeat) {
    assert.equal(orders.length, 14);
    assert.deepEqual([...orders].sort((left, right) => left - right), Array.from({ length: 14 }, (_, index) => index));
  }
  assert.equal(game.scores.reduce((sum, score) => sum + score, 0), 0);
});

test('a mixed human and bot game completes all fourteen contracts with a final winner', () => {
  const seats = [{ type: 'human' }, { type: 'bot' }, { type: 'human' }, { type: 'bot' }];
  const game = createNetworkGame(seats, 50057, 0);
  let now = 0;
  let steps = 0;

  while (game.status !== 'game-over' && steps < 5_000) {
    steps += 1;
    if (game.status === 'playing' && seats[game.currentSeat].type === 'human') {
      const view = gameForPlayer(game, game.currentSeat, now);
      playHumanCard(game, seats, game.currentSeat, view.legalCardIds[0], now);
    } else if (game.status === 'trick-await') {
      beginTrickCollection(game, now);
    } else if (game.nextActionAt !== null) {
      now = Math.max(now, game.nextActionAt);
      advanceNetworkGame(game, seats, now);
    } else {
      assert.fail(`authoritative game stalled in ${game.status}`);
    }
  }

  assert.equal(game.status, 'game-over');
  assert.equal(game.contractIndex, 13);
  assert.deepEqual(game.hands.map(hand => hand.length), [0, 0, 0, 0]);
  assert.ok(game.winners.length >= 1);
  const best = Math.max(...game.scores);
  assert.ok(game.winners.every(seat => game.scores[seat] === best));
  assert.equal(game.scores.reduce((sum, score) => sum + score, 0), 0);
});
