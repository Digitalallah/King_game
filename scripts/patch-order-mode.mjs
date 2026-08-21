import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(path, search, replacement) {
  const source = read(path);
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`Не найден фрагмент в ${path}: ${search.slice(0, 80)}`);
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`Фрагмент в ${path} встречается больше одного раза`);
  write(path, `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`);
}

function replaceRegex(path, expression, replacement) {
  const source = read(path);
  const matches = source.match(new RegExp(expression.source, expression.flags.includes('g') ? expression.flags : `${expression.flags}g`));
  if (!matches || matches.length !== 1) throw new Error(`Ожидалось одно совпадение в ${path}, найдено ${matches?.length || 0}: ${expression}`);
  write(path, source.replace(expression, replacement));
}

const native = 'src/native-game.js';

replaceOnce(native,
`  CHARACTERS,
  CONTRACTS,
  chooseAiCard,
`,
`  CHARACTERS,
  CONTRACTS,
  GAME_MODES,
  SUIT_SYMBOLS,
  chooseAiCard,
  chooseAiContract,
  contractIsResolved,
`);

replaceOnce(native, "} from './game-engine.js?v=native-8';", "} from './game-engine.js?v=native-10';");
replaceOnce(native, "} from './network-client.js?v=native-9';", "} from './network-client.js?v=native-10';");

replaceOnce(native,
`  startOverlay: document.querySelector('#startOverlay'),
  savedGameInfo: document.querySelector('#savedGameInfo'),
`,
`  startOverlay: document.querySelector('#startOverlay'),
  modeDialog: document.querySelector('#modeDialog'),
  classicModeButton: document.querySelector('#classicModeButton'),
  orderedModeButton: document.querySelector('#orderedModeButton'),
  contractDialog: document.querySelector('#contractDialog'),
  contractChoiceTitle: document.querySelector('#contractChoiceTitle'),
  contractChoiceLead: document.querySelector('#contractChoiceLead'),
  contractChoices: document.querySelector('#contractChoices'),
  savedGameInfo: document.querySelector('#savedGameInfo'),
`);

replaceOnce(native, "const SAVE_VERSION = 1;", "const SAVE_VERSION = 2;");
replaceOnce(native,
`let selectedPartnerIds = [];
let selectedSeatChoices = [];
let game = null;
`,
`let selectedPartnerIds = [];
let selectedSeatChoices = [];
let selectedGameMode = GAME_MODES.CLASSIC;
let game = null;
`);

