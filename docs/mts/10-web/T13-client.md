# T13 · Cursor · Снимок, SSE и mock

Ты отвечаешь за канал данных во фронтенде. Ветка `feat/web-client` от SHA B00. Меняй только `apps/web/src/data/**`. Прочитай [контракт v1](../CONTRACT.md). Используй TanStack Query, `fetch`, native `EventSource` и Zod-схемы из `@mts/contracts`.

Экспортируй из `src/data/index.ts`:

```ts
type DemoStep = "critical" | "assign" | "deadline" | "resolve"
function useDashboard(): {
  snapshot: Snapshot | null
  nowMs: number
  connection: "connecting" | "live" | "reconnecting" | "mock"
  newNotices: Notice[]
  dismissNotice: (seq: number) => void
  runAnalysis: (id: string, token?: string) => Promise<AnalysisResult>
  resetDemo: (token: string) => Promise<Snapshot>
  stepMock?: (step: DemoStep) => void
}
```

1. GET `/api/v1/dashboard` запускается как начальный запрос. Client в effect открывает `/api/v1/events`, слушает `dashboard` и валидирует `SnapshotSchema`. Первый SSE может прийти раньше GET. При уже полученном SSE принимай поздний GET только с большей ревизией. Сохраняй последний валидный снимок при ошибке транспорта или кадра и показывай `reconnecting`. Браузерный EventSource переподключается сам. При unmount закрывай соединение и очищай обработчики. В React Strict Mode после инициализации жив один EventSource.
2. Вкладка запоминает максимальный `notice.seq` первого снимка, затем добавляет только новые `seq` из следующих кадров. После `demo.reset` убирает прежние оповещения и оставляет событие сброса. Повтор кадра, дубли карточки и возврат связи не порождают повтор тоста. В `dismissNotice` удаляй уведомление из видимого списка, watermark сохраняй.
3. Запоминай offset времени через пару `serverNow` и `performance.now()`. Одним таймером на секунду формируй `nowMs`. Пересчёт смещения после валидного кадра, cleanup при unmount. Отображаемое время при разрыве потока продолжает идти.
4. Действия · относительные пути из контракта. `runAnalysis` отправляет POST, кодирует `id`, при токене добавляет Bearer, валидирует `AnalysisResult`. `resetDemo` отправляет POST с токеном и применяет полученный Snapshot с теми же правилами обработки уведомлений. Ошибка превращается в типизированное сообщение из `ApiErrorSchema` или локальное. Запросы не записывают токен в Query cache.
5. При `VITE_DATA_MODE=mock` подключай адаптер `makeMockTimeline`. Возвращай `connection: "mock"`, `stepMock` для ручных шагов и локальные ответы тех же форм. В обычном режиме `stepMock` отсутствует. Mock сброс возвращает начальное состояние под новой ревизией и с новым `seq`.
6. Проверь чистые функции применения снимков для позднего GET, повторного SSE и сброса. Проверь при re-render с одинаковой ревизией, что источник может поменять `source.status`.

**Приёмка.** `npm test -- apps/web/src/data`, `npm run check` и `npm run build`. Отдельно проверь путь `critical → assign → deadline → resolve` без доступного API и опиши точку подключения для T15.
