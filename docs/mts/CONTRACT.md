# Контракт v1 · JSON, снимок, события и ИИ

Этот документ обязателен для реализации трёх веток. B00 переносит его в `@mts/contracts`. Остальные ветки импортируют типы и константы из этого пакета.

## Пути и команды

| Команда из корня после `npm ci` | Что запускает |
|---|---|
| `npm run prep:local` | Собирает `@mts/contracts` и `@mts/analysis` |
| `npm run dev:web` | Vite на `127.0.0.1:5173` в режиме mock |
| `npm run dev:api` | Fastify на `127.0.0.1:8787`, загружает `.env` |
| `npm run dev` | Vite в режиме API и Fastify вместе |
| `npm run check` | Проверка типов рабочих пакетов |
| `npm test` | Vitest по проекту |
| `npm run build` | Сборка контрактов, анализа, Web и API в этом порядке |
| `npm start` | Собранный Fastify со статикой Web |
| `npm run data:load -- --file PATH` | После `npm run build` проверяет JSON и копирует его в живой файл и исходную копию демонстрации |
| `npm run demo:step -- STEP` | После `npm run build` атомарно правит живой JSON. `STEP` — `critical`, `assign`, `deadline` или `resolve` |
| `npm run test:e2e` | Интеграция через Playwright Chromium |

Константы `API_PREFIX=/api/v1`, `LOCAL_API_PORT=8787` и `COORDINATOR_TEAM="КЦ ИТ Координаторы Массовых Инцидентов"`. В production `HOST=0.0.0.0` внутри контейнера. Web использует относительные пути. `MTS_DATA_DIR` по умолчанию `data/runtime` от корня репозитория. Рядом размещаются `character_problems.json`, `baseline.json` и `dashboard.sqlite`. В Git включаются только синтетические фикстуры.

## Входной JSON

Корень — массив объектов. Zod принимает дополнительные поля исходного экспорта. Поля карточки читаются по таблице.

| Поле выгрузки | Правило |
|---|---|
| `id` | Строка, непустая и уникальная в файле. Ключ карточки, групп и уведомлений |
| `sysId` | Если присутствует, строка. Передаётся в шаблон ITSM только по явному `{sysId}` |
| `header`, `productName`, `service`, `shortDescription`, `description` | Строки. Пустые отображаемые поля приводятся к `null`, заголовок по умолчанию равен `id` |
| `submitDate` | Обязательный момент регистрации. Допустим ISO с зоной и формат справочника `YYYY-MM-DD HH:mm:ss`, который трактуем как UTC. Нормализуется в UTC ISO |
| `deadline`, `completionDate` | Такие же форматы или `null`, пустая строка приравнивается к `null` |
| `assignedGroupName`, `assignedEmployee` | Строка или `null`. Тримминг пробелов по краям. Человек и команда имеют независимый смысл |
| `Категория`, `category`, `priorityId`, `priority` | Распознанная категория имеет приоритет, затем используется целый `priorityId` от 1 до 4. Если `priorityId` отсутствует или равен `null`, допустима текстовая подпись `priority`. Подписи · Низкий, Средний, Высокий, Наивысший |
| `urgencyId`, `impactId` | Целое 1–4 или `null`. Неизвестное значение остаётся отсутствующим сигналом |
| `stateEnum` | `Assigned`, `WorkInProgress`, `Resolved`, `Closed`, `Research`. Если значения нет, использовать русскую подпись `state`. Прочие значения становятся `Other` с исходной подписью |
| `stateId`, `productUrl` | Сохраняются в исходном файле. Канонический статус берётся из `stateEnum`. `productUrl` обозначает ссылку продукта и не используется для ITSM |

Подписи `Assigned` → «Назначен», `WorkInProgress` → «Выполняется», `Resolved` → «Завершен», `Closed` → «Закрыт», `Research` → «Исследование ситуации». Порядок объектов во входном JSON не влияет на ревизию. Невалидная запись или повтор `id` сохраняют предыдущий снимок целиком. Инициатор, логины и исходные поля, которые не нужны экрану, остаются в файле.

## Контракты данных