replaceRegex(native,
/function loadSavedGame\(\) \{[\s\S]*?\n\}\n\nfunction saveCurrentGame\(\) \{[\s\S]*?\n\}\n\nfunction prepareAudio/,
`function loadSavedGame() {
  try {
    const raw = window.localStorage?.getItem(SAVE_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved.version === 1) {
      saved.mode = GAME_MODES.CLASSIC;
      saved.roundNumber = saved.contractIndex;
      saved.ordererSeat = null;
      saved.remainingContracts = null;
    }
    if (![1, SAVE_VERSION].includes(saved.version)) throw new Error('Invalid saved version');

    const mode = saved.mode === GAME_MODES.ORDERED ? GAME_MODES.ORDERED : GAME_MODES.CLASSIC;
    const totalRounds = mode === GAME_MODES.ORDERED ? CONTRACTS.length * 4 : CONTRACTS.length;
    const partnerIds = saved.selectedPartnerIds;
    const validPartners = Array.isArray(partnerIds)
      && partnerIds.length === 3
      && new Set(partnerIds).size === 3
      && partnerIds.every(id => Number.isInteger(id) && CHARACTERS[id]);
    const validStatus = ['contract-choice', 'playing', 'trick-await', 'contract-result'].includes(saved.status);
    const validHands = Array.isArray(saved.hands)
      && saved.hands.length === 4
      && saved.hands.every(hand => Array.isArray(hand) && hand.length <= 8);
    const validTrick = Array.isArray(saved.trick)
      && saved.trick.length <= 4
      && saved.trick.every(entry => (
        Number.isInteger(entry?.seat)
        && entry.seat >= 0
        && entry.seat < 4
        && typeof entry.cardId === 'string'
      ));
    const validContract = saved.status === 'contract-choice'
      ? saved.contractIndex === null
      : Number.isInteger(saved.contractIndex)
        && saved.contractIndex >= 0
        && saved.contractIndex < CONTRACTS.length;
    const validRound = Number.isInteger(saved.roundNumber)
      && saved.roundNumber >= 0
      && saved.roundNumber < totalRounds;
    const validNumbers = Number.isInteger(saved.randomState)
      && saved.randomState > 0
      && validContract
      && validRound
      && Number.isInteger(saved.currentSeat)
      && saved.currentSeat >= 0
      && saved.currentSeat < 4
      && Number.isInteger(saved.trickNumber)
      && saved.trickNumber >= 0
      && saved.trickNumber <= 8;
    const validOrder = mode === GAME_MODES.CLASSIC
      ? saved.ordererSeat === null
      : Number.isInteger(saved.ordererSeat) && saved.ordererSeat >= 0 && saved.ordererSeat < 4;
    const validRemaining = mode === GAME_MODES.CLASSIC
      ? saved.remainingContracts === null
      : Array.isArray(saved.remainingContracts)
        && saved.remainingContracts.length === 4
        && saved.remainingContracts.every(list => (
          Array.isArray(list)
          && new Set(list).size === list.length
          && list.every(index => Number.isInteger(index) && CONTRACTS[index])
        ));

    if (
      !validPartners
      || !validStatus
      || !validHands
      || !validTrick
      || !validNumbers
      || !validOrder
      || !validRemaining
      || !scoreArray(saved.scores)
      || !scoreArray(saved.dealScores)
      || (saved.status === 'playing' && saved.trick.length >= 4)
      || (saved.status === 'trick-await' && saved.trick.length !== 4)
      || ((saved.status === 'contract-choice' || saved.status === 'contract-result') && saved.trick.length !== 0)
    ) throw new Error('Invalid saved game');

    const usedCardIds = new Set();
    const restoreCard = cardId => {
      const card = CARD_BY_ID.get(cardId);
      if (!card || usedCardIds.has(cardId)) throw new Error('Invalid saved cards');
      usedCardIds.add(cardId);
      return card;
    };
    const hands = saved.hands.map(hand => hand.map(restoreCard));
    const trickSeats = new Set();
    const trick = saved.trick.map(entry => {
      if (trickSeats.has(entry.seat)) throw new Error('Invalid saved trick');
      trickSeats.add(entry.seat);
      return { seat: entry.seat, card: restoreCard(entry.cardId) };
    });
    const trickWinnerSeat = saved.trickWinnerSeat === null
      ? null
      : Number(saved.trickWinnerSeat);
    if (
      trickWinnerSeat !== null
      && (!Number.isInteger(trickWinnerSeat) || trickWinnerSeat < 0 || trickWinnerSeat > 3)
    ) throw new Error('Invalid saved trick winner');
    if (
      (saved.status === 'trick-await' && trickWinnerSeat !== saved.currentSeat)
      || (saved.status !== 'trick-await' && trickWinnerSeat !== null)
      || (saved.status === 'contract-result' && hands.some(hand => hand.length !== 0))
    ) throw new Error('Inconsistent saved state');

    return {
      selectedPartnerIds: [...partnerIds],
      mode,
      randomState: saved.randomState,
      scores: [...saved.scores],
      dealScores: [...saved.dealScores],
      hands,
      trick,
      trickWinnerSeat,
      trickNumber: saved.trickNumber,
      currentSeat: saved.currentSeat,
      contractIndex: saved.contractIndex,
      roundNumber: saved.roundNumber,
      ordererSeat: saved.ordererSeat,
      remainingContracts: saved.remainingContracts?.map(list => [...list]) ?? null,
      status: saved.status,
      savedAt: Number(saved.savedAt) || 0,
    };
  } catch {
    removeSavedGame();
    return null;
  }
}

function saveCurrentGame() {
  if (
    networkMode
    || screen !== 'table'
    || !game
    || !['contract-choice', 'playing', 'trick-await', 'contract-result'].includes(game.status)
  ) return;

  try {
    const payload = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      selectedPartnerIds: game.characters.map(character => character.id),
      mode: game.mode,
      randomState: game.random.getState(),
      scores: [...game.scores],
      dealScores: [...game.dealScores],
      hands: game.hands.map(hand => hand.map(card => card.id)),
      trick: game.trick.map(entry => ({ seat: entry.seat, cardId: entry.card.id })),
      trickWinnerSeat: game.trickWinnerSeat,
      trickNumber: game.trickNumber,
      currentSeat: game.currentSeat,
      contractIndex: game.contractIndex,
      roundNumber: game.roundNumber,
      ordererSeat: game.ordererSeat,
      remainingContracts: game.remainingContracts?.map(list => [...list]) ?? null,
      status: game.status,
    };
    window.localStorage?.setItem(SAVE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Saving is best-effort when private mode or the host blocks localStorage.
  }
}

function prepareAudio`);

