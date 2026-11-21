#!/usr/bin/env bash
# Bootstrap MTS dashboard on a clean Linux VPS (Docker + Compose v2).
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/LIGI464/MTS/cursor/assistant-logic-51a0/deploy/vps-bootstrap.sh | bash
# Optional env overrides before piping:
#   MTS_REF=ba07c18 MTS_HOST_DATA_DIR=/srv/mts/data MTS_HOST_PORT=8787 bash vps-bootstrap.sh

set -euo pipefail

REPO_URL="${MTS_REPO_URL:-https://github.com/LIGI464/MTS.git}"
MTS_REF="${MTS_REF:-cursor/assistant-logic-51a0}"
APP_DIR="${MTS_APP_DIR:-${HOME}/mts/app}"
DATA_DIR="${MTS_HOST_DATA_DIR:-/srv/mts/data}"
ENV_FILE="${MTS_VPS_ENV:-${HOME}/.config/mts/dashboard.env}"
HOST_PORT="${MTS_HOST_PORT:-8787}"

log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || die "Установите git"
command -v docker >/dev/null || die "Установите Docker"
docker compose version >/dev/null 2>&1 || die "Нужен Docker Compose v2 (docker compose)"

if [[ ! -d "$APP_DIR/.git" ]]; then
  log "Клонирую репозиторий в $APP_DIR"
  install -d -m 0755 "$(dirname "$APP_DIR")"
  git clone --filter=blob:none --depth 1 --branch "$MTS_REF" "$REPO_URL" "$APP_DIR" 2>/dev/null \
    || git clone --filter=blob:none "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
  git fetch --depth 1 origin "$MTS_REF" 2>/dev/null || git fetch origin "$MTS_REF"
  git switch -d FETCH_HEAD 2>/dev/null || git switch "$MTS_REF"
else
  log "Обновляю $APP_DIR"
  cd "$APP_DIR"
  git fetch origin "$MTS_REF"
  git switch --detach FETCH_HEAD 2>/dev/null || git switch -d "origin/$MTS_REF" 2>/dev/null || git switch "$MTS_REF"
fi

SHA="$(git rev-parse HEAD)"
log "Коммит: $SHA"

install -d -m 0700 "$(dirname "$ENV_FILE")"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Создаю $ENV_FILE (отредактируйте ключи live при необходимости)"
  umask 077
  cat >"$ENV_FILE" <<EOF
MTS_HOST_DATA_DIR=${DATA_DIR}
MTS_HOST_PORT=${HOST_PORT}
MTS_IMAGE_TAG=${SHA}
MTS_AI_MODE=rules
MTS_DATA_POLL_MS=500
# MTS_OPERATOR_TOKEN=
# MTS_AI_MODE=live
# CODEX_SALE_API_KEY=
# CODEX_SALE_MODEL=
# MTS_ITSM_URL_TEMPLATE=https://itsm.example/incidents/{id}
EOF
  chmod 0600 "$ENV_FILE"
else
  log "Env-файл уже есть: $ENV_FILE"
  if grep -q '^MTS_IMAGE_TAG=' "$ENV_FILE"; then
    sed -i "s|^MTS_IMAGE_TAG=.*|MTS_IMAGE_TAG=${SHA}|" "$ENV_FILE"
  else
    printf '\nMTS_IMAGE_TAG=%s\n' "$SHA" >>"$ENV_FILE"
  fi
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a
DATA_DIR="${MTS_HOST_DATA_DIR:-$DATA_DIR}"
HOST_PORT="${MTS_HOST_PORT:-$HOST_PORT}"

log "Каталог данных: $DATA_DIR"
if [[ "$(id -u)" -eq 0 ]]; then
  install -d -m 0750 -o 1000 -g 1000 "$DATA_DIR"
else
  if sudo -n true 2>/dev/null; then
    sudo install -d -m 0750 -o 1000 -g 1000 "$DATA_DIR"
  else
    install -d -m 0755 "$DATA_DIR"
    log "Без sudo: права на $DATA_DIR должны позволять запись UID 1000 в контейнере"
  fi
fi

if [[ -f "$DATA_DIR/import.json" && ! -f "$DATA_DIR/character_problems.json" ]]; then
  log "Импорт import.json в том данных"
  docker compose --env-file "$ENV_FILE" -f deploy/compose.yaml build dashboard
  docker compose --env-file "$ENV_FILE" -f deploy/compose.yaml run --rm --no-deps -T dashboard \
    npm run data:load -- --file /app/data/runtime/import.json
else
  log "Сборка образа"
  docker compose --env-file "$ENV_FILE" -f deploy/compose.yaml build dashboard
fi

log "Запуск контейнера"
docker compose --env-file "$ENV_FILE" -f deploy/compose.yaml up -d --no-build --wait

log "coordinators.json (если нет — создаётся из выгрузки)"
docker compose --env-file "$ENV_FILE" -f deploy/compose.yaml exec -T dashboard node - <<'NODE'
const fs = require("node:fs");
const crypto = require("node:crypto");
const live = "/app/data/runtime/character_problems.json";
const out = "/app/data/runtime/coordinators.json";
const TEAM = "КЦ ИТ Координаторы Массовых Инцидентов";
if (fs.existsSync(out)) {
  console.log("coordinators.json уже есть");
  process.exit(0);
}
if (!fs.existsSync(live)) {
  console.log("character_problems.json ещё нет — дождитесь первого poll или положите import.json");
  process.exit(0);
}
const rows = JSON.parse(fs.readFileSync(live, "utf8"));
const names = [...new Set(rows
  .filter((r) => r.assignedGroupName === TEAM && typeof r.assignedEmployee === "string")
  .map((r) => r.assignedEmployee.trim())
  .filter(Boolean))].sort();
const directory = names.map((name) => ({
  id: `exported:${crypto.createHash("sha256").update(name).digest("hex")}`,
  name,
}));
fs.writeFileSync(out, JSON.stringify(directory, null, 2) + "\n");
console.log(`coordinators.json записан, координаторов: ${directory.length}`);
NODE

log "Smoke"
docker compose --env-file "$ENV_FILE" -f deploy/compose.yaml exec -T dashboard \
  node deploy/smoke.mjs "http://127.0.0.1:8787"

cat <<EOF

Готово.
  UI (через SSH-туннель):  http://127.0.0.1:${HOST_PORT}/admin/incidents
  Репозиторий:             ${APP_DIR}
  Данные на хосте:         ${DATA_DIR}
  Env:                     ${ENV_FILE}
  SHA:                     ${SHA}

Проверка coordinators:
  ls -la ${DATA_DIR}/coordinators.json

Повторный запуск этого скрипта обновит код и перезапустит compose.
Для live-помощника отредактируйте ${ENV_FILE} (MTS_AI_MODE=live, CODEX_SALE_*) и выполните:
  docker compose --env-file ${ENV_FILE} -f ${APP_DIR}/deploy/compose.yaml up -d --no-build --wait
EOF