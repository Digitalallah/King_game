import fs from 'node:fs';

const path = 'scripts/patch-order-mode.mjs';
let source = fs.readFileSync(path, 'utf8');
const before = "    renderer.printCentered(`${game.roundNumber + 1}/${game.totalRounds || CONTRACTS.length * 4}`, 72, 291, 14, 14, 8);";
const after = "    renderer.printCentered(String(game.roundNumber + 1) + '/' + String(game.totalRounds || CONTRACTS.length * 4), 72, 291, 14, 14, 8);";
if (!source.includes(before)) throw new Error('Строка для исправления не найдена');
source = source.replace(before, after);
fs.writeFileSync(path, source);
console.log('Миграционный скрипт исправлен.');