replaceRegex(native,
/function drawContractPanel\(\) \{[\s\S]*?\n\}/,
`function drawContractPanel() {
  renderer.fillRect(12, 253, 121, 59, 2);
  renderer.strokeRect(12, 253, 121, 59, 0, 2);
  if (game.status === 'contract-choice' || game.contractIndex === null) {
    renderer.printCentered('ЗАКАЗ', 72, 257, 15, 14, 8);
    renderer.printCentered('КОНТРАКТА', 72, 274, 15, 14, 7);
    renderer.printCentered(`${game.roundNumber + 1}/${game.totalRounds || CONTRACTS.length * 4}`, 72, 291, 14, 14, 8);
    return;
  }
  const contract = CONTRACTS[game.contractIndex];
  renderer.printCentered(contract.titleLines[0], 72, 257, 15, 14, 8);
  renderer.printCentered(contract.titleLines[1], 72, 274, 15, 14, 8);
  renderer.printCentered(contract.titleLines[2], 72, 291, contract.direction > 0 ? 10 : 11, 14, 8);
}`);

replaceOnce(native,
`  const summary = isFinal
    ? \`${'${winnerSeats.length === 1 ? \'ПОБЕДИТЕЛЬ\' : \'НИЧЬЯ\'}'}: ${'${winnerSeats.map(seat => names[seat]).join(\', \')}'}\`
    : \`ОБЩИЙ СЧЁТ ПОСЛЕ ${'${game.contractIndex + 1}'} ИЗ ${'${CONTRACTS.length}'}\`;
`,
`  const summary = isFinal
    ? \`${'${winnerSeats.length === 1 ? \'ПОБЕДИТЕЛЬ\' : \'НИЧЬЯ\'}'}: ${'${winnerSeats.map(seat => names[seat]).join(\', \')}'}\`
    : \`ОБЩИЙ СЧЁТ ПОСЛЕ ${'${game.roundNumber + 1}'} ИЗ ${'${game.totalRounds || CONTRACTS.length}'}\`;
`);

replaceOnce(native,
`function playerHelpText() {
  return 'Ваш ход. Один тап выбирает карту, второй тап по ней кладёт её на стол.';
}
`,
`function playerHelpText() {
  return 'Ваш ход. Один тап выбирает карту, второй тап по ней кладёт её на стол.';
}

function illegalCardHint(hand, trick, contract, card) {
  const leadSuit = trick?.[0]?.card?.suit;
  if (leadSuit && hand.some(candidate => candidate.suit === leadSuit) && card.suit !== leadSuit) {
    const symbol = SUIT_SYMBOLS[leadSuit] || '';
    return \`Нужно ходить ${'${symbol}'}: масть задаёт первая карта взятки. Вторая карта масть хода не меняет.\`;
  }
  if (!leadSuit && contract?.heartLeadRestricted && card.suit === 'hearts' && hand.some(candidate => candidate.suit !== 'hearts')) {
    return 'С червей нельзя начинать эту взятку, пока на руке есть другая масть.';
  }
  if (leadSuit && contract?.forceKingDiscard && !hand.some(candidate => candidate.suit === leadSuit)) {
    const king = hand.find(candidate => candidate.suit === 'hearts' && candidate.rank === 13);
    if (king && card.id !== king.id) return 'Нет масти хода: в этом контракте нужно сбросить Кинга.';
  }
  return 'Этой картой сейчас нельзя ходить: соблюдайте масть первой карты.';
}
`);

