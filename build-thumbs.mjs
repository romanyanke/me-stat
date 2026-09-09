/**
 * Собирает адреса превью для страницы поиска.
 *
 * Usage:
 *   TUMBLR_CONSUMER_KEY=... node build-thumbs.mjs [--all] [--out html/thumbs.js]
 *                                                   [--max-requests 300]
 *
 * Раньше карточка сама забирала страницу поста и вынимала из неё og:image, но
 * Tumblr закрыл блог проверкой браузера: me.yanke.ru/post/<id> отдаёт 403 без
 * CORS-заголовков. API живёт отдельно и по-прежнему доступен, поэтому адреса
 * собираются здесь, один раз на сборке, и вшиваются в отдельный файл.
 *
 * Ключ нужен только тут; в страницу он не попадает. Обход инкрементный: посты
 * идут от новых к старым, и на первой полностью известной странице скрипт
 * останавливается (--all обходит всё заново).
 *
 * У Tumblr лимит 1000 запросов в час на ключ, а ttags тратит из него около 300,
 * поэтому за один прогон делается не больше --max-requests запросов. Холодный
 * старт на 15 000 постов просто растянется на несколько прогонов: страница
 * покажет «нет превью» там, где адрес ещё не собран.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

const BLOG = process.env.TUMBLR_BLOG || 'me-yanke';
const KEY = process.env.TUMBLR_CONSUMER_KEY;

const CACHE = resolve(import.meta.dirname, 'tmp/thumbs.json');
const HOST = 'https://64.media.tumblr.com/';
const PAGE = 20;              // столько постов отдаёт API за запрос
const PAUSE = 250;            // мс между запросами, чтобы не ловить 429
const MIN_WIDTH = 500;        // карточка ~250 px, с запасом на retina

const args = process.argv.slice(2);
const FULL = args.includes('--all');
const capAt = args.indexOf('--max-requests');
const MAX_REQUESTS = capAt === -1 ? 300 : Number(args[capAt + 1]);
const outAt = args.indexOf('--out');
const OUT = resolve(
  outAt === -1 ? resolve(import.meta.dirname, 'html/thumbs.js') : args[outAt + 1]
);

if (!KEY) {
  console.error('TUMBLR_CONSUMER_KEY не задан. Ключ лежит в 1Password:');
  console.error('  TUMBLR_CONSUMER_KEY=$(op read "op://Personal/Tumblr/consumer key") node build-thumbs.mjs');
  process.exit(1);
}

const thumbs = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const knownBefore = Object.keys(thumbs).length;

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** Самый маленький вариант шириной от MIN_WIDTH; если таких нет — самый большой. */
function pickSize(photo) {
  const sizes = (photo.alt_sizes || []).concat(photo.original_size ? [photo.original_size] : []);
  if (!sizes.length) return null;

  const wide = sizes.filter((s) => s.width >= MIN_WIDTH).sort((a, b) => a.width - b.width);
  const best = wide[0] || sizes.slice().sort((a, b) => b.width - a.width)[0];
  return best && best.url ? best.url : null;
}

async function fetchPage(offset) {
  const url =
    `https://api.tumblr.com/v2/blog/${BLOG}/posts?api_key=${KEY}` +
    `&type=photo&limit=${PAGE}&offset=${offset}&reblog_info=false&notes_info=false`;

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);

    if (res.status === 429 && attempt <= 5) {
      const naptime = 60_000 * attempt;
      console.error(`  429 от API, ждём ${naptime / 1000} с`);
      await wait(naptime);
      continue;
    }
    if (!res.ok) throw new Error(`API ответил ${res.status} на offset ${offset}`);

    // Tumblr иногда отдаёт 200 с пустым телом; на этом падает и сам ttags.
    const body = await res.json().catch(() => null);
    if (!body || !body.response) {
      if (attempt > 3) throw new Error(`пустой ответ API на offset ${offset}`);
      console.error(`  пустой ответ, повтор через ${10 * attempt} с`);
      await wait(10_000 * attempt);
      continue;
    }

    return body.response;
  }
}

let offset = 0;
let total = null;
let added = 0;
let requests = 0;

for (;;) {
  const page = await fetchPage(offset);
  requests++;

  if (total === null) {
    total = page.total_posts;
    console.log(`${total} фотопостов у ${BLOG}, известно ${knownBefore}`);
  }

  const posts = page.posts || [];
  if (!posts.length) break;

  let fresh = 0;
  for (const post of posts) {
    const id = post.id_string || String(post.id);
    if (thumbs[id] && !FULL) continue;

    const url = pickSize((post.photos || [])[0] || {});
    if (!url || !url.startsWith(HOST)) continue;

    thumbs[id] = url.slice(HOST.length);
    fresh++;
    added++;
  }

  // Посты идут от новых к старым: страница без единой новинки означает, что
  // дальше только то, что уже собрано.
  if (!fresh && !FULL) {
    console.log(`  на offset ${offset} всё уже известно — останавливаемся`);
    break;
  }

  offset += PAGE;
  if (offset >= total) break;

  if (requests >= MAX_REQUESTS) {
    console.log(`  сделано ${requests} запросов — остальное в следующий прогон`);
    break;
  }

  if (requests % 25 === 0) console.log(`  ${offset} из ${total}, добавлено ${added}`);
  await wait(PAUSE);
}

mkdirSync(dirname(CACHE), { recursive: true });
writeFileSync(CACHE, JSON.stringify(thumbs), 'utf8');

const file = `window.meThumbs={"base":${JSON.stringify(HOST)},"thumbs":${JSON.stringify(thumbs)}}`;
writeFileSync(OUT, file, 'utf8');

console.log(OUT);
console.log(
  `${Object.keys(thumbs).length} превью (добавлено ${added}), ` +
    `${requests} запросов к API, ${(file.length / 1024).toFixed(0)} КБ`
);
