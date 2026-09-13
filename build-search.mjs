/**
 * Собирает самодостаточную HTML-страницу поиска по комбинациям тегов.
 *
 * Usage:
 *   node build-search.mjs [output.html] [--previews] [--artifact]
 *
 * --previews включает плитку с превью постов. Работает только там, где нет
 * строгого CSP (gh-pages); в Artifact на claude.ai внешние запросы запрещены.
 *
 * --artifact отдаёт голый фрагмент: Artifact сам оборачивает файл в скелет с
 * charset и viewport. Обычной странице этот скелет нужен свой, иначе телефон
 * рисует её в 980 px, а без doctype браузер уходит в quirks mode.
 *
 * Источник: снапшот tmp/source.json (schema 2) от `ttags` — теги плотным
 * массивом имён, посты по порядку, новые сверху.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { load, boards } from './combos.mjs';

const SOURCE = resolve(import.meta.dirname, 'tmp/source.json');
const TEMPLATE = resolve(import.meta.dirname, 'search-template.html');
const args = process.argv.slice(2);
const PREVIEWS = args.includes('--previews');
const ARTIFACT = args.includes('--artifact');

const target = args.find((a) => !a.startsWith('--'));
const OUT = target
  ? resolve(target)
  : '/private/tmp/claude-501/-Users-romanyanke-localhost-me-stat/528fda0e-c5be-417c-acc3-caa7b7c6e50e/scratchpad/tag-search.html';

const snapshot = JSON.parse(readFileSync(SOURCE, 'utf8'));

// Снапшот уже в нужной форме: порядок постов и плотные номера тегов —
// часть его формата, пересортировывать и перенумеровывать нечего.
const data = {
  tags: snapshot.tags,
  posts: snapshot.posts.map((post) => post.id),
  postTags: snapshot.posts.map((post) => post.tags),
};

// Подборка для пустого экрана: [[имена тегов], сколько постов]. Полный список
// со всеми метриками живёт на отдельной странице (build-combos.mjs).
const START_COMBOS = 300;
const combos = boards(load(), START_COMBOS)
  .find((b) => b.id === 'surprising')
  .rows.map((r) => [r.names, r.c]);

const html = readFileSync(TEMPLATE, 'utf8')
  .replace('__PREVIEWS__', String(PREVIEWS))
  .replace('__COMBOS__', () => JSON.stringify(combos))
  .replace(
  '__DATA__',
  // </script> внутри данных сломал бы страницу; имён с таким текстом нет, но дёшево подстраховаться.
  () => JSON.stringify(data).replace(/</g, '\\u003c')
);

const page = ARTIFACT
  ? html
  : '<!doctype html>\n<html lang="ru">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    html;

writeFileSync(OUT, page, 'utf8');

const kb = (page.length / 1024).toFixed(0);
console.log(`${OUT}`);
console.log(
  `${data.posts.length} постов, ${data.tags.length} тегов, ${combos.length} комбинаций, ` +
    `${kb} КБ, превью: ${PREVIEWS ? 'да' : 'нет'}`
);
