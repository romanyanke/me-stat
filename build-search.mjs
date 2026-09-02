/**
 * Собирает самодостаточную HTML-страницу поиска по комбинациям тегов.
 *
 * Usage:
 *   node build-search.mjs [output.html] [--previews]
 *
 * --previews включает плитку с превью постов в айфреймах. Работает только там,
 * где нет строгого CSP (gh-pages); в Artifact на claude.ai frame-src запрещён.
 *
 * Источник: tmp/source.json ({tags: {имя: id}, posts: {postId: [id, ...]}}),
 * который генерится `ttags` (см. package.json).
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const SOURCE = resolve(import.meta.dirname, 'tmp/source.json');
const TEMPLATE = resolve(import.meta.dirname, 'search-template.html');
const args = process.argv.slice(2);
const PREVIEWS = args.includes('--previews');
const target = args.find((a) => !a.startsWith('--'));
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

const html = readFileSync(TEMPLATE, 'utf8')
  .replace('__PREVIEWS__', String(PREVIEWS))
  .replace(
  '__DATA__',
  // </script> внутри данных сломал бы страницу; имён с таким текстом нет, но дёшево подстраховаться.
  () => JSON.stringify(data).replace(/</g, '\\u003c')
);

writeFileSync(OUT, html, 'utf8');

const kb = (html.length / 1024).toFixed(0);
console.log(`${OUT}`);
console.log(`${data.posts.length} постов, ${data.tags.length} тегов, ${kb} КБ, превью: ${PREVIEWS ? 'да' : 'нет'}`);