replaceOnce(native,
`    setHint('Этой картой сейчас нельзя ходить: соблюдайте масть первой карты.');
`,
`    setHint(illegalCardHint(game.hands[PLAYER_SEAT], game.trick, CONTRACTS[game.contractIndex], card));
`);

replaceOnce(native,
`  const card = chooseAiCard(hand, game.trick, contract, game.trickNumber, game.random);
`,
`  const character = game.characters[game.currentSeat - 1];
  const card = chooseAiCard(hand, game.trick, contract, game.trickNumber, game.random, {
    character,
    skill: character?.skill,
    seat: game.currentSeat,
    hands: game.hands,
  });
`);

replaceOnce(native,
`  if (game.trickNumber >= 8) {
    await finishContract(token);
    return;
  }
`,
`  if (game.trickNumber >= 8 || contractIsResolved(CONTRACTS[game.contractIndex], game.hands)) {
    game.hands = [[], [], [], []];
    await finishContract(token);
    return;
  }
`);

replaceRegex(native,
/async function finishContract\(token\) \{[\s\S]*?\n\}\n\nfunction startContract\(contractIndex\) \{[\s\S]*?\n\}\n\nfunction visualSeat/,
`function finishLocalGame() {
  game.status = 'game-over';
  removeSavedGame();
  closeContractDialog();
  render();
  const { winningScore, winnerSeats } = matchResult(game.scores);
  const winnerNames = winnerSeats.map(seat => game.playerNames[seat]).join(', ');
  const resultText = winnerSeats.length === 1
    ? \`Победитель: ${'${winnerNames}'}\`
    : \`Ничья: ${'${winnerNames}'}\`;
  setHint(\`${'${resultText}'}. Лучший счёт: ${'${formatScore(winningScore)}'}. Для новой партии нажмите «Начать заново».\`);
  tg?.HapticFeedback?.notificationOccurred?.('success');
}

async function finishContract(token) {
  if (token !== runToken) return;
  game.status = 'contract-result';
  inputLocked = true;
  closeContractDialog();
  saveCurrentGame();
  render();
  setHint('Раздача окончена. Следующая начнётся через несколько секунд.');

  if (!await gameDelay(CONTRACT_RESULT_MS, token)) return;
  if (game.mode === GAME_MODES.ORDERED) {
    if (game.roundNumber >= CONTRACTS.length * 4 - 1) finishLocalGame();
    else startOrderedRound(game.roundNumber + 1);
    return;
  }
  if (game.contractIndex >= CONTRACTS.length - 1) {
    finishLocalGame();
    return;
  }
  startContract(game.contractIndex + 1);
}

function activateOrderedContract(contractIndex, token = runToken) {
  if (!game || game.mode !== GAME_MODES.ORDERED || game.status !== 'contract-choice') return false;
  const seat = game.ordererSeat;
  const available = game.remainingContracts?.[seat] || [];
  if (!available.includes(contractIndex)) return false;
  game.remainingContracts[seat] = available.filter(index => index !== contractIndex);
  game.contractIndex = contractIndex;
  game.currentSeat = seat;
  game.status = 'playing';
  inputLocked = true;
  closeContractDialog();
  saveCurrentGame();
  render();
  setHint(\`${'${CONTRACTS[contractIndex].name}'}. Заказ принят.\`);
  void continueCurrentTurn(token, 520);
  return true;
}

async function continueContractChoice(token, extraDelay = 0) {
  if (token !== runToken || !game || game.status !== 'contract-choice') return;
  if (game.ordererSeat === PLAYER_SEAT) {
    inputLocked = true;
    render();
    showContractChoice();
    setHint('Ваш заказ. Выберите контракт для этой раздачи.');
    return;
  }
  inputLocked = true;
  closeContractDialog();
  render();
  setHint(\`${'${game.playerNames[game.ordererSeat]}'} выбирает контракт…\`);
  if (!await gameDelay(AI_THINK_MS + extraDelay, token)) return;
  const seat = game.ordererSeat;
  const character = game.characters[seat - 1];
  const available = game.remainingContracts[seat];
  const contractIndex = chooseAiContract(game.hands[seat], available, game.random, {
    character,
    skill: character?.skill,
    seat,
    hands: game.hands,
  });
  activateOrderedContract(contractIndex, token);
}

function startOrderedRound(roundNumber) {
  const token = ++runToken;
  game.mode = GAME_MODES.ORDERED;
  game.roundNumber = roundNumber;
  game.totalRounds = CONTRACTS.length * 4;
  game.contractIndex = null;
  game.ordererSeat = (roundNumber + 1) % 4;
  game.hands = dealHands(shuffleDeck(createDeck(), game.random));
  game.trick = [];
  game.trickWinnerSeat = null;
  game.trickNumber = 0;
  game.dealScores = [0, 0, 0, 0];
  game.currentSeat = game.ordererSeat;
  game.status = 'contract-choice';
  selectedCardId = null;
  inputLocked = true;
  saveCurrentGame();
  render();
  void continueContractChoice(token, 720);
}

function startContract(contractIndex) {
  const token = ++runToken;
  game.mode = GAME_MODES.CLASSIC;
  game.roundNumber = contractIndex;
  game.totalRounds = CONTRACTS.length;
  game.contractIndex = contractIndex;
  game.ordererSeat = null;
  game.hands = dealHands(shuffleDeck(createDeck(), game.random));
  game.trick = [];
  game.trickWinnerSeat = null;
  game.trickNumber = 0;
  game.dealScores = [0, 0, 0, 0];
  game.currentSeat = (contractIndex + 1) % 4;
  game.status = 'playing';
  selectedCardId = null;
  inputLocked = true;
  saveCurrentGame();
  render();
  setHint(\`${'${CONTRACTS[contractIndex].name}'}. Раздаём карты…\`);
  void continueCurrentTurn(token, 720);
}

function visualSeat`);

