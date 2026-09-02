/**
 * Собирает страницу интересных комбинаций тегов.
 *
 * Usage:
 *   node build-combos.mjs [output.html] [--limit 120]
 *
 * Метрики и пороги — в combos.mjs. Страница статическая, без JS: каждая строка
 * ссылается на готовую выборку в search.html.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { load, boards, link } from './combos.mjs';

const TEMPLATE = resolve(import.meta.dirname, 'combos-template.html');

const args = process.argv.slice(2);
const limitAt = args.indexOf('--limit');
const LIMIT = limitAt === -1 ? 200 : Number(args[limitAt + 1]);
const skip = limitAt === -1 ? -1 : limitAt + 1;   // значение флага — не путь к файлу
const target = args.find((a, i) => !a.startsWith('--') && i !== skip);
const OUT = resolve(target || resolve(import.meta.dirname, 'html/combos.html'));

const escape = (str) =>
  str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const spaced = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const times = (lift) => (lift >= 100 ? '×' + Math.round(lift) : '×' + lift.toFixed(1));

function comboCell(names) {
  const inner = names
    .map((n) => escape(n))
    .join('<span class="op">+</span>');

  return `<td class="combo"><a href="${escape(link(names))}">${inner}</a></td>`;
}

function row(entry) {
  return [
    '        <tr>',
    '  ' + comboCell(entry.names),
    `          <td class="hits">${entry.c}</td>`,
    `          <td>${entry.counts.join(' / ')}</td>`,
    `          <td class="lift">${times(entry.lift)}</td>`,
    `          <td>${entry.dom.toFixed(2)}</td>`,
    '        </tr>',
  ].join('\n');
}

function board(b) {
  const shown = b.rows.length;
  const tail = b.found > shown ? ` из ${spaced(b.found)}` : '';

  return `  <section class="board">
    <h2 id="${b.id}">${escape(b.title)}</h2>
    <p class="note">${escape(b.note)}</p>
    <p class="found">${spaced(shown)}${tail}</p>
    <div class="scroller">
      <table>
        <thead>
          <tr>
            <th>Комбинация</th>
            <th title="Сколько постов в выборке">Постов</th>
            <th title="Сколько постов у каждого тега по отдельности">По отдельности</th>
            <th title="Во сколько раз чаще, чем если бы теги ставились независимо">Чаще случайного</th>
            <th title="Какую долю жизни тега занимает эта пара">Вложенность</th>
          </tr>
        </thead>
        <tbody>
${b.rows.map(row).join('\n')}
        </tbody>
      </table>
    </div>
  </section>`;
}

const data = load();
const all = boards(data, LIMIT);

const html = readFileSync(TEMPLATE, 'utf8')
  .replace('__POSTS__', spaced(data.total))
  .replace('__TAGS__', spaced(data.count.size))
  .replace('__JUMP__', all.map((b) => `<li><a href="#${b.id}">${escape(b.title)}</a></li>`).join(''))
  .replace('__BOARDS__', () => all.map(board).join('\n\n'));

writeFileSync(OUT, html, 'utf8');

console.log(OUT);
console.log(
  `${all.length} списков, по ${LIMIT} строк, ${(html.length / 1024).toFixed(0)} КБ\n` +
    all.map((b) => `  ${b.title}: ${b.found}`).join('\n')
);
