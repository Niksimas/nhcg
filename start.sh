#!/usr/bin/env sh
# Запуск игры на Linux / macOS: ./start.sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Не найден Node.js. Установите LTS-версию с https://nodejs.org и запустите снова."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Первый запуск: устанавливаю зависимости (нужен интернет, 1-2 минуты)..."
  npm install || exit 1
fi

exec node server/index.js "$@"