replaceOnce(native,
`    trickWinnerSeat: snapshot.trickWinnerSeat === null
      ? null
      : visualSeat(snapshot.trickWinnerSeat, localSeat),
    trickNumber: snapshot.trickNumber,
    currentSeat: visualSeat(snapshot.currentSeat, localSeat),
    contractIndex: snapshot.contractIndex,
    status: snapshot.status,
`,
`    mode: snapshot.mode || room.mode || GAME_MODES.CLASSIC,
    roundNumber: Number.isInteger(snapshot.roundNumber) ? snapshot.roundNumber : (snapshot.contractIndex || 0),
    totalRounds: Number(snapshot.totalRounds) || CONTRACTS.length,
    ordererSeat: snapshot.ordererSeat === null || snapshot.ordererSeat === undefined
      ? null
      : visualSeat(snapshot.ordererSeat, localSeat),
    availableContractIndexes: [...(snapshot.availableContractIndexes || [])],
    trickWinnerSeat: snapshot.trickWinnerSeat === null
      ? null
      : visualSeat(snapshot.trickWinnerSeat, localSeat),
    trickNumber: snapshot.trickNumber,
    currentSeat: visualSeat(snapshot.currentSeat, localSeat),
    contractIndex: snapshot.contractIndex,
    status: snapshot.status,
`);

replaceOnce(native,
`  if (game.status === 'playing' && game.currentSeat === PLAYER_SEAT) {
    setHint(playerHelpText());
`,
`  if (game.status === 'contract-choice') {
    if (game.currentSeat === PLAYER_SEAT) setHint('Ваш заказ. Выберите контракт для этой раздачи.');
    else setHint(\`${'${game.playerNames[game.currentSeat]}'} выбирает контракт…\`);
  } else if (game.status === 'playing' && game.currentSeat === PLAYER_SEAT) {
    setHint(playerHelpText());
`);

replaceOnce(native,
`  inputLocked = !(
    game.status === 'trick-await'
    || (game.status === 'playing' && game.currentSeat === PLAYER_SEAT && game.legalCardIds.length > 0)
  );
`,
`  inputLocked = !(
    game.status === 'trick-await'
    || (game.status === 'playing' && game.currentSeat === PLAYER_SEAT && game.legalCardIds.length > 0)
  );
  if (game.status === 'contract-choice' && game.currentSeat === PLAYER_SEAT && game.availableContractIndexes.length > 0) {
    showContractChoice();
  } else {
    closeContractDialog();
  }
`);

