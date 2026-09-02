/**
 * Расчёт интересных комбинаций тегов по tmp/source.json.
 *
 * Сортировка по частоте бесполезна: наверху оказываются «Грузия + Тбилиси» и
 * «Таиланд + Пхукет» — одно и то же место, названное дважды. Находки от мусора
 * отличают два признака вместе:
 *
 *   lift = c·N / (ca·cb)          во сколько раз чаще, чем если бы независимо
 *   dom  = max(c/ca, c/cb)        какую долю жизни тега занимает пара
 *
 * Высокий dom — это синонимы и вложенные места, их надо гасить.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const SOURCE = resolve(import.meta.dirname, 'tmp/source.json');

// Пороги подобраны по данным: с ними наверху «неожиданных» оказываются
// «ядро + пушка» и «панда + берлинский зоопарк», а не «Крым + Симферополь».
export const MIN_PAIR = 3;        // сколько раз пара должна встретиться
export const MIN_RARE = 6;        // редкий тег не должен быть совсем случайным
export const MIN_COMMON = 50;     // а частый — достаточно обжитым
export const MAX_DOM = 0.6;       // выше — теги про одно и то же
export const SURPRISE_RARE = 0.75; // редкий тег не должен жить только в паре
export const TOGETHER_LIFT = 6;   // иначе «частые» — это просто большие теги
export const TRIPLE_MIN = 4;      // тройки редки, порог ниже
export const TRIPLE_DOM = 0.5;

export function load() {
  const { tags, posts } = JSON.parse(readFileSync(SOURCE, 'utf8'));

  const name = {};
  for (const [tag, id] of Object.entries(tags)) name[id] = tag;

  const sets = Object.values(posts).map((ids) => [...new Set(ids)].sort((a, b) => a - b));

  const count = new Map();
  for (const ids of sets) {
    for (const id of ids) count.set(id, (count.get(id) || 0) + 1);
  }

  const pairs = new Map();
  const triples = new Map();
  for (const ids of sets) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = ids[i] + '|' + ids[j];
        pairs.set(key, (pairs.get(key) || 0) + 1);

        for (let k = j + 1; k < ids.length; k++) {
          const three = ids[i] + '|' + ids[j] + '|' + ids[k];
          triples.set(three, (triples.get(three) || 0) + 1);
        }
      }
    }
  }

  return { name, count, pairs, triples, total: sets.length };
}

/** Метрики пары: c — сколько постов с обоими тегами. */
export function score(data, a, b, c) {
  const ca = data.count.get(a);
  const cb = data.count.get(b);

  return {
    ids: [a, b],
    names: [data.name[a], data.name[b]],
    c,
    counts: [ca, cb],
    lift: (c * data.total) / (ca * cb),
    dom: Math.max(c / ca, c / cb),
    rare: c / Math.min(ca, cb),
  };
}

function allPairs(data) {
  const out = [];
  for (const [key, c] of data.pairs) {
    const [a, b] = key.split('|').map(Number);
    out.push(score(data, a, b, c));
  }
  return out;
}

const byLift = (x, y) => y.lift - x.lift;
const byCount = (x, y) => y.c - x.c || y.lift - x.lift;

const isPlace = (tag) => /^[А-ЯЁ]/.test(tag);
const isThing = (tag) => /^[а-яё]/.test(tag) && !/\d/.test(tag) && tag.length > 2;

/** Пять списков; в каждом не больше limit строк. */
export function boards(data, limit = 200) {
  const pairs = allPairs(data);
  const triples = triplesBoard(data);

  // Одно имя собственное с другим — это почти всегда «место внутри места»
  // («Крым + Симферополь»), поэтому в находках нужен хотя бы один обычное слово.
  const surprising = pairs.filter(
    (p) =>
      p.c >= MIN_PAIR &&
      Math.min(...p.counts) >= MIN_RARE &&
      Math.max(...p.counts) >= MIN_COMMON &&
      p.rare < SURPRISE_RARE &&
      p.names.some(isThing)
  );

  const placeThing = pairs.filter((p) => {
    if (p.c < MIN_PAIR || p.dom >= MAX_DOM) return false;
    const [x, y] = p.names;
    return (isPlace(x) && isThing(y)) || (isPlace(y) && isThing(x));
  });

  const together = pairs.filter((p) => p.dom < MAX_DOM && p.lift >= TOGETHER_LIFT);

  const duplicates = pairs.filter((p) => p.c >= 5 && p.dom >= 0.8);

  return [
    {
      id: 'surprising',
      title: 'Неожиданные пары',
      note: `Встречаются вместе гораздо чаще, чем вышло бы случайно, и редкий тег живёт не только в этой паре. Порог: пара от ${MIN_PAIR} постов, редкий тег от ${MIN_RARE}, частый от ${MIN_COMMON}; пары из двух имён собственных пропущены — это «место внутри места».`,
      rows: surprising.sort(byLift).slice(0, limit),
      found: surprising.length,
    },
    {
      id: 'place-thing',
      title: 'Место и предмет',
      note: 'Что характерно именно для этого города или поездки: с одной стороны имя собственное, с другой — обычное слово.',
      rows: placeThing.sort(byLift).slice(0, limit),
      found: placeThing.length,
    },
    {
      id: 'together',
      title: 'Частые сочетания',
      note: 'Просто самые многочисленные выборки. Пары, где один тег почти всегда идёт со вторым, отсюда убраны — иначе весь список занимает география.',
      rows: together.sort(byCount).slice(0, limit),
      found: together.length,
    },
    {
      id: 'triples',
      title: 'Тройки',
      note: `Три тега сразу, от ${TRIPLE_MIN} постов, и ни одна пара внутри тройки не сводится к «одно и то же другими словами».`,
      rows: triples.slice(0, limit),
      found: triples.length,
    },
    {
      id: 'duplicates',
      title: 'Похоже на один тег',
      note: 'Один тег почти не встречается без второго: скорее всего это синонимы или вложенные места. Кандидаты на склейку через retag.mjs.',
      rows: duplicates.sort(byCount).slice(0, limit),
      found: duplicates.length,
    },
  ];
}

function triplesBoard(data) {
  const rows = [];
  for (const [key, c] of data.triples) {
    if (c < TRIPLE_MIN) continue;

    const ids = key.split('|').map(Number);
    const inner = [
      score(data, ids[0], ids[1], data.pairs.get(ids[0] + '|' + ids[1])),
      score(data, ids[0], ids[2], data.pairs.get(ids[0] + '|' + ids[2])),
      score(data, ids[1], ids[2], data.pairs.get(ids[1] + '|' + ids[2])),
    ];
    if (inner.some((p) => p.dom >= TRIPLE_DOM)) continue;

    rows.push({
      ids,
      names: ids.map((id) => data.name[id]),
      c,
      counts: ids.map((id) => data.count.get(id)),
      lift: liftOf(data, ids, c),
      dom: Math.max(...inner.map((p) => p.dom)),
    });
  }

  return rows.sort(byLift);
}

function liftOf(data, ids, c) {
  const product = ids.reduce((acc, id) => acc * (data.count.get(id) / data.total), 1);
  return c / data.total / product;
}

/** Ссылка на выборку в поиске: search.html#кот+капот */
export function link(names, base = 'search.html') {
  return base + '#' + names.map(encodeURIComponent).join('+');
}
