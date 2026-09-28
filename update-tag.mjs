import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Search Tumblr itself: the local snapshot does not know about newly added tags.
export async function findPostIds({ blog, tag, consumerKey, maxRequests = 350, fetchImpl = fetch }) {
  if (!tag?.trim()) throw new Error('Укажите один непустой тег.');
  if (!consumerKey) throw new Error('Нужен TUMBLR_CONSUMER_KEY.');
  const ids = new Set();
  let offset = 0;
  for (let request = 0; request < maxRequests; request++) {
    const url = new URL(`https://api.tumblr.com/v2/blog/${encodeURIComponent(blog)}/posts`);
    url.search = new URLSearchParams({ api_key: consumerKey, tag, limit: '20', offset: String(offset) });
    const response = await fetchImpl(url, {
      headers: { 'user-agent': 'me-stat', accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Поиск по тегу: Tumblr HTTP ${response.status}.`);
    const body = await response.json();
    if (body.meta?.status >= 400) throw new Error(`Поиск по тегу: Tumblr ${body.meta.status}.`);
    const posts = body.response?.posts;
    if (!Array.isArray(posts)) throw new Error('Tumblr не вернул список постов.');
    // total_posts can describe the whole blog; finish only on an empty page.
    if (!posts.length) return [...ids];
    const previousSize = ids.size;
    for (const post of posts) {
      const id = post.id_string ?? (Number.isSafeInteger(post.id) ? String(post.id) : '');
      if (typeof id !== 'string' || !/^\d+$/.test(id)) throw new Error('Tumblr вернул некорректный ID поста.');
      ids.add(id);
    }
    if (ids.size === previousSize) throw new Error('Tumblr повторяет страницу: поиск не завершён.');
    offset += posts.length;
  }
  throw new Error(`Поиск не завершён: исчерпан бюджет ${maxRequests} запросов.`);
}

export function refreshPosts(ids, run = spawnSync) {
  // Bound command-line size; preserve ttags failures, including partial updates (3).
  const cli = fileURLToPath(new URL('./node_modules/tumblr-tags/dist/cli.js', import.meta.url));
  for (let i = 0; i < ids.length; i += 100) {
    const result = run(process.execPath, [cli, 'post', ...ids.slice(i, i + 100)], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

async function main() {
  if (process.argv.length !== 3) throw new Error('Использование: node update-tag.mjs "новый тег"');
  const config = JSON.parse(await readFile('ttags.config.json', 'utf8'));
  const ids = await findPostIds({ ...config, tag: process.argv[2], consumerKey: process.env.TUMBLR_CONSUMER_KEY });
  console.log(`Найдено постов: ${ids.length}`);
  if (!ids.length) throw new Error('Посты не найдены. Проверьте тег и повторите запуск позже.');
  process.exitCode = refreshPosts(ids);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
