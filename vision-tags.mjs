/**
 * Предлагает теги к постам по фотографии — локальной моделью через Ollama.
 * Ничего не пишет в Tumblr: складывает отчёт в tmp/vision-tags.json.
 *
 * Usage:
 *   node vision-tags.mjs [post-id ...] [--model <name>] [--compare]
 *                        [--limit N] [--free-only] [--size 640]
 *
 * Без post-id берёт --limit случайных недотегированных постов из tmp/source.json.
 *
 * Requires: запущенная Ollama (localhost:11434), модели qwen2.5vl:7b (или своя
 *           через --model) и bge-m3. TUMBLR_CONSUMER_KEY желателен, но не обязателен:
 *           без него фото берётся со страницы поста, а теги — из tmp/source.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = import.meta.dirname;
const TMP = resolve(ROOT, 'tmp');
const IMG_CACHE = resolve(TMP, 'img-cache');
const SOURCE = resolve(TMP, 'source.json');
const REPORT = resolve(TMP, 'vision-tags.json');
const EMB_BIN = resolve(TMP, 'tag-embeddings.bin');
const EMB_META = resolve(TMP, 'tag-embeddings.json');

const BLOG = 'me-yanke.tumblr.com';
const POST_URL = 'https://me.yanke.ru/post/';
const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';
const EMBED_MODEL = 'bge-m3';
const DEFAULT_MODEL = 'qwen2.5vl:7b';
const COMPARE_MODELS = ['qwen2.5vl:7b', 'gemma3:4b'];
const MIN_SCORE = 0.85;

/* ---------- аргументы ---------- */

function parseArgs(argv) {
  const postIds = [];
  const opts = { model: DEFAULT_MODEL, compare: false, limit: 5, freeOnly: false, size: 640 };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--model') { opts.model = argv[++i]; continue; }
    if (arg === '--compare') { opts.compare = true; continue; }
    if (arg === '--limit') { opts.limit = Number(argv[++i]); continue; }
    if (arg === '--free-only') { opts.freeOnly = true; continue; }
    if (arg === '--size') { opts.size = Number(argv[++i]); continue; }
    if (arg.startsWith('--')) { console.error(`Unknown flag: ${arg}`); process.exit(1); }
    postIds.push(arg);
  }

  return { postIds, opts };
}

const { postIds: argIds, opts } = parseArgs(process.argv.slice(2));
const models = opts.compare ? COMPARE_MODELS : [opts.model];

/* ---------- источник постов ---------- */

function readSource() {
  if (!existsSync(SOURCE)) return null;
  return JSON.parse(readFileSync(SOURCE, 'utf8'));
}

// Тегов мало — значит, посту есть куда расти. Такие и берём для теста.
function pickUndertagged(source, limit) {
  const pool = Object.entries(source.posts)
    .filter(([, tagIds]) => tagIds.length <= 1)
    .map(([id]) => id);

  const out = [];
  const seen = new Set();
  while (out.length < limit && seen.size < pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(pool[i]);
  }
  return out;
}

/* ---------- Tumblr ---------- */

// Без ключа посты всё равно достаются: блог отдаёт og:image, а по медиа-хэшу
// рядом в разметке лежит вариант поменьше — та же техника, что у превью в поиске.
const OG_RE = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i;
const SMALL_SIZES = ['s540x810', 's640x960', 's500x750'];

