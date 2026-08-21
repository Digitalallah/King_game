import {
  CHARACTERS,
  CONTRACTS,
  GAME_MODES,
  chooseAiCard,
  chooseAiContract,
  contractIsResolved,
  createDeck,
  createSeededRandom,
  dealHands,
  legalCards,
  scoreTrick,
  shuffleDeck,
  trickWinner,
} from '../src/game-engine.js';

export const NETWORK_TIMING = {
  botTurnMs: 1150,
  botContractMs: 1350,
  trickCollectMs: 650,
  contractResultMs: 2600,
  nextTrickBotMs: 1210,
  firstTurnBotMs: 1670,
};

function randomSeed() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] || 0x6d2b79f5;
}

function withRandom(game, operation) {
  const random = createSeededRandom(game.randomState);
  const result = operation(random);
  game.randomState = random.getState();
  return result;
}

function normalizeMode(mode) {
  return mode === GAME_MODES.ORDERED ? GAME_MODES.ORDERED : GAME_MODES.CLASSIC;
}

function totalRounds(game) {
  return game.mode === GAME_MODES.ORDERED ? CONTRACTS.length * 4 : CONTRACTS.length;
}

function scheduleBot(game, seats, now, delayMs = NETWORK_TIMING.botTurnMs) {
  game.nextActionAt = game.status === 'playing' && seats[game.currentSeat]?.type === 'bot'
    ? now + delayMs
    : null;
}

function scheduleContractBot(game, seats, now) {
  game.nextActionAt = game.status === 'contract-choice' && seats[game.ordererSeat]?.type === 'bot'
    ? now + NETWORK_TIMING.botContractMs
    : null;
}

function dealRound(game) {
  game.hands = withRandom(game, random => dealHands(shuffleDeck(createDeck(), random)));
  game.trick = [];
  game.trickWinnerSeat = null;
  game.trickNumber = 0;
  game.dealScores = [0, 0, 0, 0];
}

function startClassicContract(game, seats, contractIndex, now) {
  game.roundNumber = contractIndex;
  game.contractIndex = contractIndex;
  game.ordererSeat = null;
  dealRound(game);
  game.currentSeat = (contractIndex + 1) % 4;
  game.status = 'playing';
  game.message = `${CONTRACTS[contractIndex].name}. Раздаём карты…`;
  scheduleBot(game, seats, now, NETWORK_TIMING.firstTurnBotMs);
}

function startOrderedRound(game, seats, roundNumber, now) {
  game.roundNumber = roundNumber;
  game.contractIndex = null;
  game.ordererSeat = (roundNumber + 1) % 4;
  dealRound(game);
  game.currentSeat = game.ordererSeat;
  game.status = 'contract-choice';
  game.message = `Место ${game.ordererSeat + 1} выбирает контракт.`;
  scheduleContractBot(game, seats, now);
}

function activateOrderedContract(game, seats, seat, contractIndex, now) {
  if (game.mode !== GAME_MODES.ORDERED || game.status !== 'contract-choice') {
    throw new Error('Сейчас нельзя выбирать контракт.');
  }
  if (game.ordererSeat !== seat) throw new Error('Сейчас контракт выбирает другой игрок.');
  const available = game.remainingContracts?.[seat] || [];
  if (!available.includes(contractIndex)) throw new Error('Этот контракт уже был заказан этим игроком.');

  game.remainingContracts[seat] = available.filter(index => index !== contractIndex);
  game.contractIndex = contractIndex;
  game.currentSeat = seat;
  game.status = 'playing';
  game.nextActionAt = null;
  game.message = `${CONTRACTS[contractIndex].name}. Заказ принят.`;
  scheduleBot(game, seats, now, NETWORK_TIMING.firstTurnBotMs);
}