replaceOnce(native,
`function applyNetworkRoom(room) {
  networkRoom = room;
  networkSetupRole = room.isHost ? 'host' : 'guest';
`,
`function applyNetworkRoom(room) {
  networkRoom = room;
  selectedGameMode = room.mode === GAME_MODES.ORDERED ? GAME_MODES.ORDERED : GAME_MODES.CLASSIC;
  networkSetupRole = room.isHost ? 'host' : 'guest';
`);

replaceOnce(native,
`    const result = networkSetupRole === 'host'
      ? await networkClient.create({ choices: selectedSeatChoices, displayName })
`,
`    const result = networkSetupRole === 'host'
      ? await networkClient.create({ choices: selectedSeatChoices, displayName, mode: selectedGameMode })
`);

replaceOnce(native,
`function startMatch() {
  leaveNetworkView({ forget: false });
  const querySeed = Number(new URLSearchParams(location.search).get('seed'));
  const seed = Number.isFinite(querySeed) && querySeed !== 0 ? querySeed : (Date.now() ^ 0x19930822);
  const characters = selectedPartnerIds.map(id => CHARACTERS[id]);
  game = {
    characters,
    playerNames: ['Товарищ', ...characters.map(character => character.name)],
    random: createSeededRandom(seed),
    scores: [0, 0, 0, 0],
    dealScores: [0, 0, 0, 0],
    hands: [[], [], [], []],
    trick: [],
    trickWinnerSeat: null,
    trickNumber: 0,
    currentSeat: 0,
    contractIndex: 0,
    status: 'playing',
  };
  screen = 'table';
  startContract(0);
}
`,
`function startMatch() {
  leaveNetworkView({ forget: false });
  const querySeed = Number(new URLSearchParams(location.search).get('seed'));
  const seed = Number.isFinite(querySeed) && querySeed !== 0 ? querySeed : (Date.now() ^ 0x19930822);
  const characters = selectedPartnerIds.map(id => CHARACTERS[id]);
  game = {
    characters,
    playerNames: ['Товарищ', ...characters.map(character => character.name)],
    random: createSeededRandom(seed),
    mode: selectedGameMode,
    scores: [0, 0, 0, 0],
    dealScores: [0, 0, 0, 0],
    hands: [[], [], [], []],
    trick: [],
    trickWinnerSeat: null,
    trickNumber: 0,
    currentSeat: 0,
    contractIndex: selectedGameMode === GAME_MODES.ORDERED ? null : 0,
    roundNumber: 0,
    totalRounds: selectedGameMode === GAME_MODES.ORDERED ? CONTRACTS.length * 4 : CONTRACTS.length,
    ordererSeat: selectedGameMode === GAME_MODES.ORDERED ? 1 : null,
    remainingContracts: selectedGameMode === GAME_MODES.ORDERED
      ? Array.from({ length: 4 }, () => CONTRACTS.map(contract => contract.id))
      : null,
    status: selectedGameMode === GAME_MODES.ORDERED ? 'contract-choice' : 'playing',
  };
  screen = 'table';
  if (selectedGameMode === GAME_MODES.ORDERED) startOrderedRound(0);
  else startContract(0);
}
`);

replaceOnce(native,
`  el.savedGameInfo.textContent = saved
    ? \`Сохранено: контракт ${'${saved.contractIndex + 1}'} из ${'${CONTRACTS.length}'}\`
    : (savedNetworkRoom ? 'Можно вернуться в сетевую комнату' : 'Сохранённой игры нет');
`,
`  el.savedGameInfo.textContent = saved
    ? (saved.mode === GAME_MODES.ORDERED
      ? \`Сохранено: заказной режим, раздача ${'${saved.roundNumber + 1}'} из ${'${CONTRACTS.length * 4}'}\`
      : \`Сохранено: контракт ${'${saved.contractIndex + 1}'} из ${'${CONTRACTS.length}'}\`)
    : (savedNetworkRoom ? 'Можно вернуться в сетевую комнату' : 'Сохранённой игры нет');
`);

