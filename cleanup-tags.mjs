import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const DRY_RUN = !process.argv.includes('--apply');
const FILE = resolve(import.meta.dirname, 'tmp/source.json');

const data = JSON.parse(readFileSync(FILE, 'utf8'));
const { tags, posts } = data;

const usedIds = new Set(Object.values(posts).flat());

const unused = Object.entries(tags).filter(([, id]) => !usedIds.has(id));

if (unused.length === 0) {
  console.log('No unused tags found.');
  process.exit(0);
}

console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Found ${unused.length} unused tags:`);
for (const [name, id] of unused.sort(([a], [b]) => a.localeCompare(b, 'ru'))) {
  console.log(`  [${id}] ${name}`);
}

if (DRY_RUN) {
  console.log('\nRun with --apply to remove them.');
} else {
  for (const [name] of unused) {
    delete tags[name];
  }
  writeFileSync(FILE, JSON.stringify(data), 'utf8');
  console.log(`\nRemoved ${unused.length} tags. File updated.`);
}
