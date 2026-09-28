import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPostIds, refreshPosts } from './update-tag.mjs';

const options = { blog: 'me-yanke', tag: 'новый тег & кот', consumerKey: 'test' };
const page = posts => ({ ok: true, json: async () => ({ response: { posts, total_posts: 9999 } }) });

test('searches live pages, encodes the tag, preserves large IDs and deduplicates', async () => {
  const offsets = [];
  const pages = [[{ id_string: '9007199254740993' }], [{ id_string: '9007199254740993' }, { id: 42 }], []];
  const ids = await findPostIds({ ...options, fetchImpl: async url => {
    assert.equal(url.searchParams.get('tag'), options.tag);
    assert.equal(url.pathname, '/v2/blog/me-yanke/posts');
    offsets.push(url.searchParams.get('offset'));
    return page(pages.shift());
  } });
  assert.deepEqual(ids, ['9007199254740993', '42']);
  assert.deepEqual(offsets, ['0', '1', '3']);
});

test('empty results are returned without using total_posts', async () => {
  assert.deepEqual(await findPostIds({ ...options, fetchImpl: async () => page([]) }), []);
});

test('incomplete searches fail instead of returning a partial ID list', async () => {
  await assert.rejects(findPostIds({ ...options, maxRequests: 1, fetchImpl: async () => page([{ id: 1 }]) }), /бюджет/);
  await assert.rejects(findPostIds({ ...options, fetchImpl: async () => page([{ id: 1 }]) }), /повторяет/);
  await assert.rejects(findPostIds({ ...options, fetchImpl: async () => ({ ok: false, status: 429 }) }), /429/);
  await assert.rejects(findPostIds({ ...options, fetchImpl: async () => page([{ id: 9007199254740992 }]) }), /ID/);
});

test('updates every ID in bounded batches and propagates partial-update failure', () => {
  const ids = Array.from({ length: 205 }, (_, i) => String(i + 1));
  const batches = [];
  assert.equal(refreshPosts(ids, (executable, args) => {
    assert.equal(executable, process.execPath);
    assert.equal(args[1], 'post');
    batches.push(args.slice(2));
    return { status: 0 };
  }), 0);
  assert.deepEqual(batches.map(batch => batch.length), [100, 100, 5]);
  assert.deepEqual(batches.flat(), ids);
  let calls = 0;
  assert.equal(refreshPosts(ids, () => { calls++; return { status: 3 }; }), 3);
  assert.equal(calls, 1);
});
