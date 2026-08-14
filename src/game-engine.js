export const SUITS = ['diamonds', 'clubs', 'spades', 'hearts'];
export const RANKS = [7, 8, 9, 10, 11, 12, 13, 14];

export const SUIT_SYMBOLS = {
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
  hearts: '♥',
};

export const RANK_LABELS = {
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'В',
  12: 'Д',
  13: 'К',
  14: 'Т',
};

const CARD_SPRITE_STARTS = {
  diamonds: 0,
  clubs: 13,
  spades: 26,
  hearts: 39,
};

export const CHARACTERS = [
  { id: 0, name: 'Винни Пух', spriteId: 52, cropX: 0 },
  { id: 1, name: 'Кролик', spriteId: 52, cropX: 80 },
  { id: 2, name: 'Иа-Иа', spriteId: 52, cropX: 160 },
  { id: 3, name: 'Пятачок', spriteId: 52, cropX: 240 },
  { id: 4, name: 'Фрекен Бок', spriteId: 53, cropX: 0 },
  { id: 5, name: 'Багира', spriteId: 53, cropX: 80 },
  { id: 6, name: 'Сова', spriteId: 53, cropX: 160 },
  { id: 7, name: 'Оля', spriteId: 53, cropX: 240 },
  { id: 8, name: 'Мишка', spriteId: 54, cropX: 0 },
  { id: 9, name: 'Башуров', spriteId: 54, cropX: 80 },
  { id: 10, name: 'Карлсон', spriteId: 54, cropX: 160 },
  { id: 11, name: 'Борька', spriteId: 54, cropX: 240 },
];

function makeContract(id, family, direction, noun, value, options = {}) {
  const taking = direction > 0;
  return {
    id,
    family,
    direction,
    name: `${taking ? 'Брать' : 'Не брать'} ${noun.toLowerCase()}`,
    titleLines: [taking ? 'БРАТЬ' : 'НЕ БРАТЬ', noun, `${taking ? '+' : '-'}${value}$`],
    heartLeadRestricted: ['hearts', 'king', 'all'].includes(family),
    forceKingDiscard: ['king', 'all'].includes(family),
    ...options,
  };
}

const NEGATIVE_CONTRACTS = [
  makeContract(0, 'tricks', -1, 'ВЗЯТКИ', 20),
  makeContract(1, 'hearts', -1, 'ЧЕРВИ', 20),
  makeContract(2, 'boys', -1, 'МАЛЬЧИКОВ', 20),
  makeContract(3, 'girls', -1, 'ДЕВОЧЕК', 40),
  makeContract(4, 'last', -1, '2 ПОСЛЕДНИЕ', 80),
  makeContract(5, 'king', -1, 'КИНГА', 160),
  makeContract(6, 'all', -1, 'ЕРАЛАШ', 20),
];

export const CONTRACTS = [
  ...NEGATIVE_CONTRACTS,
  ...NEGATIVE_CONTRACTS.map((contract, offset) => makeContract(
    contract.id + 7,
    contract.family,
    1,
    contract.titleLines[1],
    Number(contract.titleLines[2].replace(/\D/g, '')),
  )),
];

export function createDeck() {
  const deck = [];
  for (let suitIndex = 0; suitIndex < SUITS.length; suitIndex += 1) {
    const suit = SUITS[suitIndex];
    for (let rankIndex = 0; rankIndex < RANKS.length; rankIndex += 1) {
      const rank = RANKS[rankIndex];
      deck.push({
        id: `${suit}-${rank}`,
        suit,
        suitIndex,
        rank,
        spriteId: CARD_SPRITE_STARTS[suit] + rankIndex,
      });
    }
  }
  return deck;
}

export function sortCards(cards) {
  return [...cards].sort((left, right) => left.suitIndex - right.suitIndex || left.rank - right.rank);
}

export function createSeededRandom(seed = 0x19930822) {
  let state = Number(seed) >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  random.getState = () => state >>> 0;
  return random;
}