export function createNetworkGame(seats, seed = randomSeed(), now = Date.now(), mode = GAME_MODES.CLASSIC) {
  if (!Array.isArray(seats) || seats.length !== 4) throw new Error('Для партии нужны четыре места.');
  const normalizedMode = normalizeMode(mode);
  const game = {
    version: 2,
    mode: normalizedMode,
    randomState: Number(seed) >>> 0 || 0x6d2b79f5,
    scores: [0, 0, 0, 0],
    dealScores: [0, 0, 0, 0],
    hands: [[], [], [], []],
    trick: [],
    trickWinnerSeat: null,
    trickNumber: 0,
    currentSeat: 0,
    contractIndex: normalizedMode === GAME_MODES.ORDERED ? null : 0,
    roundNumber: 0,
    ordererSeat: normalizedMode === GAME_MODES.ORDERED ? 1 : null,
    remainingContracts: normalizedMode === GAME_MODES.ORDERED
      ? Array.from({ length: 4 }, () => CONTRACTS.map(contract => contract.id))
      : null,
    status: 'playing',
    winners: [],
    nextActionAt: null,
    revision: 1,
    message: '',
  };
  if (normalizedMode === GAME_MODES.ORDERED) startOrderedRound(game, seats, 0, now);
  else startClassicContract(game, seats, 0, now);
  return game;
}

function removeCard(hand, cardId) {
  const index = hand.findIndex(card => card.id === cardId);
  if (index < 0) return null;
  return hand.splice(index, 1)[0];
}

function completeTrick(game) {
  const winner = trickWinner(game.trick);
  const points = scoreTrick(CONTRACTS[game.contractIndex], game.trick, game.trickNumber);
  game.dealScores[winner.seat] += points;
  game.scores[winner.seat] += points;
  game.trickNumber += 1;
  game.currentSeat = winner.seat;
  game.trickWinnerSeat = winner.seat;
  game.status = 'trick-await';
  game.nextActionAt = null;
  game.message = `Место ${winner.seat + 1} берёт взятку${points === 0 ? '.' : `: ${points > 0 ? '+' : ''}${points}.`}`;
}

function applyCard(game, seat, cardId, seats, now) {
  if (game.status !== 'playing') throw new Error('Сейчас нельзя ходить картой.');
  if (game.currentSeat !== seat) throw new Error('Сейчас ход другого игрока.');
  const hand = game.hands[seat];
  const card = hand.find(candidate => candidate.id === cardId);
  if (!card) throw new Error('Такой карты нет в вашей руке.');
  const legal = legalCards(hand, game.trick, CONTRACTS[game.contractIndex]);
  if (!legal.some(candidate => candidate.id === cardId)) {
    throw new Error('Этой картой сейчас нельзя ходить: соблюдайте масть первой карты.');
  }

  const played = removeCard(hand, cardId);
  game.trick.push({ seat, card: played });
  game.message = `Место ${seat + 1} делает ход.`;
  if (game.trick.length === 4) completeTrick(game);
  else {
    game.currentSeat = (seat + 1) % 4;
    scheduleBot(game, seats, now);
  }
  game.revision += 1;
}

export function playHumanCard(game, seats, seat, cardId, now = Date.now()) {
  if (seats[seat]?.type !== 'human') throw new Error('Это место не принадлежит живому игроку.');
  applyCard(game, seat, cardId, seats, now);
  return game;
}

export function chooseHumanContract(game, seats, seat, contractIndex, now = Date.now()) {
  if (seats[seat]?.type !== 'human') throw new Error('Это место не принадлежит живому игроку.');
  activateOrderedContract(game, seats, seat, Number(contractIndex), now);
  game.revision += 1;
  return game;
}

export function beginTrickCollection(game, now = Date.now()) {
  if (game.status !== 'trick-await') throw new Error('Взятка ещё не завершена.');
  game.status = 'trick-collecting';
  game.nextActionAt = now + NETWORK_TIMING.trickCollectMs;
  game.message = 'Собираем взятку…';
  game.revision += 1;
  return game;
}

function finishGame(game) {
  game.status = 'game-over';
  game.nextActionAt = null;
  const best = Math.max(...game.scores);
  game.winners = game.scores
    .map((score, seat) => ({ score, seat }))
    .filter(entry => entry.score === best)
    .map(entry => entry.seat);
  game.message = game.winners.length === 1
    ? `Партия окончена. Победило место ${game.winners[0] + 1}.`
    : `Партия окончена. Ничья между местами ${game.winners.map(seat => seat + 1).join(', ')}.`;
}

