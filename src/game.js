const tg = window.Telegram?.WebApp;

const SUITS = [
  { id: 'clubs', symbol: '♣', name: 'трефы', color: 'black' },
  { id: 'diamonds', symbol: '♦', name: 'бубны', color: 'red' },
  { id: 'spades', symbol: '♠', name: 'пики', color: 'black' },
  { id: 'hearts', symbol: '♥', name: 'червы', color: 'red' },
];
const RANKS = [
  { id: '7', value: 7 }, { id: '8', value: 8 }, { id: '9', value: 9 }, { id: '10', value: 10 },
  { id: 'J', value: 11 }, { id: 'Q', value: 12 }, { id: 'K', value: 13 }, { id: 'A', value: 14 },
];
const PLAYERS = ['Вы', 'Лиса', 'Барон', 'Сова'];
const CONTRACT_TYPES = [
  {
    id: 'tricks',
    title: 'Не брать взятки',
    positiveTitle: 'Брать взятки',
    description: 'Каждая взятка: −20 очков.',
    positiveDescription: 'Каждая взятка: +20 очков.',
    points: trick => (trick ? 20 : 0),
  },
  {
    id: 'hearts',
    title: 'Не брать червей',
    positiveTitle: 'Брать червей',
    description: 'Каждая черва во взятке: −20 очков. Нельзя начинать с червей, пока есть другие масти.',
    positiveDescription: 'Каждая черва во взятке: +20 очков. Нельзя начинать с червей, пока есть другие масти.',
    points: trick => 20 * trick.filter(card => card.suit.id === 'hearts').length,
    restrictHeartLead: true,
  },
  {
    id: 'boys',
    title: 'Не брать мальчиков',
    positiveTitle: 'Брать мальчиков',
    description: 'Каждый король и валет: −20 очков.',
    positiveDescription: 'Каждый король и валет: +20 очков.',
    points: trick => 20 * trick.filter(card => ['K', 'J'].includes(card.rank.id)).length,
  },
  {
    id: 'girls',
    title: 'Не брать девочек',
    positiveTitle: 'Брать девочек',
    description: 'Каждая дама: −40 очков.',
    positiveDescription: 'Каждая дама: +40 очков.',
    points: trick => 40 * trick.filter(card => card.rank.id === 'Q').length,
  },
  {
    id: 'last-two',
    title: 'Не брать две последние взятки',
    positiveTitle: 'Брать две последние взятки',
    description: 'Седьмая и восьмая взятки: −80 очков каждая.',
    positiveDescription: 'Седьмая и восьмая взятки: +80 очков каждая.',
    points: (_trick, trickNumber) => (trickNumber >= 7 ? 80 : 0),
  },
  {
    id: 'king',
    title: 'Не брать Кинга',
    positiveTitle: 'Брать Кинга',
    description: 'Король червей: −160 очков. Нельзя начинать с червей, пока есть другие масти.',
    positiveDescription: 'Король червей: +160 очков. Нельзя начинать с червей, пока есть другие масти.',
    points: trick => trick.some(card => card.rank.id === 'K' && card.suit.id === 'hearts') ? 160 : 0,
    restrictHeartLead: true,
  },
  {
    id: 'mishmash',
    title: 'Ералаш: не брать ничего',
    positiveTitle: 'Ералаш: брать всё',
    description: 'Суммируются штрафы за взятки, червей, мальчиков, девочек, две последние взятки и Кинга.',
    positiveDescription: 'Суммируются плюсы за взятки, червей, мальчиков, девочек, две последние взятки и Кинга.',
    points: (trick, trickNumber) => CONTRACT_TYPES.slice(0, 6).reduce((sum, contract) => sum + contract.points(trick, trickNumber), 0),
    restrictHeartLead: true,
  },
];

const CONTRACTS = [
  ...CONTRACT_TYPES.map(contract => ({
    ...contract,
    phase: 'penalty',
    score: (trick, trickNumber) => -contract.points(trick, trickNumber),
  })),
  ...CONTRACT_TYPES.map(contract => ({
    ...contract,
    phase: 'positive',
    title: contract.positiveTitle,
    description: contract.positiveDescription,
    score: (trick, trickNumber) => contract.points(trick, trickNumber),
  })),
];

const state = {
  round: 0,
  leader: 0,
  turn: 0,
  hands: [],
  scores: [0, 0, 0, 0],
  taken: [0, 0, 0, 0],
  trickNumber: 1,
  currentTrick: [],
  running: false,
  message: '',
};