function quote(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findSmaller(html, ogUrl) {
  const legacy = ogUrl.match(/^(https:\/\/[\w.-]*media\.tumblr\.com\/.+?)_1280(\.\w+)$/i);
  if (legacy) return `${legacy[1]}_640${legacy[2]}`;

  const base = ogUrl.match(/^(https:\/\/[\w.-]*media\.tumblr\.com\/[^"'\s]+?\/)s\d+x\d+\//i);
  if (base) {
    for (const size of SMALL_SIZES) {
      const re = new RegExp(quote(base[1]) + size + '/[^"\'\\s]+?\\.(?:jpe?g|png|gifv?|webp)', 'i');
      const hit = html.match(re);
      if (hit) return hit[0];
    }
  }
  return ogUrl;
}

async function fetchPostViaPage(postId) {
  const res = await fetch(POST_URL + postId, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Страница поста ${res.status} для ${postId}`);
  const html = await res.text();

  const og = html.match(OG_RE);
  if (!og) return { type: 'unknown', tags: null, photos: [] };

  const url = findSmaller(html, og[1]);
  return { type: 'photo', tags: null, photos: [{ alt_sizes: [{ url, width: 0, height: 0 }] }] };
}

async function fetchPost(postId, apiKey) {
  const url = `https://api.tumblr.com/v2/blog/${BLOG}/posts?id=${postId}&api_key=${apiKey}&npf=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tumblr API ${res.status} для ${postId}`);
  const body = await res.json();
  const post = body.response?.posts?.[0];
  if (!post) throw new Error(`Пост ${postId} не найден`);
  return post;
}

// Самый маленький вариант, который всё ещё не мыло: 1280 px модели не нужны,
// а 250 px уже не разглядеть.
function pickPhoto(post, minWidth) {
  const photos = post.photos ?? [];
  if (!photos.length) return null;

  const sizes = [...(photos[0].alt_sizes ?? []), photos[0].original_size]
    .filter(Boolean)
    .sort((a, b) => a.width - b.width);

  const fit = sizes.find((s) => s.width >= minWidth) ?? sizes[sizes.length - 1];
  if (!fit?.url) return null;
  return { url: fit.url, width: fit.width, height: fit.height, total: photos.length };
}

async function loadImage(postId, url) {
  mkdirSync(IMG_CACHE, { recursive: true });
  const ext = url.match(/\.(jpe?g|png|gifv?|webp)$/i)?.[1] ?? 'jpg';
  const file = resolve(IMG_CACHE, `${postId}.${ext}`);

  if (existsSync(file)) return readFileSync(file);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Картинка ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}

/* ---------- Ollama ---------- */

async function ollama(path, body) {
  const res = await fetch(`${OLLAMA}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function ask(model, prompt, imageB64, schema) {
  const res = await ollama('/api/chat', {
    model,
    messages: [{ role: 'user', content: prompt, images: [imageB64] }],
    stream: false,
    format: schema,
    options: { temperature: 0 },
  });
  return JSON.parse(res.message.content);
}

/* ---------- шаг 1: свободное описание ---------- */

const FREE_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    objects: { type: 'array', items: { type: 'string' } },
    place: { type: 'string', enum: ['в помещении', 'на улице', 'непонятно'] },
  },
  required: ['description', 'objects', 'place'],
};

const FREE_PROMPT = `Опиши эту фотографию по-русски.

description — одна фраза о том, что на снимке.
objects — от трёх до десяти слов: что именно видно. Существительные в именительном падеже,
единственном числе, строчными буквами. Только то, что действительно есть на фото:
предметы, животные, еда, растения, здания, техника, погода, время года.
place — где снято.

Не выдумывай того, чего не видно. Не пиши оценок и настроений.`;

function describe(model, imageB64) {
  return ask(model, FREE_PROMPT, imageB64, FREE_SCHEMA);
}

/* ---------- шаг 2: привязка к словарю ---------- */

async function embed(input) {
  const res = await ollama('/api/embed', { model: EMBED_MODEL, input });
  return res.embeddings;
}

function normalize(vec) {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const len = Math.sqrt(sum) || 1;
  return vec.map((v) => v / len);
}

// Эмбеддинги 6 000 тегов считаются минуту-другую, поэтому лежат рядом с source.json.
// Кеш привязан к списку тегов и модели: поменялось что-то — считаем заново.
async function tagEmbeddings(tagNames) {
  const stamp = { model: EMBED_MODEL, count: tagNames.length, names: tagNames };

  if (existsSync(EMB_BIN) && existsSync(EMB_META)) {
    const meta = JSON.parse(readFileSync(EMB_META, 'utf8'));
    if (meta.model === stamp.model && meta.count === stamp.count &&
        meta.names.join('\n') === stamp.names.join('\n')) {
      const buf = readFileSync(EMB_BIN);
      const flat = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      return { flat, dim: meta.dim };
    }
  }

  process.stderr.write(`Считаю эмбеддинги ${tagNames.length} тегов (разово)`);
  const BATCH = 256;
  const chunks = [];
  let dim = 0;

  for (let i = 0; i < tagNames.length; i += BATCH) {
    const vecs = await embed(tagNames.slice(i, i + BATCH));
    for (const vec of vecs) {
      dim = vec.length;
      chunks.push(normalize(vec));
    }
    process.stderr.write('.');
  }
  process.stderr.write('\n');

  const flat = new Float32Array(chunks.length * dim);
  chunks.forEach((vec, i) => flat.set(vec, i * dim));

  writeFileSync(EMB_BIN, Buffer.from(flat.buffer));
  writeFileSync(EMB_META, JSON.stringify({ ...stamp, dim }));
  return { flat, dim };
}

function nearest({ flat, dim }, tagNames, query) {
  let best = -1;
  let bestI = 0;
  for (let i = 0; i < tagNames.length; i++) {
    let dot = 0;
    for (let d = 0; d < dim; d++) dot += query[d] * flat[i * dim + d];
    if (dot > best) { best = dot; bestI = i; }
  }
  return { tag: tagNames[bestI], score: Math.round(best * 100) / 100 };
}

// Каждое названное моделью слово тянем к ближайшему существующему тегу.
// Показывать модели список кандидатов бесполезно: на шестидесяти строках 7B то
// соглашается со всем подряд, то возвращает пустоту. А тут точное попадание даёт
// 0.85 и выше («деревянное» → «деревянный» 0.95), ниже начинается снос смысла
// («мышь» → «миска» 0.80, «солома» → «соль» 0.71) — потому и порог.
async function matchVocabulary(objects, vocabulary, tagNames) {
  if (!objects.length) return [];

  const vectors = (await embed(objects)).map(normalize);
  const best = new Map();

  vectors.forEach((vec, i) => {
    const hit = nearest(vocabulary, tagNames, vec);
    if (hit.score < MIN_SCORE) return;
    const seen = best.get(hit.tag);
    if (!seen || hit.score > seen.score) best.set(hit.tag, { ...hit, from: objects[i] });
  });

  return [...best.values()].sort((a, b) => b.score - a.score);
}

/* ---------- прогон ---------- */

function tagNamesOf(source, postId) {
  const byId = source
    ? Object.fromEntries(Object.entries(source.tags).map(([name, id]) => [id, name]))
    : {};
  return (source?.posts?.[postId] ?? []).map((id) => byId[id]).filter(Boolean);
}

async function main() {
  const apiKey = process.env.TUMBLR_CONSUMER_KEY;
  if (!apiKey) {
    console.log('TUMBLR_CONSUMER_KEY не задан — беру фото со страниц постов (og:image).');
    console.log('Текущие теги при этом читаются из tmp/source.json, а не из блога.\n');
  }

  const source = readSource();
  let postIds = argIds;

  if (!postIds.length) {
    if (!source) { console.error(`Нет ${SOURCE} — укажите post-id явно`); process.exit(1); }
    postIds = pickUndertagged(source, opts.limit);
    console.log(`Взял ${postIds.length} недотегированных постов: ${postIds.join(' ')}\n`);
  }

  const tagNames = source ? Object.keys(source.tags) : [];
  const useVocabulary = !opts.freeOnly && tagNames.length > 0;
  const vocabulary = useVocabulary ? await tagEmbeddings(tagNames) : null;

  const report = [];

  // Сначала все фотографии, потом модели — и модели снаружи, посты внутри.
  // Иначе на каждом посте Ollama выгружает одну модель ради другой: с --compare
  // это превращает три секунды на снимок в двадцать.
  for (const postId of postIds) {
    const entry = { id: postId, url: POST_URL + postId, tags: tagNamesOf(source, postId), models: {} };
    report.push(entry);

    try {
      const post = apiKey ? await fetchPost(postId, apiKey) : await fetchPostViaPage(postId);
      const photo = pickPhoto(post, opts.size);

      if (post.tags) entry.tags = post.tags;
      entry.caption = (post.caption ?? post.summary ?? '').replace(/<[^>]+>/g, '').trim() || undefined;

      if (!photo) { entry.skipped = `без фото (тип «${post.type}»)`; continue; }

      entry.photo = { url: photo.url, width: photo.width, height: photo.height };
      if (photo.total > 1) entry.photo.rest = photo.total - 1;
      entry.image = (await loadImage(postId, photo.url)).toString('base64');
    } catch (err) {
      entry.error = err.message;
    }
  }

  for (const model of models) {
    for (const entry of report) {
      if (!entry.image) continue;

      try {
        const started = Date.now();
        const free = await describe(model, entry.image);
        const result = {
          description: free.description,
          place: free.place,
          free: [...new Set(free.objects.map((t) => t.toLowerCase().trim()).filter(Boolean))],
        };

        if (useVocabulary) result.vocabulary = await matchVocabulary(result.free, vocabulary, tagNames);

        result.seconds = Math.round((Date.now() - started) / 100) / 10;
        entry.models[model] = result;
        process.stderr.write(`${model} ${entry.id} ${result.seconds} с\n`);
      } catch (err) {
        entry.error = err.message;
      }
    }
  }

  console.log('');
  for (const entry of report) {
    delete entry.image;
    printEntry(entry);
  }

  writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Отчёт: ${REPORT}`);
}

/* ---------- вывод ---------- */

function printEntry(entry) {
  console.log(`${entry.id}  ${entry.url}`);
  console.log(`  сейчас     ${entry.tags.length ? entry.tags.join(', ') : '—'}`);

  if (entry.error) { console.log(`  ✗ ${entry.error}\n`); return; }
  if (entry.skipped) { console.log(`  ⤳ ${entry.skipped}\n`); return; }

  if (entry.photo?.rest) console.log(`  (в посте ещё ${entry.photo.rest} фото, смотрю первое)`);

  for (const [model, res] of Object.entries(entry.models)) {
    console.log(`  ${model}  ${res.seconds} с`);
    console.log(`    описание ${res.description} [${res.place}]`);
    console.log(`    свободно ${res.free.join(', ') || '—'}`);
    if (res.vocabulary) {
      const shown = res.vocabulary
        .map((v) => (v.tag === v.from ? v.tag : `${v.tag} (${v.from}, ${v.score})`))
        .join(', ');
      console.log(`    из словаря ${shown || '—'}`);
    }
  }
  console.log('');
}

await main();