replaceOnce(native,
`  const token = ++runToken;
  selectedPartnerIds = [...saved.selectedPartnerIds];
`,
`  const token = ++runToken;
  selectedGameMode = saved.mode;
  selectedPartnerIds = [...saved.selectedPartnerIds];
`);

replaceOnce(native,
`    random: createSeededRandom(saved.randomState),
    scores: [...saved.scores],
`,
`    random: createSeededRandom(saved.randomState),
    mode: saved.mode,
    scores: [...saved.scores],
`);

replaceOnce(native,
`    currentSeat: saved.currentSeat,
    contractIndex: saved.contractIndex,
    status: saved.status,
`,
`    currentSeat: saved.currentSeat,
    contractIndex: saved.contractIndex,
    roundNumber: saved.roundNumber,
    totalRounds: saved.mode === GAME_MODES.ORDERED ? CONTRACTS.length * 4 : CONTRACTS.length,
    ordererSeat: saved.ordererSeat,
    remainingContracts: saved.remainingContracts?.map(list => [...list]) ?? null,
    status: saved.status,
`);

replaceOnce(native,
`  if (game.status === 'trick-await') {
`,
`  if (game.status === 'contract-choice') {
    render();
    void continueContractChoice(token, 260);
    return;
  }
  if (game.status === 'trick-await') {
`);

replaceOnce(native,
`function updatePauseState() {
  paused = document.hidden || el.rulesDialog.open || el.aboutDialog.open || el.networkDialog.open;
}
`,
`function updatePauseState() {
  paused = document.hidden
    || el.rulesDialog.open
    || el.aboutDialog.open
    || el.networkDialog.open
    || el.modeDialog.open
    || el.contractDialog.open;
}
`);

replaceOnce(native,
`function openInfoDialog(dialog) {
  dialog.showModal();
  updatePauseState();
}
`,
`function openInfoDialog(dialog) {
  dialog.showModal();
  updatePauseState();
}

function closeContractDialog() {
  if (el.contractDialog.open) el.contractDialog.close();
}

function showContractChoice() {
  if (!game || game.status !== 'contract-choice' || game.currentSeat !== PLAYER_SEAT) return;
  const available = networkMode
    ? game.availableContractIndexes
    : (game.remainingContracts?.[PLAYER_SEAT] || []);
  el.contractChoiceTitle.textContent = 'Заказать контракт';
  el.contractChoiceLead.textContent = \`Раздача ${'${game.roundNumber + 1}'} из ${'${game.totalRounds || CONTRACTS.length * 4}'}. Этот контракт больше нельзя будет заказать вам ещё раз.\`;
  el.contractChoices.replaceChildren();
  for (const index of available) {
    const contract = CONTRACTS[index];
    if (!contract) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.contractIndex = String(index);
    button.textContent = \`${'${contract.titleLines[0]}'} ${'${contract.titleLines[1]}'} (${'${contract.titleLines[2]}'})\`;
    el.contractChoices.append(button);
  }
  if (!el.contractDialog.open) el.contractDialog.showModal();
  updatePauseState();
}

function openModeSelection() {
  if (!el.modeDialog.open) el.modeDialog.showModal();
  updatePauseState();
}

function chooseGameMode(mode) {
  selectedGameMode = mode === GAME_MODES.ORDERED ? GAME_MODES.ORDERED : GAME_MODES.CLASSIC;
  if (el.modeDialog.open) el.modeDialog.close();
  updatePauseState();
  resetToPartnerPicker();
}
`);

replaceOnce(native,
`el.newGameButton.addEventListener('click', resetToPartnerPicker);
`,
`el.newGameButton.addEventListener('click', openModeSelection);
el.classicModeButton.addEventListener('click', () => chooseGameMode(GAME_MODES.CLASSIC));
el.orderedModeButton.addEventListener('click', () => chooseGameMode(GAME_MODES.ORDERED));
el.modeDialog.addEventListener('close', updatePauseState);
el.contractDialog.addEventListener('close', updatePauseState);
el.contractDialog.addEventListener('cancel', event => event.preventDefault());
el.contractChoices.addEventListener('click', event => {
  const button = event.target?.closest?.('button[data-contract-index]');
  if (!button || !game || game.status !== 'contract-choice') return;
  const contractIndex = Number(button.dataset.contractIndex);
  if (!Number.isInteger(contractIndex)) return;
  if (networkMode) {
    networkCommandPending = true;
    if (!networkClient.chooseContract(contractIndex)) networkCommandPending = false;
  } else activateOrderedContract(contractIndex);
});
`);

