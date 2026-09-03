/**
 * Собирает самодостаточную HTML-страницу поиска по комбинациям тегов.
 *
 * Usage:
 *   node build-search.mjs [output.html] [--previews] [--combos-url <url>] [--artifact]
 *
 * --previews включает плитку с превью постов. Работает только там, где нет
 * строгого CSP (gh-pages); в Artifact на claude.ai внешние запросы запрещены.
 *
 * --artifact отдаёт голый фрагмент: Artifact сам оборачивает файл в скелет с
 * charset и viewport. Обычной странице этот скелет нужен свой, иначе телефон
 * рисует её в 980 px, а без doctype браузер уходит в quirks mode.
 *
 * Источник: tmp/source.json ({tags: {имя: id}, posts: {postId: [id, ...]}}),
 * который генерится `ttags` (см. package.json).
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { load, boards } from './combos.mjs';

const SOURCE = resolve(import.meta.dirname, 'tmp/source.json');
const TEMPLATE = resolve(import.meta.dirname, 'search-template.html');
const args = process.argv.slice(2);
const PREVIEWS = args.includes('--previews');
const ARTIFACT = args.includes('--artifact');

// Рядом с search.html на gh-pages лежит combos.html; сборке в другое место
// (например в Artifact) нужен полный адрес.
const urlAt = args.indexOf('--combos-url');
const COMBOS_URL = urlAt === -1 ? 'combos.html' : args[urlAt + 1];
const skip = urlAt === -1 ? -1 : urlAt + 1;   // значение флага — не путь к файлу
const target = args.find((a, i) => !a.startsWith('--') && i !== skip);
const OUT = target
  ? resolve(target)
  : '/private/tmp/claude-501/-Users-romanyanke-localhost-me-stat/528fda0e-c5be-417c-acc3-caa7b7c6e50e/scratchpad/tag-search.html';

const { tags, posts } = JSON.parse(readFileSync(SOURCE, 'utf8'));

// Посты: новые сверху. Id разной длины (12 и 18 знаков) — сравниваем как числа.
const postIds = Object.keys(posts).sort((a, b) =>
  a.length !== b.length ? b.length - a.length : b.localeCompare(a)
);

// Оставляем только теги, которые реально встречаются в постах (как cleanup-tags.mjs).
const used = new Set(postIds.flatMap((id) => posts[id]));
const names = Object.entries(tags)
  .filter(([, id]) => used.has(id))
  .sort(([a], [b]) => a.localeCompare(b, 'ru'));

// Перенумеровываем разреженные id тегов в плотные индексы массива.
const idToIndex = new Map(names.map(([, id], index) => [id, index]));

const postTags = postIds.map((id) =>
  posts[id].map((tagId) => idToIndex.get(tagId)).filter((i) => i !== undefined)
);

const data = {
  tags: names.map(([name]) => name),
  posts: postIds,
  postTags,
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
  .replace('__COMBOS_URL__', COMBOS_URL)
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
