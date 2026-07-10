const SUITS = [
  { id: 'clubs', symbol: '♣', name: 'трефы', color: 'black' },
  { id: 'diamonds', symbol: '♦', name: 'бубны', color: 'red' },
  { id: 'spades', symbol: '♠', name: 'пики', color: 'black' },
  { id: 'hearts', symbol: '♥', name: 'червы', color: 'red' },
];

const RANKS = [
  { id: '7', value: 7 },
  { id: '8', value: 8 },
  { id: '9', value: 9 },
  { id: '10', value: 10 },
  { id: 'J', value: 11 },
  { id: 'Q', value: 12 },
  { id: 'K', value: 13 },
  { id: 'A', value: 14 },
];

const BASE_CONTRACTS = [
  {
    id: 'tricks',
    penaltyTitle: 'Не брать взятки',
    positiveTitle: 'Брать взятки',
    penaltyDescription: 'Каждая взятка: −20 очков.',
    positiveDescription: 'Каждая взятка: +20 очков.',
    points: () => 20,
  },
  {
    id: 'hearts',
    penaltyTitle: 'Не брать червей',
    positiveTitle: 'Брать червей',
    penaltyDescription: 'Каждая черва во взятке: −20 очков. Нельзя начинать с червей, пока есть другие масти.',
    positiveDescription: 'Каждая черва во взятке: +20 очков. Нельзя начинать с червей, пока есть другие масти.',
    points: cards => cards.filter(card => card.suit.id === 'hearts').length * 20,
    restrictHeartLead: true,
  },
  {
    id: 'boys',
    penaltyTitle: 'Не брать мальчиков',
    positiveTitle: 'Брать мальчиков',
    penaltyDescription: 'Каждый король и валет: −20 очков.',
    positiveDescription: 'Каждый король и валет: +20 очков.',
    points: cards => cards.filter(card => card.rank.id === 'K' || card.rank.id === 'J').length * 20,
  },
  {
    id: 'girls',
    penaltyTitle: 'Не брать девочек',
    positiveTitle: 'Брать девочек',
    penaltyDescription: 'Каждая дама: −40 очков.',
    positiveDescription: 'Каждая дама: +40 очков.',
    points: cards => cards.filter(card => card.rank.id === 'Q').length * 40,
  },
  {
    id: 'last-two',
    penaltyTitle: 'Не брать две последние взятки',
    positiveTitle: 'Брать две последние взятки',
    penaltyDescription: 'Седьмая и восьмая взятки: −80 очков каждая.',
    positiveDescription: 'Седьмая и восьмая взятки: +80 очков каждая.',
    points: (_cards, trickNumber) => trickNumber >= 7 ? 80 : 0,
  },
  {
    id: 'king',
    penaltyTitle: 'Не брать Кинга',
    positiveTitle: 'Брать Кинга',
    penaltyDescription: 'Король червей: −160 очков. Нельзя начинать с червей, пока есть другие масти.',
    positiveDescription: 'Король червей: +160 очков. Нельзя начинать с червей, пока есть другие масти.',
    points: cards => cards.some(card => card.rank.id === 'K' && card.suit.id === 'hearts') ? 160 : 0,
    restrictHeartLead: true,
  },
  {
    id: 'mishmash',
    penaltyTitle: 'Ералаш: не брать ничего',
    positiveTitle: 'Ералаш: брать всё',
    penaltyDescription: 'Суммируются штрафы за взятки, червей, мальчиков, девочек, две последние взятки и Кинга.',
    positiveDescription: 'Суммируются плюсы за взятки, червей, мальчиков, девочек, две последние взятки и Кинга.',
    points: (cards, trickNumber) => BASE_CONTRACTS.slice(0, 6)
      .reduce((sum, contract) => sum + contract.points(cards, trickNumber), 0),
    restrictHeartLead: true,
  },
];

export const TOTAL_ROUNDS = BASE_CONTRACTS.length * 2;

