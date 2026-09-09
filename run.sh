#!/bin/bash
# crontab entry point: обновить данные блога и выложить статику на gh-pages.
#
#   0 2 * * * /home/romanyanke/me-stat/run.sh 1> /home/romanyanke/stat-log.txt 2> /home/romanyanke/stat-err.txt
#
# cron запускает это с PATH=/usr/bin:/bin и без окружения, поэтому node, npm и
# ключ Tumblr приходится искать здесь, а не наследовать.
set -e

cd "$(dirname "$0")"

# Большинство дистрибутивных .bashrc выходят сразу при неинтерактивном запуске,
# так что это лишь попытка — всё ниже работает и само по себе.
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh" >/dev/null
fi

# Фолбэки дописываются в конец, а не в начало: иначе node из /usr/local/bin
# перекрыл бы тот, который только что выставил nvm.
export PATH="$PWD/node_modules/.bin:$PATH:/usr/local/bin:$HOME/.local/bin"

# TUMBLR_CONSUMER_KEY. Читается здесь, а не через node --env-file, чтобы
# скрипт не зависел от версии node.
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

: "${TUMBLR_CONSUMER_KEY:?not set — put it in .env next to this script}"

# Конфиг ttags не в гите (см. .gitignore), на новой машине его надо создать.
[ -f ttags.js ] || {
  cat >&2 <<'EOF'
ttags.js not found. Create it next to this script:

module.exports = {
  blog: "me-yanke",
  consumerKey: process.env.TUMBLR_CONSUMER_KEY,
  transform: tags => tags.filter(tag => tag.count > 1)
};
EOF
  exit 1
}

command -v npm >/dev/null || {
  echo "npm not on PATH ($PATH)" >&2
  exit 1
}

# gh-pages пушит в origin по ssh, а у cron нет агента: нужен ключ без пароля
# (~/.ssh/id_ed25519) и заполненные user.name с user.email.
git config user.email >/dev/null || {
  echo "git user.email not set — gh-pages не сможет сделать коммит" >&2
  exit 1
}

npm run update