export function shuffleDeck(deck, random = Math.random) {
  const shuffled = [...deck];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

export function dealHands(deck) {
  if (!Array.isArray(deck) || deck.length !== 32) throw new Error('Для раздачи нужна колода из 32 карт');
  const hands = [[], [], [], []];
  deck.forEach((card, index) => hands[index % 4].push(card));
  return hands.map(sortCards);
}

export function legalCards(hand, trick, contract) {
  if (!Array.isArray(hand) || hand.length === 0) return [];
  if (!contract) throw new Error('Не указан контракт');

  if (!Array.isArray(trick) || trick.length === 0) {
    if (contract.heartLeadRestricted && hand.some(card => card.suit !== 'hearts')) {
      return hand.filter(card => card.suit !== 'hearts');
    }
    return [...hand];
  }

  const leadSuit = trick[0].card.suit;
  const following = hand.filter(card => card.suit === leadSuit);
  if (following.length > 0) return following;

  if (contract.forceKingDiscard) {
    const king = hand.find(card => card.suit === 'hearts' && card.rank === 13);
    if (king) return [king];
  }

  return [...hand];
}

export function trickWinner(trick) {
  if (!Array.isArray(trick) || trick.length === 0) return null;
  const leadSuit = trick[0].card.suit;
  return trick.reduce((winner, entry) => {
    if (entry.card.suit !== leadSuit) return winner;
    if (winner.card.suit !== leadSuit || entry.card.rank > winner.card.rank) return entry;
    return winner;
  }, trick[0]);
}

function familyPoints(family, trick, trickNumber) {
  const cards = trick.map(entry => entry.card);
  switch (family) {
    case 'tricks': return 20;
    case 'hearts': return cards.filter(card => card.suit === 'hearts').length * 20;
    case 'boys': return cards.filter(card => card.rank === 11 || card.rank === 13).length * 20;
    case 'girls': return cards.filter(card => card.rank === 12).length * 40;
    case 'last': return trickNumber >= 6 ? 80 : 0;
    case 'king': return cards.some(card => card.suit === 'hearts' && card.rank === 13) ? 160 : 0;
    case 'all':
      return familyPoints('tricks', trick, trickNumber)
        + familyPoints('hearts', trick, trickNumber)
        + familyPoints('boys', trick, trickNumber)
        + familyPoints('girls', trick, trickNumber)
        + familyPoints('last', trick, trickNumber)
        + familyPoints('king', trick, trickNumber);
    default: throw new Error(`Неизвестный контракт: ${family}`);
  }
}

export function scoreTrick(contract, trick, trickNumber) {
  return contract.direction * familyPoints(contract.family, trick, trickNumber);
}

function penaltyWeight(card, contract, trickNumber) {
  const weights = {
    tricks: card.rank,
    hearts: (card.suit === 'hearts' ? 80 : 0) + card.rank,
    boys: (card.rank === 11 || card.rank === 13 ? 90 : 0) + card.rank,
    girls: (card.rank === 12 ? 120 : 0) + card.rank,
    last: (trickNumber >= 5 ? card.rank * 5 : card.rank),
    king: (card.suit === 'hearts' && card.rank === 13 ? 200 : 0) + card.rank,
    all: (card.suit === 'hearts' ? 40 : 0)
      + (card.rank === 11 || card.rank === 13 ? 45 : 0)
      + (card.rank === 12 ? 70 : 0)
      + (card.suit === 'hearts' && card.rank === 13 ? 160 : 0)
      + card.rank,
  };
  return weights[contract.family] ?? card.rank;
}

function byRank(left, right) {
  return left.rank - right.rank || left.suitIndex - right.suitIndex;
}

export function chooseAiCard(hand, trick, contract, trickNumber = 0, random = Math.random) {
  const legal = legalCards(hand, trick, contract);
  if (legal.length <= 1) return legal[0] ?? null;

  const wantsPoints = contract.direction > 0;
  const smallNoise = () => random() * 0.001;

  if (trick.length === 0) {
    return [...legal].sort((left, right) => {
      const leftValue = penaltyWeight(left, contract, trickNumber) + smallNoise();
      const rightValue = penaltyWeight(right, contract, trickNumber) + smallNoise();
      return wantsPoints ? rightValue - leftValue : leftValue - rightValue;
    })[0];
  }

  const leadSuit = trick[0].card.suit;
  const winner = trickWinner(trick);
  const leadCards = legal.filter(card => card.suit === leadSuit);

  if (leadCards.length > 0) {
    const winning = leadCards.filter(card => card.rank > winner.card.rank).sort(byRank);
    const losing = leadCards.filter(card => card.rank < winner.card.rank).sort(byRank);

    if (wantsPoints) {
      if (winning.length > 0) return winning[0];
      return losing[0] ?? [...leadCards].sort(byRank)[0];
    }

    if (losing.length > 0) return losing[losing.length - 1];
    return winning[0] ?? [...leadCards].sort(byRank)[0];
  }

  return [...legal].sort((left, right) => {
    const leftValue = penaltyWeight(left, contract, trickNumber) + smallNoise();
    const rightValue = penaltyWeight(right, contract, trickNumber) + smallNoise();
    return wantsPoints ? leftValue - rightValue : rightValue - leftValue;
  })[0];
}

export function updateCardTapSelection(selectedCardId, tappedCardId) {
  if (!tappedCardId) return { selectedCardId: null, shouldPlay: false };
  if (selectedCardId === tappedCardId) return { selectedCardId: null, shouldPlay: true };
  return { selectedCardId: tappedCardId, shouldPlay: false };
}

export function matchResult(scores) {
  if (!Array.isArray(scores) || scores.length === 0 || scores.some(score => !Number.isFinite(score))) {
    throw new Error('Для определения победителя нужны итоговые очки игроков');
  }
  const winningScore = Math.max(...scores);
  const winnerSeats = scores
    .map((score, seat) => ({ score, seat }))
    .filter(entry => entry.score === winningScore)
    .map(entry => entry.seat);
  return { winningScore, winnerSeats };
}

export function formatScore(value) {
  if (value > 0) return `+${value}`;
  return String(value);
}
