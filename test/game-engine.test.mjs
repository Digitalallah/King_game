import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHARACTERS,
  CONTRACTS,
  chooseAiCard,
  createDeck,
  createSeededRandom,
  dealHands,
  legalCards,
  scoreTrick,
  shuffleDeck,
  trickWinner,
  updateCardTapSelection,
} from '../src/game-engine.js';

test('the reconstructed deck has all 32 unique original card sprites', () => {
  const deck = createDeck();
  assert.equal(deck.length, 32);
  assert.equal(new Set(deck.map(card => card.id)).size, 32);
  assert.equal(new Set(deck.map(card => card.spriteId)).size, 32);
  assert.deepEqual(deck.slice(0, 8).map(card => card.spriteId), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(deck.slice(8, 16).map(card => card.spriteId), [13, 14, 15, 16, 17, 18, 19, 20]);
  assert.deepEqual(deck.slice(24, 32).map(card => card.spriteId), [39, 40, 41, 42, 43, 44, 45, 46]);
});

test('a seeded shuffle deals eight cards to every player', () => {
  const hands = dealHands(shuffleDeck(createDeck(), createSeededRandom(50057)));
  assert.deepEqual(hands.map(hand => hand.length), [8, 8, 8, 8]);
  assert.equal(new Set(hands.flat().map(card => card.id)).size, 32);
});

test('following the leading suit is mandatory', () => {
  const deck = createDeck();
  const hand = [deck.find(card => card.id === 'clubs-7'), deck.find(card => card.id === 'hearts-14')];
  const trick = [{ seat: 1, card: deck.find(card => card.id === 'clubs-10') }];
  assert.deepEqual(legalCards(hand, trick, CONTRACTS[0]).map(card => card.id), ['clubs-7']);
});

test('hearts cannot be led in hearts, King and mishmash contracts while another suit remains', () => {
  const deck = createDeck();
  const hand = [deck.find(card => card.id === 'hearts-7'), deck.find(card => card.id === 'spades-7')];
  for (const index of [1, 5, 6, 8, 12, 13]) {
    assert.deepEqual(legalCards(hand, [], CONTRACTS[index]).map(card => card.id), ['spades-7']);
  }
});

test('the King must be discarded when its holder cannot follow suit', () => {
  const deck = createDeck();
  const hand = [deck.find(card => card.id === 'hearts-13'), deck.find(card => card.id === 'spades-7')];
  const trick = [{ seat: 2, card: deck.find(card => card.id === 'clubs-14') }];
  assert.deepEqual(legalCards(hand, trick, CONTRACTS[5]).map(card => card.id), ['hearts-13']);
});

test('the highest card of the leading suit wins the trick', () => {
  const deck = createDeck();
  const card = id => deck.find(candidate => candidate.id === id);
  const winner = trickWinner([
    { seat: 1, card: card('clubs-10') },
    { seat: 2, card: card('hearts-14') },
    { seat: 3, card: card('clubs-13') },
    { seat: 0, card: card('clubs-7') },
  ]);
  assert.equal(winner.seat, 3);
});

test('all seven penalty contracts total the original 160/960 values', () => {
  const deck = createDeck();
  const tricks = Array.from({ length: 8 }, (_, trickIndex) => (
    deck.slice(trickIndex * 4, trickIndex * 4 + 4).map((card, seat) => ({ seat, card }))
  ));
  const totals = CONTRACTS.slice(0, 7).map(contract => (
    tricks.reduce((sum, trick, index) => sum + scoreTrick(contract, trick, index), 0)
  ));
  assert.deepEqual(totals, [-160, -160, -160, -160, -160, -160, -960]);
  const positiveTotals = CONTRACTS.slice(7).map(contract => (
    tricks.reduce((sum, trick, index) => sum + scoreTrick(contract, trick, index), 0)
  ));
  assert.deepEqual(positiveTotals, [160, 160, 160, 160, 160, 160, 960]);
});

test('AI always returns one of the cards legal for the current trick', () => {
  const random = createSeededRandom(1993);
  const hands = dealHands(shuffleDeck(createDeck(), random));
  const trick = [{ seat: 0, card: hands[0][0] }];
  const legal = legalCards(hands[1], trick, CONTRACTS[6]);
  const selected = chooseAiCard(hands[1], trick, CONTRACTS[6], 0, random);
  assert.ok(legal.some(card => card.id === selected.id));
});

test('one tap selects a card and the second tap requests a play', () => {
  assert.deepEqual(updateCardTapSelection(null, 'clubs-7'), { selectedCardId: 'clubs-7', shouldPlay: false });
  assert.deepEqual(updateCardTapSelection('clubs-7', 'clubs-8'), { selectedCardId: 'clubs-8', shouldPlay: false });
  assert.deepEqual(updateCardTapSelection('clubs-8', 'clubs-8'), { selectedCardId: null, shouldPlay: true });
});

test('all twelve original partner portraits remain available', () => {
  assert.equal(CHARACTERS.length, 12);
  assert.equal(new Set(CHARACTERS.map(character => `${character.spriteId}:${character.cropX}`)).size, 12);
  assert.deepEqual(CHARACTERS.map(character => character.name), [
    'Винни Пух',
    'Кролик',
    'Иа-Иа',
    'Пятачок',
    'Фрекен Бок',
    'Багира',
    'Сова',
    'Оля',
    'Мишка',
    'Башуров',
    'Карлсон',
    'Борька',
  ]);
});
