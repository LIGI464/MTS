# Запуск пульта координатора

Для стенда нужны Docker с Compose v2 и проверенный релизный SHA из T51. Команды ниже выполняются из корня репозитория. Fastify раздаёт Web по пути `/admin/incidents` и обслуживает REST и SSE на том же адресе.

## Конфигурация хоста

Перейдите на релизный коммит и подготовьте закрытый env-файл вне репозитория.

```bash
git switch --detach "$RELEASE_SHA"
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
export MTS_VPS_ENV="$HOME/.config/mts/dashboard.env"
install -d -m 0700 "$(dirname "$MTS_VPS_ENV")"
(umask 077; touch "$MTS_VPS_ENV")
chmod 0600 "$MTS_VPS_ENV"
```

Запишите в env-файл следующие параметры. Подставьте полный релизный SHA и выберите свободный порт на хосте.

```dotenv
MTS_HOST_DATA_DIR=/srv/mts/data
MTS_HOST_PORT=8787
MTS_IMAGE_TAG=<релизный SHA>
MTS_AI_MODE=rules
```

Для сброса демо задайте отдельный `MTS_OPERATOR_TOKEN`. Для платного анализа задайте `MTS_AI_MODE=live`, `CODEX_SALE_API_KEY` и точный `CODEX_SALE_MODEL` из каталога этого ключа. URL по умолчанию — `https://codex.sale/v1`. При наличии заполните `MTS_ITSM_URL_TEMPLATE` HTTPS-шаблоном с `{id}` или `{sysId}`. Значения с литеральным `$` заключайте в одинарные кавычки в env-файле. Храните секреты в этом файле на хосте.

Создайте постоянный каталог из `MTS_HOST_DATA_DIR`. В образе процесс работает от пользователя `node` с UID и GID 1000. Для стандартного Docker с системным демоном новый каталог подготавливается так.

```bash
sudo install -d -m 0750 -o 1000 -g 1000 /srv/mts/data
```

Для rootless Docker или переназначения UID выдайте права записи хостовому UID, который соответствует UID 1000 в контейнере. При обновлении используйте тот же каталог с действующим JSON, baseline и SQLite.

## Сборка и запуск

```bash
docker compose --env-file "$MTS_VPS_ENV" -f deploy/compose.yaml build dashboard
```

При первом запуске с реальной выгрузкой поместите разрешённую копию в `/srv/mts/data/import.json` и выдайте пользователю контейнера право чтения. До запуска сервиса импортируйте её через валидатор. При запуске синтетического демо релиз с T23 сам инициализирует пустой каталог.

```bash
docker compose --env-file "$MTS_VPS_ENV" -f deploy/compose.yaml run --rm --no-deps -T dashboard \
  npm run data:load -- --file /app/data/runtime/import.json
```

```bash
docker compose --env-file "$MTS_VPS_ENV" -f deploy/compose.yaml up -d --no-build --wait
docker compose --env-file "$MTS_VPS_ENV" -f deploy/compose.yaml ps
docker compose --env-file "$MTS_VPS_ENV" -f deploy/compose.yaml exec -T dashboard \
  node deploy/smoke.mjs http://127.0.0.1:8787
```

Compose публикует выбранный порт только на `127.0.0.1` хоста. Внутри контейнера порт всегда `8787`. Smoke проверяет здоровье, снимок REST и первый кадр SSE. Для демонстрации на синтетическом наборе шаги `critical`, `assign`, `deadline` и `resolve` выполняются с помощью `docker compose --env-file "$MTS_VPS_ENV" -f deploy/compose.yaml exec -T dashboard npm run demo:step -- <шаг>`.

Каркас B00 обслуживает `/healthz`. Полный smoke, статика на `/admin/incidents`, импорт и шаги демо требуют интегрированных API и Web. В CI на B00 запускается браузерный boot smoke с синтетическими данными. На релизе команда Playwright также запускает сценарии T51.

## HTTPS и поток событий

Добавьте виртуальный хост из [Caddyfile.example](Caddyfile.example) в действующую конфигурацию Caddy. Замените домен и при необходимости порт upstream в обоих блоках. Для выбранного домена применяются правила TLS хоста.

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
node deploy/smoke.mjs https://incidents.example.org
```

Откройте `https://incidents.example.org/admin/incidents`. При использовании другого прокси настройте `/api/v1/events` на потоковую передачу без буферизации и преобразования ответа. Сохраните `Content-Type: text/event-stream` и таймаут чтения, допускающий интервалы между ping-комментариями в 15 секунд. Прогоните тот же smoke через публичный HTTPS-адрес.

## Откат

Перед обновлением запишите текущий тег и сохраните предыдущий образ локально. Если новый релиз падает, верните прежнее значение `MTS_IMAGE_TAG` в env-файле. Поднимите сохранённый образ с тем же постоянным каталогом и повторите проверки.

```bash
docker compose --env-file "$MTS_VPS_ENV" -f deploy/compose.yaml up -d --no-build --pull never --wait
docker compose --env-file "$MTS_VPS_ENV" -f deploy/compose.yaml exec -T dashboard \
  node deploy/smoke.mjs http://127.0.0.1:8787
node deploy/smoke.mjs https://incidents.example.org
```