const el = {
  contractTitle: document.querySelector('#contractTitle'),
  contractDescription: document.querySelector('#contractDescription'),
  roundLabel: document.querySelector('#roundLabel'),
  roundProgress: document.querySelector('#roundProgress'),
  scoreBoard: document.querySelector('#scoreBoard'),
  players: document.querySelector('#players'),
  trickArea: document.querySelector('#trickArea'),
  statusText: document.querySelector('#statusText'),
  hand: document.querySelector('#hand'),
  newGameButton: document.querySelector('#newGameButton'),
  hintButton: document.querySelector('#hintButton'),
  rulesButton: document.querySelector('#rulesButton'),
  rulesDialog: document.querySelector('#rulesDialog'),
};

function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  document.documentElement.style.setProperty('--tg-bg', tg.themeParams.bg_color || '#101827');
  document.documentElement.style.setProperty('--tg-text', tg.themeParams.text_color || '#f8fafc');
  tg.MainButton.setText('Новая партия');
  tg.MainButton.onClick(startGame);
  tg.MainButton.show();
}

function createDeck() {
  return SUITS.flatMap(suit => RANKS.map(rank => ({ suit, rank, id: `${rank.id}-${suit.id}` })));
}

function shuffle(cards) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function startGame() {
  state.round = 0;
  state.scores = [0, 0, 0, 0];
  state.leader = 0;
  state.running = true;
  startRound();
  tg?.HapticFeedback?.impactOccurred('medium');
}

function startRound() {
  const deck = shuffle(createDeck());
  state.hands = [0, 1, 2, 3].map(index => sortHand(deck.slice(index * 8, index * 8 + 8)));
  state.taken = [0, 0, 0, 0];
  state.trickNumber = 1;
  state.currentTrick = [];
  state.turn = state.leader;
  state.message = `${PLAYERS[state.turn]} начинает контракт.`;
  render();
  maybeBotTurn();
}

function sortHand(hand) {
  return [...hand].sort((a, b) => SUITS.findIndex(s => s.id === a.suit.id) - SUITS.findIndex(s => s.id === b.suit.id) || a.rank.value - b.rank.value);
}

function legalCards(player) {
  const hand = state.hands[player];
  const leadSuit = state.currentTrick[0]?.card.suit.id;
  if (!leadSuit) {
    const contract = CONTRACTS[state.round];
    if (!contract?.restrictHeartLead) return hand;
    const nonHearts = hand.filter(card => card.suit.id !== 'hearts');
    return nonHearts.length ? nonHearts : hand;
  }
  const sameSuit = hand.filter(card => card.suit.id === leadSuit);
  return sameSuit.length ? sameSuit : hand;
}

function playCard(player, cardId) {
  if (!state.running || state.turn !== player) return;
  const legal = legalCards(player);
  if (!legal.some(card => card.id === cardId)) {
    state.message = state.currentTrick.length === 0
      ? 'В этом контракте нельзя начинать с червей, пока есть другие масти.'
      : 'Нужно ходить в масть, если она есть.';
    render();
    tg?.HapticFeedback?.notificationOccurred('error');
    return;
  }
  const card = state.hands[player].find(item => item.id === cardId);
  state.hands[player] = state.hands[player].filter(item => item.id !== cardId);
  state.currentTrick.push({ player, card });
  state.turn = (player + 1) % 4;
  state.message = `${PLAYERS[player]} сыграл ${formatCard(card)}.`;
  render();
  if (state.currentTrick.length === 4) window.setTimeout(resolveTrick, 650);
  else maybeBotTurn();
}

function chooseBotCard(player) {
  const legal = legalCards(player);
  const contract = CONTRACTS[state.round];
  const leadSuit = state.currentTrick[0]?.card.suit.id;
  const risky = card => Math.abs(contract.score([card], state.trickNumber));
  if (!leadSuit) return [...legal].sort((a, b) => risky(a) - risky(b) || a.rank.value - b.rank.value)[0];
  const winningValue = Math.max(...state.currentTrick.filter(t => t.card.suit.id === leadSuit).map(t => t.card.rank.value));
  const safe = legal.filter(card => card.suit.id !== leadSuit || card.rank.value < winningValue);
  return [...(safe.length ? safe : legal)].sort((a, b) => risky(b) - risky(a) || a.rank.value - b.rank.value)[0];
}

