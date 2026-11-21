# Репетиция разбора и передачи смены

Сценарий запускается с двумя синтетическими заявками в отдельном временном каталоге. Команды выполняются из корня репозитория с Node.js 24 и установленными зависимостями.

```bash
npm run build
export MTS_DATA_DIR="$(mktemp -d)"
node --input-type=module - "$MTS_DATA_DIR/shift-demo.json" <<'JS'
import { writeFileSync } from "node:fs";

const now = Date.now();
const at = (minutes) => new Date(now + minutes * 60_000).toISOString();
const first = {
  id: "INC-TRIAGE-1",
  header: "Сбой авторизации",
  productName: "Личный кабинет",
  service: "Вход",
  assignedGroupName: "Сетевое сопровождение",
  stateEnum: "Assigned",
  priorityId: 4,
  submitDate: at(-50),
  deadline: at(-5),
};
const second = {
  ...first,
  id: "INC-TRIAGE-2",
  header: "СБОЙ авторизации!",
  stateEnum: "WorkInProgress",
  priorityId: 3,
  submitDate: at(-45),
  deadline: at(5),
};
writeFileSync(process.argv[2], JSON.stringify([first, second]));
JS
npm run data:load -- --file "$MTS_DATA_DIR/shift-demo.json"
PORT=8787 npm start
```

1. Откройте [Goida-board](http://127.0.0.1:8787/admin/incidents). В разделе «Разбор смены» раскройте «Возможные общие сбои». Две заявки видны в одной группе.
2. Откройте `INC-TRIAGE-1`. В карточке две активные заявки команды, одна просрочена. Если с запуска прошло меньше пяти минут, у второй близок срок. Нажмите «Показать очередь команды».
3. Нажмите «Передать смену». В тексте есть ревизия снимка, заявки с причинами попадания в сводку, группа совпадений и последние события. Нажмите «Копировать сводку».

Сквозной тест дополнительно передвигает срок второй заявки через SSE, решает её во время просмотра сводки, проверяет повторное открытие, недоступный буфер, мобильную ширину, фокус и устаревший снимок. Для воспроизведения запустите `npm run test:e2e -- shift-triage.spec.ts` после сборки в окружении с Chromium Playwright. [Сквозной тест](../../tests/e2e/shift-triage.spec.ts)

## Результаты проверки

- `npm run check` и `npm run build` прошли на Node.js 24.
- Vitest прошёл 207 тестов, включая проверку отдельной публичной выгрузки на 44 заявки через `MTS_SOURCE_FILE`.
- Playwright прошёл все 42 сквозных сценария на Chromium 156. Загрузку браузера Playwright отклонил CDN, поэтому для прогона использовался системный Chromium с временной конфигурацией вне репозитория.
- Команды репетиции проверены на отдельном экземпляре. Он вернул здоровый источник и обе заявки в ревизии 1.