export function contractForRound(round) {
  const safeRound = Math.max(0, Math.min(Number(round) || 0, TOTAL_ROUNDS - 1));
  const base = BASE_CONTRACTS[safeRound % BASE_CONTRACTS.length];
  const positive = safeRound >= BASE_CONTRACTS.length;
  return {
    id: base.id,
    phase: positive ? 'positive' : 'penalty',
    title: positive ? base.positiveTitle : base.penaltyTitle,
    description: positive ? base.positiveDescription : base.penaltyDescription,
    restrictHeartLead: Boolean(base.restrictHeartLead),
  };
}

export function createDeck() {
  return SUITS.flatMap(suit => RANKS.map(rank => ({
    id: `${rank.id}-${suit.id}`,
    suit: { ...suit },
    rank: { ...rank },
  })));
}

export function shuffle(cards, random = Math.random) {
  const result = cards.map(card => ({
    ...card,
    suit: { ...card.suit },
    rank: { ...card.rank },
  }));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function sortHand(hand) {
  return [...hand].sort((left, right) => {
    const suitDelta = SUITS.findIndex(suit => suit.id === left.suit.id)
      - SUITS.findIndex(suit => suit.id === right.suit.id);
    return suitDelta || left.rank.value - right.rank.value;
  });
}

export function createGame(random = Math.random) {
  const game = {
    round: 0,
    leader: 0,
    turn: 0,
    hands: [[], [], [], []],
    scores: [0, 0, 0, 0],
    taken: [0, 0, 0, 0],
    trickNumber: 1,
    currentTrick: [],
    lastTrick: [],
    running: true,
    finished: false,
    winners: [],
    message: '',
  };
  startRound(game, random);
  return game;
}

export function startRound(game, random = Math.random) {
  const deck = shuffle(createDeck(), random);
  game.hands = [0, 1, 2, 3].map(seat => sortHand(deck.slice(seat * 8, seat * 8 + 8)));
  game.taken = [0, 0, 0, 0];
  game.trickNumber = 1;
  game.currentTrick = [];
  game.lastTrick = [];
  game.turn = game.leader;
  game.running = true;
  game.message = `Место ${game.turn + 1} начинает контракт.`;
}

export function legalCards(game, seat) {
  const hand = game.hands?.[seat] || [];
  const leadSuit = game.currentTrick?.[0]?.card?.suit?.id;
  if (!leadSuit) {
    const contract = contractForRound(game.round);
    if (!contract.restrictHeartLead) return hand;
    const nonHearts = hand.filter(card => card.suit.id !== 'hearts');
    return nonHearts.length ? nonHearts : hand;
  }
  const matching = hand.filter(card => card.suit.id === leadSuit);
  return matching.length ? matching : hand;
}

export function scoreTrick(round, cards, trickNumber) {
  const base = BASE_CONTRACTS[round % BASE_CONTRACTS.length];
  const sign = round >= BASE_CONTRACTS.length ? 1 : -1;
  return sign * base.points(cards, trickNumber);
}

export function playCard(game, seat, cardId, random = Math.random) {
  if (!game?.running || game.finished) throw new Error('Партия уже завершена.');
  if (seat !== game.turn) throw new Error('Сейчас ход другого игрока.');

  const hand = game.hands[seat] || [];
  const card = hand.find(item => item.id === cardId);
  if (!card) throw new Error('Такой карты нет в вашей руке.');

  const legal = legalCards(game, seat);
  if (!legal.some(item => item.id === cardId)) {
    const hasLeadSuit = Boolean(game.currentTrick?.[0]);
    throw new Error(hasLeadSuit
      ? 'Нужно ходить в масть, если она есть.'
      : 'В этом контракте нельзя начинать с червей, пока есть другие масти.');
  }

  if (game.currentTrick.length === 0) game.lastTrick = [];
  game.hands[seat] = hand.filter(item => item.id !== cardId);
  game.currentTrick.push({ player: seat, card });
  game.turn = (seat + 1) % 4;
  game.message = `Место ${seat + 1} сыграло ${card.rank.id}${card.suit.symbol}.`;

  if (game.currentTrick.length === 4) resolveTrick(game, random);
  return game;
}

export function resolveTrick(game, random = Math.random) {
  const leadSuit = game.currentTrick[0].card.suit.id;
  const winnerPlay = game.currentTrick
    .filter(play => play.card.suit.id === leadSuit)
    .sort((left, right) => right.card.rank.value - left.card.rank.value)[0];
  const winner = winnerPlay.player;
  const trickCards = game.currentTrick.map(play => play.card);
  const delta = scoreTrick(game.round, trickCards, game.trickNumber);

  game.scores[winner] += delta;
  game.taken[winner] += 1;
  game.leader = winner;
  game.turn = winner;
  game.lastTrick = game.currentTrick;
  game.currentTrick = [];
  game.message = `Место ${winner + 1} забирает взятку ${game.trickNumber} (${delta > 0 ? '+' : ''}${delta}).`;
  game.trickNumber += 1;

  if (game.hands.every(hand => hand.length === 0)) {
    game.round += 1;
    if (game.round >= TOTAL_ROUNDS) {
      game.running = false;
      game.finished = true;
      const best = Math.max(...game.scores);
      game.winners = game.scores
        .map((score, seat) => ({ score, seat }))
        .filter(item => item.score === best)
        .map(item => item.seat);
      game.message = `Партия окончена. Победило место ${game.winners.map(seat => seat + 1).join(', ')}.`;
    } else {
      startRound(game, random);
    }
  }
}

export function chooseBotCard(game, seat) {
  const legal = legalCards(game, seat);
  if (!legal.length) throw new Error('У бота нет допустимых карт.');
  const leadSuit = game.currentTrick[0]?.card.suit.id;
  const risk = card => Math.abs(scoreTrick(game.round, [card], game.trickNumber));

  if (!leadSuit) {
    return [...legal].sort((left, right) => risk(left) - risk(right) || left.rank.value - right.rank.value)[0];
  }

  const leadCards = game.currentTrick.filter(play => play.card.suit.id === leadSuit);
  const winningValue = Math.max(...leadCards.map(play => play.card.rank.value));
  const safe = legal.filter(card => card.suit.id !== leadSuit || card.rank.value < winningValue);
  return [...(safe.length ? safe : legal)]
    .sort((left, right) => risk(right) - risk(left) || left.rank.value - right.rank.value)[0];
}

export function advanceBots(game, seats, random = Math.random, maxMoves = 2000) {
  let moves = 0;
  while (game.running && seats?.[game.turn]?.type === 'bot') {
    if (moves >= maxMoves) throw new Error('Bot loop exceeded the safety limit.');
    const seat = game.turn;
    const card = chooseBotCard(game, seat);
    playCard(game, seat, card.id, random);
    moves += 1;
  }
  return moves;
}

export function gameForPlayer(game, viewerSeat) {
  const hand = game.hands?.[viewerSeat] || [];
  return {
    round: game.round,
    totalRounds: TOTAL_ROUNDS,
    contract: contractForRound(game.round),
    leader: game.leader,
    turn: game.turn,
    scores: [...game.scores],
    taken: [...game.taken],
    trickNumber: game.trickNumber,
    currentTrick: game.currentTrick.map(play => ({ player: play.player, card: play.card })),
    lastTrick: game.lastTrick.map(play => ({ player: play.player, card: play.card })),
    hand: hand.map(card => card),
    handCounts: game.hands.map(cards => cards.length),
    legalCardIds: game.running && game.turn === viewerSeat
      ? legalCards(game, viewerSeat).map(card => card.id)
      : [],
    running: game.running,
    finished: game.finished,
    winners: [...game.winners],
    message: game.message,
  };
}