```ts
type State = "Assigned" | "WorkInProgress" | "Resolved" | "Closed" | "Research" | "Other"
type Priority = 1 | 2 | 3 | 4
type GroupKey = "critical" | "coordinator" | "high" | "research"
type NoticeKind = "critical.new" | "coordinator.assigned" | "critical.resolved" | "demo.reset"

type Incident = {
  id: string
  version: string
  title: string
  product: string | null
  service: string | null
  team: string | null
  assignee: string | null
  state: State
  stateLabel: string
  priority: Priority
  urgency: Priority | null
  impact: Priority | null
  createdAt: string
  dueAt: string | null
  resolvedAt: string | null
  summary: string | null
  itsmUrl: string | null
}
type Notice = {
  seq: number
  kind: NoticeKind
  incidentId: string | null
  title: string | null
  at: string
}
type Snapshot = {
  apiVersion: 1
  revision: number
  serverNow: string
  source: { status: "ok" | "stale" | "unavailable"; lastGoodAt: string | null }
  capabilities: { demoReset: boolean; liveAnalysis: boolean }
  incidents: Incident[]
  groups: Record<GroupKey, string[]>
  notices: Notice[]
}
type AnalysisResult = {
  incidentId: string
  incidentVersion: string
  evaluatedAt: string
  source: "llm" | "rules"
  summary: string
  recommendedTeam: { name: string; reason: string } | null
  risk: { level: "low" | "medium" | "high" | "not_applicable"; factors: string[] }
  reason: "rules_mode" | "not_configured" | "timeout" | "provider_error" | "invalid_output" | null
}
type ApiError = { code: string; message: string }
```

Даты в DTO — UTC ISO. `version` — стабильный непрозрачный хеш всех значимых для карточки полей и входов анализа для конкретной записи, без `serverNow`. `summary` берёт `shortDescription`, иначе ограниченный по длине `description`. `description` для анализа передаётся отдельно на сервере. `revision` — неотрицательное целое, растёт при изменении нормализованного набора или сбросе, сохраняется в SQLite. `notices` содержит последние 50 событий, отсортированных по `seq`. `seq` монотонен даже после сброса. `capabilities.liveAnalysis` означает настроенный ключ, модель и операторский токен.

## Группы и переходы

| Группа | Условие |
|---|---|
| `critical` | `priority === 4` и `state` в `Assigned` или `WorkInProgress` |
| `coordinator` | `team === COORDINATOR_TEAM` и `state` в `Assigned`, `WorkInProgress` или `Research` |
| `high` | `priority === 3` и `state` в `Assigned` или `WorkInProgress` |
| `research` | `state === "Research"` |

Группы вычисляются независимо. У одного ID может быть несколько вхождений. Порядок · ранний дедлайн первым, `null` в конце, при равенстве более свежая регистрация первой, затем строковый ID по возрастанию. История в Web строится из `Resolved`, `Closed`, `Research` и журнала. `Other` доступен в общем списке истории и в диагностике данных.

| Событие | Условие |
|---|---|
| `critical.new` | ID впервые вошёл в `critical` в сравнении с предыдущим валидным снимком |
| `coordinator.assigned` | ID впервые вошёл в `coordinator` в сравнении с предыдущим валидным снимком |
| `critical.resolved` | Этот ID был в `critical`, теперь его состояние `Resolved`, `Closed` или `Research` |
| `demo.reset` | Успешный явный сброс со служебной кнопки |

На первой загрузке чистого хранилища массовые оповещения не создаются. При перезапуске сравнение идёт с сохранённым снимком. Удаление записи и понижение приоритета обновляют группы без сообщения о решении. Одновременное попадание в две группы может дать два различных события. Для одного типа и ID на одну ревизию создаётся ровно одно событие. Изменение только даты, статуса или назначенного сотрудника публикует новый снимок, даже если состав групп тот же.

## HTTP

| Метод и путь | Результат |
|---|---|
| `GET /healthz` | `200 {status:"ok", source:"ok"|"stale"|"unavailable"}` |
| `GET /api/v1/dashboard` | `200 Snapshot`. При холодном старте без данных группы пустые, `source.status="unavailable"` |
| `GET /api/v1/events` | SSE с `Content-Type: text/event-stream` и `Cache-Control: no-cache, no-transform`. Каждый кадр `event: dashboard` содержит полный `Snapshot`. Первый кадр отправляется сразу, ping-комментарий каждые 15 секунд |
| `POST /api/v1/incidents/:id/analysis` | `200 AnalysisResult`, `404 INCIDENT_NOT_FOUND`, `403 OPERATOR_TOKEN_INVALID` при переданном неверном токене. Возможен `429 TOO_MANY_REQUESTS` при исчерпанном лимите live-режима |
| `POST /api/v1/demo/reset` | `200 Snapshot` с новой ревизией, `404 RESET_UNAVAILABLE` при выключенном сбросе, `403 OPERATOR_TOKEN_INVALID` при отсутствии или ошибке токена, `409 BASELINE_UNAVAILABLE` при непригодной исходной копии |

