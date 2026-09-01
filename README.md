# me-stat

Статика для [me.yanke.ru](https://me.yanke.ru): облако тегов и поиск по их пересечениям.
Собирается из Tumblr-блога `me-yanke`, деплоится на gh-pages.

## Как устроено

```
Tumblr API ──ttags──▶ tmp/source.json ──┬──▶ dist/tags.json ──index.js──▶ html/tags.js   (облако тегов)
                                        └──build-search.mjs──────────────▶ html/search.html (поиск)
```

- `tmp/source.json` — `{tags: {имя: id}, posts: {postId: [id тегов]}}`, полный слепок блога. Не в гите.
- `dist/tags.json` — теги с количествами (только те, что встречаются больше одного раза). Не в гите.
- `html/` — то, что уезжает на gh-pages.

## Команды

### Обновить данные и облако тегов

```bash
npm start
```

Тянет все посты из Tumblr (`ttags`) и пересобирает `html/tags.js`. Нужен `TUMBLR_CONSUMER_KEY` в окружении.

### Обновить один пост

```bash
npm run post -- <post-id>
```

### Пересобрать только облако из уже скачанных данных

```bash
npm run html
```

### Собрать страницу поиска по тегам

Версия для gh-pages, с плиткой превью (айфреймы на страницы постов):

```bash
node build-search.mjs html/search.html --previews
```

Версия без превью — для Artifact на claude.ai, где CSP запрещает `frame-src`:

```bash
node build-search.mjs /путь/к/tag-search.html
```

Обе собираются из `search-template.html`, весь индекс вшивается в страницу (~15 000 постов, ~6 200 тегов, 650–700 КБ). Сети странице не нужно, кроме превью и шрифтов.

Что умеет: пересечение любого числа тегов (И), исключение тега кликом по чипу, подсказки соседних тегов с числом постов внутри текущей выборки, запрос в адресе (`#Гамбург+небоскреб`, минус для исключения), плитка/список, светлая и тёмная темы.

### Выложить на gh-pages

```bash
npm run deploy
```

Публикует папку `html` → `https://romanyanke.github.io/me-stat/` (`tags.js`, `search.html`).

### Всё сразу: данные + облако + деплой

```bash
npm run update
```

## Служебные скрипты

### Найти теги, которые ни к чему не привязаны

```bash
node cleanup-tags.mjs
```

Показывает список. Удалить их из `tmp/source.json`:

```bash
node cleanup-tags.mjs --apply
```

### Переименовать или снять тег на постах

```bash
node retag.mjs --remove <тег> --add <тег> <post-id> [post-id ...]
```

Сначала лучше вхолостую:

```bash
node retag.mjs --dry-run --remove палочка --add палочки 151794687275
```

Пишет в Tumblr, поэтому нужны все ключи: `TUMBLR_CONSUMER_KEY`, `TUMBLR_CONSUMER_SECRET`, `TUMBLR_TOKEN`, `TUMBLR_TOKEN_SECRET`, `TUMBLR_BLOG`.

Кандидаты на склейку (опечатки, единственное/множественное) копятся в `tmp/problematic-tags.md`.

## Переменные окружения

| Переменная | Где нужна |
| --- | --- |
| `TUMBLR_CONSUMER_KEY` | `npm start`, `npm run post`, `retag.mjs` |
| `TUMBLR_CONSUMER_SECRET` | `retag.mjs` |
| `TUMBLR_TOKEN` | `retag.mjs` |
| `TUMBLR_TOKEN_SECRET` | `retag.mjs` |
| `TUMBLR_BLOG` | `retag.mjs` |
