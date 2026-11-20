# Пульт координатора · Cyber Garden

Комплект ТЗ и промтов для goida-code. Проект · [LIGI464/MTS](https://github.com/LIGI464/MTS).

**Стартуйте с B00.** Этот блок создаёт рабочую основу и контракт. После его слияния в `main` Cursor и две Astra 6.2 могут одновременно взять B10, B20 и B30 из одного и того же коммита.

| Исполнитель | Блоки | Ветка |
|---|---|---|
| LIGI464 на ПК 1 | [B00 · Основа](docs/mts/00-foundation/B00.md) | `setup/base` |
| Чат №1 · Cursor на ПК 1 · LIGI464 | [B10 · Интерфейс](docs/mts/10-web/B10.md) | `feat/web` и отдельные worktree для T11–T14 |
| Чат №2 · Astra 6.2 A в облаке · ПК 1 · LIGI464 | [B20 · Данные и API](docs/mts/20-api/B20.md) | `feat/api` |
| Чат №3 · Astra 6.2 B в облаке · ПК 2 · Nekori123123 | [B30 · ИИ](docs/mts/30-ai/B30.md), затем [T41 · Docker и CI](docs/mts/40-release/T41-package.md) | `feat/analysis`, `feat/deploy` |
| Nekori123123 на ПК 2 | [T42 · Развёртывание](docs/mts/40-release/T42-vps.md) по релизному SHA и проверка второго ПК | `release/cybergarden` |
| Исполнитель 1 и оба ПК | [B50 · Сборка и защита](docs/mts/50-integration/B50.md) | `release/cybergarden` |

Обе Astra 6.2 работают в облаке только с `LIGI464/MTS`. Они получают путь к промту и общий SHA, сдают свои ветки или PR. LIGI464 на основном ПК запускает Cursor и облачную Astra A, затем ведёт интеграцию. Nekori123123 на втором ПК запускает облачную Astra B и разворачивает проверенный SHA. Владелец VPS выполняет системные шаги, если они требуют администраторских прав.

[Кому выдать доступ и что запросить у исполнителей](docs/mts/ACCESS.md).

1. Прочитайте [ТЗ](docs/mts/TZ.md) и [контракт](docs/mts/CONTRACT.md). Дайте одному агенту [T01](docs/mts/00-foundation/T01-workspaces.md) и затем [T02](docs/mts/00-foundation/T02-contracts.md).
2. Слейте B00 и запишите SHA. На ПК 1 откройте Cursor, выдайте его агентам отдельные T11–T14 и отдельные worktree. T15 собирает их результат. LIGI464 передаёт этот же SHA облачной Astra A для API. Nekori123123 передаёт его облачной Astra B для ИИ и сборки. Индивидуальные промты приведены ниже.
3. Исполнитель 1 запускает [T51](docs/mts/50-integration/T51-integrate.md) и передаёт итоговый SHA исполнителю 2 для [T42](docs/mts/40-release/T42-vps.md). Оба проходят [T52](docs/mts/50-integration/T52-rehearse.md) на общем VPS-стенде и локально на каждом ПК.

## Промты по задачам

| Блок | Порядок и задачи |
|---|---|
| B00 | [T01 · Workspaces](docs/mts/00-foundation/T01-workspaces.md) → [T02 · Контракт и фикстуры](docs/mts/00-foundation/T02-contracts.md) |
| B10 | Параллельно [T11 · Навигация и шторки](docs/mts/10-web/T11-shell.md), [T12 · Доска и SLA](docs/mts/10-web/T12-board.md), [T13 · REST и SSE](docs/mts/10-web/T13-client.md), [T14 · Панель ИИ и сброс](docs/mts/10-web/T14-actions.md). Затем [T15 · Сборка экрана](docs/mts/10-web/T15-compose.md) |
| B20 | [T21 · JSON и хранилище](docs/mts/20-api/T21-source.md) → [T22 · HTTP и SSE](docs/mts/20-api/T22-http.md) → [T23 · Данные демо и сброс](docs/mts/20-api/T23-demo.md) → [T24 · Маршрут анализа](docs/mts/20-api/T24-analysis-route.md) |
| B30 | [T31 · Клиент codex.sale](docs/mts/30-ai/T31-provider.md) → [T32 · Анализ и резервный режим](docs/mts/30-ai/T32-engine.md) |
| [B40](docs/mts/40-release/B40.md) | [T41 · Docker, CI и конфигурация](docs/mts/40-release/T41-package.md) после B00. [T42 · VPS](docs/mts/40-release/T42-vps.md) после T51 |
| B50 | [T51 · Слияние и проверка](docs/mts/50-integration/T51-integrate.md) → [T52 · Репетиция на двух ПК](docs/mts/50-integration/T52-rehearse.md) |

Каждый файл `T*.md` — самостоятельное задание для агента. Передайте его целиком или укажите путь к файлу в репозитории и базовый SHA. Файл `B*.md` задаёт результат всей ветки и подходит агенту, который ведёт блок от начала до конца.

## Локальный запуск после слияния реализации

```text
npm ci
npm run build
npm run dev
```

Откройте `http://127.0.0.1:5173`. Для проверки production вместо `dev` запустите `npm start` и откройте `http://127.0.0.1:8787/admin/incidents`. Для импорта настоящего набора после сборки и перед пуском сервера выполните `npm run data:load -- --file "<путь к character_problems.json>"`. Для автономного интерфейса используйте `npm run dev:web`. Развёртывание по T42 выполняет исполнитель 2 со своего ПК.

## Что понадобится для полной защиты

- Обе выгрузки МТС сохраняются локально. Для работы приложения нужен файл `character_problems.json`. Справочник `incidents_attributes.json` используется при сверке полей.
- У владельца стенда должны быть адрес VPS, разрешённый способ доступа и домен для HTTPS. Для реальной модели нужны ключ codex.sale и ID модели из каталога этого ключа. Для реального перехода в ITSM нужен шаблон ссылки. Эти значения задаются на стенде вне Git.
- Пока внешние параметры уточняются, локальное демо работает на синтетическом JSON той же формы, с автоматическими обновлениями и явно подписанным локальным анализом.
