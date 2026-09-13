/**
 * Убирает из снапшота теги, на которые не ссылается ни один пост.
 *
 * Usage:
 *   node cleanup-tags.mjs [--apply]
 *
 * Мёртвые теги остаются после переразметки: `ttags` перечитывает пост, тег
 * уходит из него, а имя в словаре живёт дальше. Без --apply только показывает
 * список; с ним ещё и уплотняет номера оставшихся (это делает compactTags —
 * сам по себе `ttags` номера не двигает, чтобы не ломать чужие ссылки на них).
 */

import { readSnapshot, writeSnapshot, unusedTags, compactTags } from 'tumblr-tags';
import { resolve } from 'path';

const DRY_RUN = !process.argv.includes('--apply');
const FILE = resolve(import.meta.dirname, 'tmp/source.json');

const snapshot = await readSnapshot(FILE);
const unused = unusedTags(snapshot);

if (unused.length === 0) {
  console.log('No unused tags found.');
  process.exit(0);
}

console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Found ${unused.length} unused tags:`);
for (const name of [...unused].sort((a, b) => a.localeCompare(b, 'ru'))) {
  console.log(`  ${name}`);
}

if (DRY_RUN) {
  console.log('\nRun with --apply to remove them.');
} else {
  await writeSnapshot(FILE, compactTags(snapshot));
  console.log(`\nRemoved ${unused.length} tags, renumbered the rest. File updated.`);
}