function botContext(game, seats, seat) {
  const record = seats[seat];
  const character = record?.type === 'bot' ? CHARACTERS[record.characterId] : null;
  return {
    character,
    skill: character?.skill,
    seat,
    hands: game.hands,
  };
}

export function advanceNetworkGame(game, seats, now = Date.now()) {
  if (game.nextActionAt === null || now < game.nextActionAt) return false;

  if (game.status === 'contract-choice') {
    const seat = game.ordererSeat;
    if (seats[seat]?.type !== 'bot') {
      game.nextActionAt = null;
      return false;
    }
    const available = game.remainingContracts?.[seat] || [];
    const contractIndex = withRandom(game, random => chooseAiContract(
      game.hands[seat],
      available,
      random,
      botContext(game, seats, seat),
    ));
    activateOrderedContract(game, seats, seat, contractIndex, now);
    game.revision += 1;
    return true;
  }

  if (game.status === 'playing') {
    if (seats[game.currentSeat]?.type !== 'bot') {
      game.nextActionAt = null;
      return false;
    }
    const seat = game.currentSeat;
    const card = withRandom(game, random => chooseAiCard(
      game.hands[seat],
      game.trick,
      CONTRACTS[game.contractIndex],
      game.trickNumber,
      random,
      botContext(game, seats, seat),
    ));
    applyCard(game, seat, card.id, seats, now);
    return true;
  }

  if (game.status === 'trick-collecting') {
    game.trick = [];
    game.trickWinnerSeat = null;
    const contractDone = game.trickNumber >= 8
      || contractIsResolved(CONTRACTS[game.contractIndex], game.hands);
    if (contractDone) {
      game.hands = [[], [], [], []];
      game.status = 'contract-result';
      game.nextActionAt = now + NETWORK_TIMING.contractResultMs;
      game.message = 'Раздача окончена.';
    } else {
      game.status = 'playing';
      scheduleBot(game, seats, now, NETWORK_TIMING.nextTrickBotMs);
      game.message = `Место ${game.currentSeat + 1} начинает следующую взятку.`;
    }
    game.revision += 1;
    return true;
  }

  if (game.status === 'contract-result') {
    if (game.mode === GAME_MODES.ORDERED) {
      if (game.roundNumber >= totalRounds(game) - 1) finishGame(game);
      else startOrderedRound(game, seats, game.roundNumber + 1, now);
    } else if (game.contractIndex >= CONTRACTS.length - 1) finishGame(game);
    else startClassicContract(game, seats, game.contractIndex + 1, now);
    game.revision += 1;
    return true;
  }

  game.nextActionAt = null;
  return false;
}

export function gameForPlayer(game, viewerSeat, now = Date.now()) {
  const hand = game.hands[viewerSeat] || [];
  return {
    mode: game.mode,
    status: game.status,
    contractIndex: game.contractIndex,
    roundNumber: game.roundNumber,
    totalRounds: totalRounds(game),
    ordererSeat: game.ordererSeat,
    availableContractIndexes: game.status === 'contract-choice' && game.ordererSeat === viewerSeat
      ? [...(game.remainingContracts?.[viewerSeat] || [])]
      : [],
    currentSeat: game.currentSeat,
    trickNumber: game.trickNumber,
    trick: game.trick.map(entry => ({ seat: entry.seat, cardId: entry.card.id })),
    trickWinnerSeat: game.trickWinnerSeat,
    handIds: hand.map(card => card.id),
    handCounts: game.hands.map(cards => cards.length),
    legalCardIds: game.status === 'playing' && game.currentSeat === viewerSeat
      ? legalCards(hand, game.trick, CONTRACTS[game.contractIndex]).map(card => card.id)
      : [],
    scores: [...game.scores],
    dealScores: [...game.dealScores],
    winners: [...game.winners],
    revision: game.revision,
    nextActionAt: game.nextActionAt,
    serverNow: now,
    message: game.message,
  };
}
