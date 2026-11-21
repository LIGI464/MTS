# Помощник МТС · промты и логика после D90

База `Cursor/assistant-analysis`, коммит `c8f3ca4fbfd9d34f89deaf9727059f4749fee536`. В этой базе уже есть поиск завершённых аналогов, маршрут `POST /api/v1/assistant/chat`, интерфейс чата и тесты D90. Этот комплект задаёт тексты для модели и правила подключения данных, чтобы помощник отвечал на конкретный вопрос оператора и сравнивал выбранную заявку со всем доступным набором.

| Файл | Назначение |
| --- | --- |
| [PROMPT-SYSTEM.md](PROMPT-SYSTEM.md) | Готовый системный промт помощника для каждого ответа |
| [PROMPT-COMPARISON.md](PROMPT-COMPARISON.md) | Дополнение для запросов о сравнении и похожих заявках |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Промт для Cursor по подключению JSON, контекста диалога и живого Responses API |
| [ACCEPTANCE.md](ACCEPTANCE.md) | Промт для проверки ответов, полноты сравнения и работы API |

## Стартовое сообщение для Cursor

> Открой `LIGI464/MTS` на ветке `docs/mts-assistant-logic-prompts` и создай от неё отдельную рабочую ветку. Прочитай `docs/mts-assistant-logic/README.md` и выполни `IMPLEMENTATION.md`, используя `PROMPT-SYSTEM.md` и `PROMPT-COMPARISON.md` как инструкции модели. Используй существующий чат и серверный Responses API. Обеспечь доступ к принятым JSON-источникам ITSM и сравнение выбранной заявки со всеми уникальными записями, включая активные и архивные. На Node 24 выполни `ACCEPTANCE.md`. Верни SHA, результаты проверок и примеры ответов помощника на демоданных.

## Точки подключения

- Входная схема, ответы и контекст. [Контракты чата](../../packages/contracts/src/assistant.ts)
- Распознавание заявки, поиск аналогов и подготовка ответа. [API чата](../../apps/api/src/assistant/index.ts) · [Разбор запроса](../../apps/api/src/assistant/resolve.ts) · [Поиск](../../apps/api/src/assistant/matches.ts)
- Текущие инструкции модели и транспорт. [Ответ помощника](../../packages/analysis/src/assistant.ts) · [Провайдер](../../packages/analysis/src/provider/index.ts)
- Источники и архив. [Runtime](../../apps/api/src/source/index.ts) · [Архив SQLite](../../apps/api/src/store/itsm.ts) · [Демоэкспорт](../../data/demo/character_problems.json)
- Интерфейс и проверка D90. [Чат на пульте](../../apps/web/src/assistant/assistant-host.tsx) · [API-тесты приёмки](../../apps/api/tests/assistant-acceptance.test.ts) · [Сценарии Playwright](../../tests/e2e/d90-assistant.spec.ts)