replaceOnce(native,
`      networkRoom: networkRoom ? {
        roomId: networkRoom.roomId,
`,
`      selectedGameMode,
      networkRoom: networkRoom ? {
        roomId: networkRoom.roomId,
`);

replaceOnce(native,
`      game: game ? {
        status: game.status,
        contractIndex: game.contractIndex,
`,
`      game: game ? {
        mode: game.mode,
        status: game.status,
        contractIndex: game.contractIndex,
        roundNumber: game.roundNumber,
        ordererSeat: game.ordererSeat,
`);

replaceOnce(native,
`        legalPlayerCardIds: game.status === 'playing'
          ? (networkMode
            ? [...(game.legalCardIds || [])]
            : legalCards(game.hands[0], game.trick, CONTRACTS[game.contractIndex]).map(card => card.id))
          : [],
`,
`        legalPlayerCardIds: game.status === 'playing' && game.contractIndex !== null
          ? (networkMode
            ? [...(game.legalCardIds || [])]
            : legalCards(game.hands[0], game.trick, CONTRACTS[game.contractIndex]).map(card => card.id))
          : [],
`);

const room = 'worker/game-room.js';
replaceOnce(room,
`import { CHARACTERS } from '../src/game-engine.js';
`,
`import { CHARACTERS, GAME_MODES } from '../src/game-engine.js';
`);
replaceOnce(room,
`  createNetworkGame,
  gameForPlayer,
  playHumanCard,
`,
`  chooseHumanContract,
  createNetworkGame,
  gameForPlayer,
  playHumanCard,
`);
replaceOnce(room,
`    const { user, choices, displayName } = await request.json();
`,
`    const { user, choices, displayName, mode } = await request.json();
`);
replaceOnce(room,
`      status: 'lobby',
      seats,
`,
`      status: 'lobby',
      mode: mode === GAME_MODES.ORDERED ? GAME_MODES.ORDERED : GAME_MODES.CLASSIC,
      seats,
`);
replaceOnce(room,
`        room.game = createNetworkGame(room.seats, undefined, now);
`,
`        room.game = createNetworkGame(room.seats, undefined, now, room.mode || GAME_MODES.CLASSIC);
`);
replaceOnce(room,
`      if (message.type === 'playCard') {
`,
`      if (message.type === 'chooseContract') {
        if (room.status !== 'playing' || !room.game) throw new Error('Игра ещё не началась.');
        const record = room.seats[session.seat];
        if (record?.type !== 'human' || record.userId !== session.userId) throw new Error('Это место вам не принадлежит.');
        chooseHumanContract(room.game, room.seats, session.seat, Number(message.contractIndex), now);
        room.updatedAt = now;
        await this.saveRoom(room);
        await this.broadcast(room);
        return;
      }

      if (message.type === 'playCard') {
`);
replaceOnce(room,
`      status: room.status,
      localSeat,
`,
`      status: room.status,
      mode: room.mode || GAME_MODES.CLASSIC,
      localSeat,
`);

const styles = 'src/styles.css';
let css = read(styles);
if (!css.includes('.contract-choice-grid')) {
  css += `\n\n.mode-actions {\n  display: grid;\n  gap: 8px;\n}\n\n.contract-dialog {\n  width: min(620px, calc(100vw - 24px));\n}\n\n.contract-choice-grid {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 7px;\n  margin-top: 12px;\n}\n\n.contract-choice-grid button {\n  min-height: 42px;\n}\n\n@media (max-width: 560px) {\n  .contract-choice-grid {\n    grid-template-columns: 1fr;\n  }\n}\n`;
  write(styles, css);
}

console.log('Заказной режим, уровни ИИ и UI-патчи применены.');
