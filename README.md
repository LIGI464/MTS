# Пульт координатора · Cyber Garden

Комплект ТЗ и промтов для goida-code. Проект · [LIGI464/MTS](https://github.com/LIGI464/MTS).

**Стартуйте с B00.** Этот блок создаёт рабочую основу и контракт. После его слияния в `main` Cursor и две Astra 6.2 могут одновременно взять B10, B20 и B30 из одного и того же коммита.

| Исполнитель | Блоки | Ветка |
|---|---|---|
| Один назначенный интегратор | [B00 · Основа](docs/mts/00-foundation/B00.md) | `setup/base` |
| Cursor на ПК 1 | [B10 · Интерфейс](docs/mts/10-web/B10.md) | `feat/web` и отдельные worktree для T11–T14 |
| Astra 6.2 A на ПК 2 или в облаке | [B20 · Данные и API](docs/mts/20-api/B20.md) | `feat/api` |
| Astra 6.2 B в облаке, может работать рядом с Cursor | [B30 · ИИ](docs/mts/30-ai/B30.md), затем [B40 · Поставка](docs/mts/40-release/B40.md) | `feat/analysis`, `feat/deploy` |
| Интегратор и оба ПК | [B50 · Сборка и защита](docs/mts/50-integration/B50.md) | `release/cybergarden` |

Облачная Astra получает задачу и точный SHA через GitHub. Её рабочий результат — коммиты или PR с указанной веткой. Готовый VPS-стенд разворачивается по T42 из проверенного SHA в отдельной сессии с доступом к хосту.

1. Прочитайте [ТЗ](docs/mts/TZ.md) и [контракт](docs/mts/CONTRACT.md). Дайте одному агенту [T01](docs/mts/00-foundation/T01-workspaces.md) и затем [T02](docs/mts/00-foundation/T02-contracts.md).
2. Слейте B00 и запишите SHA. На ПК 1 откройте Cursor, выдайте его агентам отдельные T11–T14 и отдельные worktree. T15 собирает их результат. Backend и AI берут свои индивидуальные промты из таблицы ниже.
3. После проверки веток запустите [T51](docs/mts/50-integration/T51-integrate.md). [T42](docs/mts/40-release/T42-vps.md) и [T52](docs/mts/50-integration/T52-rehearse.md) используют итоговый SHA. Проверка на двух ПК включает общий VPS-стенд и локальный запуск на каждом ПК.

## Промты по задачам

| Блок | Порядок и задачи |
|---|---|
| B00 | [T01 · Workspaces](docs/mts/00-foundation/T01-workspaces.md) → [T02 · Контракт и фикстуры](docs/mts/00-foundation/T02-contracts.md) |
| B10 | Параллельно [T11 · Навигация и шторки](docs/mts/10-web/T11-shell.md), [T12 · Доска и SLA](docs/mts/10-web/T12-board.md), [T13 · REST и SSE](docs/mts/10-web/T13-client.md), [T14 · Панель ИИ и сброс](docs/mts/10-web/T14-actions.md). Затем [T15 · Сборка экрана](docs/mts/10-web/T15-compose.md) |
| B20 | [T21 · JSON и хранилище](docs/mts/20-api/T21-source.md) → [T22 · HTTP и SSE](docs/mts/20-api/T22-http.md) → [T23 · Данные демо и сброс](docs/mts/20-api/T23-demo.md) → [T24 · Маршрут анализа](docs/mts/20-api/T24-analysis-route.md) |
| B30 | [T31 · Клиент codex.sale](docs/mts/30-ai/T31-provider.md) → [T32 · Анализ и резервный режим](docs/mts/30-ai/T32-engine.md) |
| B40 | [T41 · Docker, CI и конфигурация](docs/mts/40-release/T41-package.md) после B00. [T42 · VPS](docs/mts/40-release/T42-vps.md) после T51 |
| B50 | [T51 · Слияние и проверка](docs/mts/50-integration/T51-integrate.md) → [T52 · Репетиция на двух ПК](docs/mts/50-integration/T52-rehearse.md) |

Каждый файл `T*.md` — самостоятельное задание для агента. Передайте его целиком или укажите путь к файлу в репозитории и базовый SHA. Файл `B*.md` задаёт результат всей ветки и подходит агенту, который ведёт блок от начала до конца.

## Локальный запуск после слияния реализации

```text
npm ci
npm run build
npm run dev
```

Откройте `http://127.0.0.1:5173`. Для проверки production вместо `dev` запустите `npm start` и откройте `http://127.0.0.1:8787/admin/incidents`. Для импорта настоящего набора после сборки и перед пуском сервера выполните `npm run data:load -- --file "<путь к character_problems.json>"`. Для автономного интерфейса используйте `npm run dev:web`. Для VPS передайте исполнительный промт T42.

## Что понадобится для полной защиты

- Обе выгрузки МТС сохраняются локально. Для работы приложения нужен файл `character_problems.json`. Справочник `incidents_attributes.json` используется при сверке полей.
- У владельца стенда должны быть адрес VPS, разрешённый способ доступа и домен для HTTPS. Для реальной модели нужны ключ codex.sale и ID модели из каталога этого ключа. Для реального перехода в ITSM нужен шаблон ссылки. Эти значения задаются на стенде вне Git.
- Пока внешние параметры уточняются, локальное демо работает на синтетическом JSON той же формы, с автоматическими обновлениями и явно подписанным локальным анализом.
