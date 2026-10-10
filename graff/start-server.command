#!/bin/sh
set -eu
cd "$(dirname "$0")"
RUNTIME=$(command -v node || true)
if [ -z "$RUNTIME" ]; then
  CANDIDATE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  if [ -x "$CANDIDATE" ]; then RUNTIME="$CANDIDATE"; fi
fi
if [ -z "$RUNTIME" ]; then
  echo 'Установите Node.js 24 LTS с https://nodejs.org и запустите этот файл снова.'
  read -r answer
  exit 1
fi
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
echo 'Рядом — семейный сервер'
echo "Адрес для Android: http://${LAN_IP:-IP-ВАШЕГО-КОМПЬЮТЕРА}:8787"
echo 'Телефон и компьютер должны быть в одной Wi-Fi сети.'
echo 'Оставьте это окно открытым. Остановка: Ctrl+C.'
HOST=0.0.0.0 "$RUNTIME" server/server.mjs &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM
sleep 1
if [ -f data/first-invite.txt ]; then
  echo 'Код первого приглашения (для владельца семьи):'
  cat data/first-invite.txt
fi
wait "$SERVER_PID"
