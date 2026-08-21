import fs from 'node:fs';

function patch(path, before, after) {
  let source = fs.readFileSync(path, 'utf8');
  if (!source.includes(before)) throw new Error(`Не найден фрагмент в ${path}`);
  source = source.replace(before, after);
  fs.writeFileSync(path, source);
}

patch('test/native-game-integration.test.mjs',
`    '#startOverlay': 'startOverlay',
    '#savedGameInfo': 'savedGameInfo',
`,
`    '#startOverlay': 'startOverlay',
    '#modeDialog': 'modeDialog',
    '#classicModeButton': 'classicModeButton',
    '#orderedModeButton': 'orderedModeButton',
    '#contractDialog': 'contractDialog',
    '#contractChoiceTitle': 'contractChoiceTitle',
    '#contractChoiceLead': 'contractChoiceLead',
    '#contractChoices': 'contractChoices',
    '#savedGameInfo': 'savedGameInfo',
`);

patch('test/native-game-integration.test.mjs',
`  element('newGameButton').emit('click');
  await eventually(() => debug.snapshot().screen === 'partners');
`,
`  element('newGameButton').emit('click');
  assert.equal(element('modeDialog').open, true);
  element('classicModeButton').emit('click');
  await eventually(() => debug.snapshot().screen === 'partners');
`);

patch('test/native-game-integration.test.mjs',
`  assert.equal(saveBeforeReload.version, 1);
`,
`  assert.equal(saveBeforeReload.version, 2);
  assert.equal(saveBeforeReload.mode, 'classic');
`);

patch('test/native-network-ui.test.mjs',
`    'retryButton', 'startOverlay', 'savedGameInfo', 'continueButton', 'continueNetworkButton',
    'newGameButton', 'restartButton', 'soundButton', 'rulesButton', 'aboutButton', 'rulesDialog',
`,
`    'retryButton', 'startOverlay', 'modeDialog', 'classicModeButton', 'orderedModeButton',
    'contractDialog', 'contractChoiceTitle', 'contractChoiceLead', 'contractChoices',
    'savedGameInfo', 'continueButton', 'continueNetworkButton',
    'newGameButton', 'restartButton', 'soundButton', 'rulesButton', 'aboutButton', 'rulesDialog',
`);

patch('test/native-network-ui.test.mjs',
`  element('newGameButton').emit('click');
  tap(70, 160);
`,
`  element('newGameButton').emit('click');
  element('classicModeButton').emit('click');
  tap(70, 160);
`);

patch('test/native-network-ui.test.mjs',
`  assert.equal(JSON.parse(apiRequests.find(request => request.url.pathname === '/api/rooms').init.body).choices[0].type, 'human');
`,
`  const createBody = JSON.parse(apiRequests.find(request => request.url.pathname === '/api/rooms').init.body);
  assert.equal(createBody.choices[0].type, 'human');
  assert.equal(createBody.mode, 'classic');
`);

console.log('Интеграционные тесты адаптированы к выбору режима.');