function maybeBotTurn() {
  if (!state.running || state.turn === 0) return;
  window.setTimeout(() => playCard(state.turn, chooseBotCard(state.turn).id), 550);
}

function resolveTrick() {
  const leadSuit = state.currentTrick[0].card.suit.id;
  const winnerPlay = state.currentTrick
    .filter(play => play.card.suit.id === leadSuit)
    .sort((a, b) => b.card.rank.value - a.card.rank.value)[0];
  const winner = winnerPlay.player;
  const trickCards = state.currentTrick.map(play => play.card);
  const delta = CONTRACTS[state.round].score(trickCards, state.trickNumber);
  state.scores[winner] += delta;
  state.taken[winner] += 1;
  state.leader = winner;
  state.turn = winner;
  state.currentTrick = [];
  state.message = `${PLAYERS[winner]} забирает взятку ${state.trickNumber} (${delta > 0 ? '+' : ''}${delta}).`;
  state.trickNumber += 1;
  if (state.hands.every(hand => hand.length === 0)) {
    state.round += 1;
    if (state.round >= CONTRACTS.length) finishGame();
    else window.setTimeout(startRound, 1100);
  } else {
    render();
    maybeBotTurn();
  }
}

function finishGame() {
  state.running = false;
  const best = Math.max(...state.scores);
  const winners = PLAYERS.filter((_, index) => state.scores[index] === best).join(', ');
  state.message = `Партия окончена. Победитель: ${winners}!`;
  tg?.HapticFeedback?.notificationOccurred(state.scores[0] === best ? 'success' : 'warning');
  render();
}

function formatCard(card) {
  return `${card.rank.id}${card.suit.symbol}`;
}

function hint() {
  if (!state.running || state.turn !== 0) return;
  const card = chooseBotCard(0);
  state.message = `Подсказка: можно сыграть ${formatCard(card)}.`;
  render();
}

function render() {
  const contract = CONTRACTS[Math.min(state.round, CONTRACTS.length - 1)];
  el.contractTitle.textContent = contract.title;
  el.contractDescription.textContent = contract.description;
  el.roundLabel.textContent = `Раунд ${Math.min(state.round + 1, CONTRACTS.length)}/${CONTRACTS.length}`;
  el.roundProgress.style.width = `${(Math.min(state.round + 1, CONTRACTS.length) / CONTRACTS.length) * 100}%`;
  el.statusText.textContent = state.message;
  renderScores();
  renderPlayers();
  renderTrick();
  renderHand();
}

function renderScores() {
  el.scoreBoard.innerHTML = PLAYERS.map((name, index) => `
    <div class="score ${index === state.turn && state.running ? 'active' : ''}">
      <span>${name}</span><strong>${state.scores[index]}</strong><small>Взяток: ${state.taken[index] || 0}</small>
    </div>`).join('');
}

function renderPlayers() {
  el.players.innerHTML = PLAYERS.map((name, index) => `
    <div class="player player-${index} ${index === state.turn && state.running ? 'active' : ''}">
      <span>${name}</span><b>${state.hands[index]?.length || 0}</b>
    </div>`).join('');
}

function renderTrick() {
  el.trickArea.innerHTML = state.currentTrick.map(play => cardHtml(play.card, `played-card seat-${play.player}`, PLAYERS[play.player])).join('');
}

function renderHand() {
  const legal = state.turn === 0 ? new Set(legalCards(0).map(card => card.id)) : new Set();
  el.hand.innerHTML = (state.hands[0] || []).map(card => {
    const disabled = !state.running || state.turn !== 0 || !legal.has(card.id);
    return cardHtml(card, `hand-card ${disabled ? 'disabled' : ''}`, '', disabled ? '' : `data-card-id="${card.id}"`);
  }).join('');
}

function cardHtml(card, className, label = '', attrs = '') {
  return `<button class="card ${className} ${card.suit.color}" data-corner="${card.rank.id}${card.suit.symbol}" ${attrs} type="button" aria-label="${label} ${formatCard(card)}">
    <span>${card.rank.id}</span><strong>${card.suit.symbol}</strong>
  </button>`;
}

el.hand.addEventListener('click', event => {
  const button = event.target.closest('[data-card-id]');
  if (button) playCard(0, button.dataset.cardId);
});
el.newGameButton.addEventListener('click', startGame);
el.hintButton.addEventListener('click', hint);
el.rulesButton.addEventListener('click', () => el.rulesDialog.showModal());

initTelegram();
startGame();
