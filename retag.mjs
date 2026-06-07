/**
 * Usage:
 *   node retag.mjs [--dry-run] [--remove <tag>] [--add <tag>] <post-id> [post-id ...]
 *
 * Requires env: TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET, TUMBLR_TOKEN, TUMBLR_TOKEN_SECRET, TUMBLR_BLOG
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const tumblr = require('tumblr.js');

const {
  TUMBLR_CONSUMER_KEY,
  TUMBLR_CONSUMER_SECRET,
  TUMBLR_TOKEN,
  TUMBLR_TOKEN_SECRET,
  TUMBLR_BLOG,
} = process.env;

for (const [k, v] of Object.entries({ TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET, TUMBLR_TOKEN, TUMBLR_TOKEN_SECRET, TUMBLR_BLOG })) {
  if (!v) { console.error(`${k} is not set`); process.exit(1); }
}

const client = tumblr.createClient({
  consumer_key: TUMBLR_CONSUMER_KEY,
  consumer_secret: TUMBLR_CONSUMER_SECRET,
  token: TUMBLR_TOKEN,
  token_secret: TUMBLR_TOKEN_SECRET,
  returnPromises: true,
});

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function parseArgs(args) {
  const postIds = [];
  let remove = null, add = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--remove') { remove = args[++i]; continue; }
    if (args[i] === '--add')    { add    = args[++i]; continue; }
    if (args[i] === '--dry-run') continue;
    postIds.push(args[i]);
  }
  return { postIds, remove, add };
}

const { postIds, remove: tagRemove, add: tagAdd } = parseArgs(args);

if (!postIds.length) { console.error('No post IDs provided'); process.exit(1); }
if (!tagRemove && !tagAdd) { console.error('Provide at least --add or --remove'); process.exit(1); }

async function getPost(postId) {
  const res = await client.blogPosts(TUMBLR_BLOG, { id: postId });
  const post = res.posts?.[0];
  if (!post) throw new Error(`Post ${postId} not found`);
  return post;
}

function applyChanges(currentTags) {
  let tags = [...currentTags];
  if (tagRemove) tags = tags.filter(t => t !== tagRemove);
  if (tagAdd && !tags.includes(tagAdd)) tags.push(tagAdd);
  return tags;
}

for (const postId of postIds) {
  try {
    const post = await getPost(postId);
    const before = post.tags ?? [];
    const after = applyChanges(before);

    const changed = JSON.stringify([...before].sort()) !== JSON.stringify([...after].sort());

    if (!changed) {
      console.log(`${postId}  (no change)`);
      continue;
    }

    console.log(`${postId}`);
    if (tagRemove) console.log(`  - ${tagRemove}`);
    if (tagAdd)    console.log(`  + ${tagAdd}`);

    if (!DRY_RUN) {
      await client.editPost(TUMBLR_BLOG, { id: postId, tags: after.join(',') });
      console.log(`  ✓ updated`);
    }
  } catch (err) {
    console.error(`  ✗ ${postId}: ${err.message}`);
  }
}

if (DRY_RUN) console.log('\n[dry-run] no changes applied');