REST и SSE отдают свежий `serverNow`. Изменение `source.status` может прийти с той же ревизией. Клиент принимает состояние с SSE в порядке доставки; ответ GET, пришедший после первого SSE, применяется только при более новой ревизии. Разрыв потока не очищает очередь. Клиент после подключения получает текущий снимок, отделяет уведомления по `notice.seq` и не повторяет показанные. Первый валидный снимок вкладки задаёт начальный watermark; следующие последовательности показываются как уведомления. После `demo.reset` прежние активные уведомления и анализ закрываются.

`MTS_ITSM_URL_TEMPLATE` поддерживает `{id}` и `{sysId}`. Проверять HTTPS, наличие предусмотренного плейсхолдера и доступность соответствующего ID. Вставлять URL-encoded значения. При пустом шаблоне или недоступном ID отдавать `itsmUrl: null`.

## Таймер

`remaining = dueAt - now`. Для активной записи с дедлайном состояние «Срок близко» означает `0 < remaining <= min(30 минут, 20%*(dueAt-createdAt))`. При `remaining <= 0` показываем «Просрочен». Отрицательная длительность SLA считается нулевой. Для завершённых и исследования показываем «Решён», «Закрыт» или «Решён · исследование» и время завершения при наличии. Использовать единый tick на секунду, время сервера плюс истекшее время браузера. Для дат представления использовать `Europe/Moscow`.

## Серверные точки стыка

B00 фиксирует интерфейсы в `apps/api/src/runtime-contract.ts` и заготовки регистрации в `demo/index.ts` и `analysis/index.ts`. T21, T23 и T24 наполняют эти точки, а T22 связывает их.

```ts
type DashboardRuntimeOptions = {
  dataDir: string
  pollMs: number
  itsmTemplate?: string
  capabilities: Snapshot["capabilities"]
}
type DashboardRuntime = {
  getSnapshot(): Snapshot
  getDescription(id: string): string | null
  subscribe(listener: (snapshot: Snapshot) => void): () => void
  resetTo(bytes: Uint8Array): Promise<Snapshot>
  close(): Promise<void>
}
type RouteContext = {
  runtime: DashboardRuntime
  dataDir: string
  operatorToken?: string
  env: NodeJS.ProcessEnv
}
```

`createDashboardRuntime(options)` возвращает `Promise<DashboardRuntime>`. `ensureDemoData(dataDir)` возвращает `Promise<void>`. Функции `registerDemoRoutes(app, context)` и `registerAnalysisRoutes(app, context)` получают `FastifyInstance` и `RouteContext`, возвращают `void` и регистрируют свои маршруты. Bash для локальных задач не требуется.

## Граница пакета анализа

`@mts/analysis` предоставляет `createAnalyzer(config)`. Значения `config` · `apiKey?: string`, `model?: string`, `baseUrl: string` и `timeoutMs: number`. 
```ts
type AnalysisInput = {
  incident: Incident
  description: string | null
  history: readonly Incident[]
  now: string
}
type PreparedAnalysis = {
  key: string
  rules: AnalysisResult
  caseFacts: Readonly<Record<string, unknown>>
  candidateNames: readonly string[]
}
type Analyzer = {
  prepare(input: AnalysisInput): PreparedAnalysis
  run(prepared: PreparedAnalysis, options: { useLive: boolean }): Promise<AnalysisResult>
}
```

Подбор команды и риска описан в [T32](30-ai/T32-engine.md). Backend передаёт только актуальную запись, описание и снимок истории. Ключ кеша учитывает версию входов, кандидатуры и категорию близости SLA. Web применяет ответ лишь к тому же `id` и `version`. Незавершённый вызов не задерживает обновления дашборда.

## Переменные окружения

| Ключ | Значение по умолчанию и использование |
|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `8787` локально |
| `MTS_DATA_DIR` | `data/runtime` |
| `MTS_DATA_POLL_MS` | `500` |
| `MTS_ITSM_URL_TEMPLATE` | Пусто |
| `MTS_OPERATOR_TOKEN` | Пусто. Разрешает попытку сброса и авторизует платный анализ |
| `MTS_AI_MODE` | `rules`. Для реальных вызовов `live` |
| `CODEX_SALE_BASE_URL` | `https://codex.sale/v1` |
| `CODEX_SALE_API_KEY` / `CODEX_SALE_MODEL` | Пусто, значения от владельца аккаунта |
| `MTS_AI_TIMEOUT_MS` | `8000` |
| `VITE_DATA_MODE` | `api`. Команда `dev:web` выставляет `mock` |

В API токен передаётся заголовком `Authorization: Bearer …`. Web держит введённый операторский токен в памяти сессии вкладки. Сами API-ключи доступны серверу. Публичный просмотр и анализ по правилам работают без токена.
