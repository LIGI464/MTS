import {
  API_PREFIX, COORDINATOR_TEAM, FullTicketDetailSchema,
  ImportApplyRequestSchema, ImportApplyResultSchema, SnapshotSchema, type MutationResult, type RawIncidentFields,
} from "@mts/contracts";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createIncidentFixtures } from "../../apps/web/src/data/incident-fixtures";
import { openService, OPERATOR_TOKEN, readLive, returnToBoard, startDashboard, writeLive, type RunningApp } from "./support/harness.js";

const ids = {
  first: "INC000000000001",
  second: "INC000000000002",
  archived: "INC000000000005",
};
const listing = "/itsm/incidents";
const dashboard = "/admin/incidents";
const developer = "/admin/developers";
const coordinatorDirectory = [
  { id: "irina", name: "Ирина Волкова" },
  { id: "maksim", name: "Максим Орлов" },
];
const priorityQueues = (page: Page) => page.locator("#queue-critical, #queue-high, #queue-medium, #queue-low");
const cards = (page: Page) => priorityQueues(page).locator("[data-incident-id]");
const card = (page: Page, id: string) => priorityQueues(page).locator(`[data-incident-id=${JSON.stringify(id)}]`);
const ticketPath = (id: string) => `${listing}/${encodeURIComponent(id)}`;

test("D30 обслуживает прямые маршруты и 24/44 записи в живом Fastify", async ({ page }, testInfo) => {
  const fixtures = createIncidentFixtures(Date.now());
  const { client } = fixtures;
  const rows = await Promise.all(fixtures.initial.incidents.map(async ({ id }) => (await client.detail(id)).rawFields));
  const id = "SYN-D30 /01.5";
  const title = "Массовый отказ авторизации";
  rows[0] = { ...rows[0], id, extraNote: { retries: 0, acknowledged: false, reference: "0007" } };
  const app = await startDashboard("rules", "", { incidents: rows });
  try {
    for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      await openBoard(page, app);
      await expect(cards(page)).toHaveCount(24);
      await expect(page.getByText("Показано 24 из 44")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
      await page.screenshot({ path: testInfo.outputPath(`board-${size.width}x${size.height}.png`), animations: "disabled" });
    }

    for (const [path, heading, current] of [
      [dashboard, "Goida-board", "Дашборд"],
      [developer, "Разработчикам", "Разработчикам"],
      [listing, "Реестр обращений", "Реестр ITSM"],
      [ticketPath(id), title, "Реестр ITSM"],
    ] as const) {
      expect((await page.goto(app.url + path, { waitUntil: "domcontentloaded" }))?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
      expect((await page.reload({ waitUntil: "domcontentloaded" }))?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
      await expect(page.getByRole("navigation").getByRole("link", { name: current, exact: true })).toHaveAttribute("aria-current", "page");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    }

    await page.getByRole("link", { name: "К реестру" }).click();
    const search = page.getByRole("searchbox", { name: "Поиск обращений" });
    await search.fill(id);
    await expect(page.getByRole("list", { name: "Обращения" }).getByRole("listitem")).toHaveCount(1);
    await page.getByRole("link", { name: id, exact: true }).click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Реестр обращений" })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();

    const unknown = await page.request.get(`${app.url}${API_PREFIX}/unknown`);
    expect(unknown.status()).toBe(404);
    expect(unknown.headers()["content-type"]).toContain("application/json");
    expect(await unknown.json()).toMatchObject({ code: "NOT_FOUND" });
    await page.goto(app.url + ticketPath("SYN-UNKNOWN"), { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Заявка не найдена" })).toBeVisible();

    const raw = await ticket(page.request, app, id);
    expect(raw.rawFields).toEqual(rows[0]);
    await openBoard(page, app);
    const status = page.getByRole("combobox", { name: "Статус", exact: true });
    await status.selectOption("all");
    await expect(cards(page)).toHaveCount(44);
    expect(new Set(await cards(page).evaluateAll((elements) => elements.map((item) => item.getAttribute("data-incident-id")))).size).toBe(44);
    await status.selectOption("Research");
    await expect(cards(page)).toHaveCount(5);
    await expect(page.getByRole("region", { name: "Исследование", exact: true })).toHaveCount(0);
    await status.selectOption("active");
    await card(page, id).getByRole("button", { name: "Подробнее" }).click();
    const detail = page.getByRole("dialog");
    await detail.getByText("Неизвестные поля", { exact: true }).click();
    await expect(detail.getByText("extraNote", { exact: true })).toBeVisible();
    await expect(detail.getByText('{"retries":0,"acknowledged":false,"reference":"0007"}', { exact: true })).toBeVisible();
  } finally {
    await app.stop();
  }
});

test("D30 проводит сценарии разработчика, чтение координатора из ITSM и решение в двух контекстах", async ({ browser }, testInfo) => {
  const app = await startDashboard("rules", "", { coordinators: coordinatorDirectory });
  const operator = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const observer = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const left = await operator.newPage();
    const right = await observer.newPage();
    const actions = await operator.newPage();
    await Promise.all([openBoard(left, app), openBoard(right, app), actions.goto(app.url + developer, { waitUntil: "domcontentloaded" })]);
    const baseline = await liveRows(app);
    const create = actions.getByRole("button", { name: "Добавить критический" });
    await actions.getByLabel("Токен оператора").fill("wrong-token");
    await create.click();
    await expect(actions.getByRole("status").getByText("Операторский токен не принят")).toBeVisible();
    expect(await liveRows(app)).toEqual(baseline);

    await actions.getByLabel("Токен оператора").fill(OPERATOR_TOKEN);
    const receiptPromise = actions.waitForResponse((response) =>
      response.url().endsWith("/dev/scenarios") && response.request().postDataJSON()?.action === "create-critical");
    await create.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    const receipt = await receiptPromise;
    expect(receipt.status()).toBe(200);
    const { id } = await receipt.json() as MutationResult;
    expect(id).toMatch(/^INC-SYN-/);
    await expect(actions.getByRole("status").getByText(`Запись подтверждена. ID ${id}.`)).toBeVisible();
    await expect(actions.getByRole("combobox", { name: "Активная заявка" })).toHaveValue(id);
    for (const board of [left, right]) {
      await expect(board.locator("#queue-critical").locator(`[data-incident-id="${id}"]`)).toHaveCount(1);
      await expect(card(board, id)).toHaveCount(1);
      await expect(board.getByRole("button", { name: "События, новых: 1" })).toBeVisible();
    }
    expect((await liveRows(app)).length).toBe(baseline.length + 1);
    const registry = await observer.newPage();
    await registry.goto(app.url + listing, { waitUntil: "domcontentloaded" });
    await expect(registry.getByRole("link", { name: id, exact: true })).toHaveCount(1);

    await expect(actions.getByRole("button", { name: "Назначить координаторам", exact: true })).toHaveCount(0);
    const beforeDeadline = await liveRows(app);
    await runScenario(actions, "Изменить срок", "deadline");
    const afterDeadline = await liveRows(app);
    expect(afterDeadline.filter((row) => row.id !== id)).toEqual(beforeDeadline.filter((row) => row.id !== id));
    expect(afterDeadline.find((row) => row.id === id)?.deadline).not.toBe(beforeDeadline.find((row) => row.id === id)?.deadline);

    await actions.getByRole("combobox", { name: "Активная заявка" }).selectOption(ids.first);
    await runScenario(actions, "Повысить приоритет", "escalate");
    await expect(right.locator("#queue-critical").locator(`[data-incident-id="${ids.first}"]`)).toHaveCount(1);
    await actions.screenshot({ path: testInfo.outputPath("developers-1440x900.png"), animations: "disabled" });

    const putCoordinator = async (name: string) => {
      const rows = await liveRows(app);
      await writeLive(app.dataDir, JSON.stringify(rows.map((row) => row.id === id
        ? { ...row, assignedGroupName: COORDINATOR_TEAM, assignedEmployee: name }
        : row)));
    };
    await putCoordinator(coordinatorDirectory[0].name);
    for (const board of [left, right]) {
      await expect(card(board, id).getByText(COORDINATOR_TEAM)).toBeVisible();
      await expect(card(board, id).getByText("ITSM", { exact: true })).toBeVisible();
    }
    const inspect = card(left, id).getByRole("button", { name: "Подробнее" });
    await inspect.click();
    const leftDetail = left.getByRole("dialog");
    await expect(leftDetail.locator("dd").filter({ hasText: "ITSM" })).toHaveText(`${coordinatorDirectory[0].name} ITSM`);
    await expect(leftDetail.getByRole("button", { name: /назначить|сменить координатора/i })).toHaveCount(0);
    await putCoordinator(coordinatorDirectory[1].name);
    await expect(leftDetail.locator("dd").filter({ hasText: "ITSM" })).toHaveText(`${coordinatorDirectory[1].name} ITSM`);
    await expect(card(right, id).locator("p").filter({ hasText: "Координатор ·" })).toHaveText(
      `Координатор · ${coordinatorDirectory[1].name} ITSM`,
    );
    await left.keyboard.press("Escape");
    await expect(inspect).toBeFocused();
    await right.getByRole("button", { name: "Фильтры", exact: true }).click();
    await right.getByRole("button", { name: "У координатора", exact: true }).click();
    const coordinatorFilter = right.getByRole("combobox", { name: "Координатор", exact: true });
    await coordinatorFilter.selectOption("maksim");
    await expect(cards(right)).toHaveCount(1);
    await expect(card(right, id)).toHaveCount(1);
    await coordinatorFilter.selectOption("irina");
    await expect(cards(right)).toHaveCount(0);
    await right.getByRole("button", { name: "Сбросить", exact: true }).click();

    const rightDetail = right.getByRole("dialog");
    await card(right, id).getByRole("button", { name: "Подробнее" }).click();
    const original = "Решение после ручного изменения файла";
    const originalRows = await liveRows(app);
    await writeLive(app.dataDir, JSON.stringify(originalRows.map((row) => row.id === id ? { ...row, solution: original } : row)));
    await expect(rightDetail.getByRole("region", { name: "Описание и решение" }).getByText(original)).toBeVisible();
    await right.keyboard.press("Escape");

    await registry.getByRole("link", { name: id, exact: true }).click();
    await expect(registry.getByRole("heading", { name: "Синтетическая критическая заявка", exact: true })).toBeVisible();
    await expect(registry.getByRole("region", { name: "Данные заявки" }).locator("dd").filter({ hasText: "ITSM" }))
      .toHaveText(`${coordinatorDirectory[1].name} ITSM`);
    await expect(registry.getByRole("button", { name: "Сохранить решение" })).toHaveCount(0);
    await registry.getByText("Доступ оператора", { exact: true }).click();
    await registry.getByLabel("Токен оператора").fill(OPERATOR_TOKEN);
    await registry.getByRole("button", { name: "Использовать токен" }).click();
    const solution = "Закрыли инцидент и проверили метрики";
    await registry.getByLabel("Текст решения").fill(solution);
    await registry.getByRole("button", { name: "Сохранить решение" }).click();
    await expect(registry.getByRole("status").getByText("Решение сохранено. Изменение появилось в хронологии.")).toBeVisible();
    await expect(card(left, id)).toHaveCount(0);
    await expect(card(right, id)).toHaveCount(0);

    await app.restart();
    expect((await ticket(registry.request, app, id)).history.map((entry) => entry.solution)).toEqual(
      expect.arrayContaining([solution, original]),
    );
    await registry.reload({ waitUntil: "domcontentloaded" });
    const history = registry.getByRole("region", { name: "Хронология" });
    await expect(history.getByText(solution, { exact: false })).toHaveCount(1);
    await expect(history.getByText(original, { exact: false })).toHaveCount(1);
    await registry.screenshot({ path: testInfo.outputPath("itsm-1440x900.png"), animations: "disabled" });
  } finally {
    await Promise.all([operator.close(), observer.close()]);
    await app.stop();
  }
});

test("D30 импортирует через живой D24 после конфликта, повторяет UUID и обновляет оба контекста", async ({ browser }, testInfo) => {
  const app = await startDashboard();
  const operator = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const observer = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const left = await operator.newPage();
    const right = await observer.newPage();
    await Promise.all([openBoard(left, app), openBoard(right, app)]);
    const initial = await snapshot(left.request, app);
    const baseline = await readFile(join(app.dataDir, "baseline.json"), "utf8");
    const originalBytes = await readLive(app.dataDir);
    const rows = await liveRows(app);
    await (await openService(left)).getByLabel("Токен оператора").fill(OPERATOR_TOKEN);
    await left.getByRole("button", { name: "Загрузить JSON" }).click();
    const dialog = left.getByRole("dialog", { name: "Загрузить JSON" });
    const upload = dialog.getByLabel("Файл JSON", { exact: true });
    const check = dialog.getByRole("button", { name: "Проверить файл", exact: true });
    const apply = dialog.getByRole("button", { name: "Подтвердить импорт", exact: true });

    await upload.setInputFiles(jsonFile("broken.json", "{"));
    await check.click();
    await expect(dialog.getByText("Файл не содержит корректный JSON.", { exact: true })).toBeVisible();
    await expect(apply).toHaveCount(0);
    const invalid = Array.from({ length: 23 }, (_, index) => ({ ...rows[0], id: `INVALID-D30-${index}`, priorityId: "3" }));
    await upload.setInputFiles(jsonFile("errors.json", JSON.stringify(invalid)));
    await check.click();
    const errors = dialog.getByRole("region", { name: "Ошибки в файле" });
    await expect(errors.getByRole("listitem")).toHaveCount(23);
    await expect(errors.getByText("$[22].priorityId", { exact: true })).toBeVisible();
    await expect(errors.getByText("INVALID-D30-22", { exact: true })).toBeVisible();
    await left.screenshot({ path: testInfo.outputPath("live-import-errors.png"), animations: "disabled" });
    expect(await readLive(app.dataDir)).toBe(originalBytes);
    expect((await snapshot(right.request, app)).revision).toBe(initial.revision);
    await expect(cards(right)).toHaveCount(3);

    const added = { ...rows[0], id: "SYN-D30-IMPORT", header: "Критический импорт D30", priorityId: 3, Категория: "Наивысший" };
    const updated = rows.filter(({ id }) => id !== ids.archived)
      .map((row) => row.id === ids.first ? { ...row, header: "Обновлено импортом D30" } : row);
    const validText = JSON.stringify([...updated, added]);
    await upload.setInputFiles(jsonFile("valid.json", validText));
    await check.click();
    const preview = dialog.getByRole("region", { name: "Предпросмотр импорта" });
    await expect(preview.getByText("Всего записей 5")).toBeVisible();
    for (const label of ["Добавятся", "Изменятся", "Уйдут в архив"]) {
      await expect(preview.locator("dl > div").filter({ hasText: label }).locator("dd")).toHaveText("1");
    }
    await left.screenshot({ path: testInfo.outputPath("live-import-preview.png"), animations: "disabled" });

    const external = rows.map((row) => row.id === ids.first ? { ...row, solution: "Новая ревизия до подтверждения" } : row);
    await writeLive(app.dataDir, JSON.stringify(external));
    await expect.poll(async () => (await snapshot(right.request, app)).revision).toBeGreaterThan(initial.revision);
    await apply.click();
    await expect(dialog.getByRole("alert")).toContainText("Данные изменились после предпросмотра");
    await expect(preview).toHaveCount(0);
    await expect(apply).toHaveCount(0);
    expect(await liveRows(app)).toEqual(external);
    await dialog.getByRole("button", { name: "Проверить заново" }).click();
    await expect(preview).toBeVisible();

    const submitted: ReturnType<typeof ImportApplyRequestSchema.parse>[] = [];
    const accepted: number[] = [];
    await left.route(`**${API_PREFIX}/incidents/import/apply`, async (route) => {
      submitted.push(ImportApplyRequestSchema.parse(route.request().postDataJSON()));
      const real = await route.fetch();
      expect(real.status()).toBe(200);
      accepted.push(ImportApplyResultSchema.parse(await real.json()).revision);
      if (submitted.length === 1) await route.abort("connectionclosed");
      else await route.fulfill({ response: real });
    });

    await apply.click();
    await expect(dialog.getByRole("alert")).toContainText("Не удалось получить ответ сервера");
    await expect(card(right, added.id).getByText(added.header)).toBeVisible();
    await dialog.getByRole("button", { name: "Повторить подтверждение" }).click();
    await expect(dialog.getByRole("status").filter({ hasText: "Импорт завершён" })).toHaveText(/Импорт завершён\. Ревизия \d+ принята\./);
    expect(submitted).toHaveLength(2);
    expect(submitted[0]).toEqual(submitted[1]);
    expect(accepted[0]).toBe(accepted[1]);
    await left.unroute(`**${API_PREFIX}/incidents/import/apply`);
    await left.keyboard.press("Escape");
    await returnToBoard(left);
    for (const board of [left, right]) {
      await expect(board.locator("#queue-critical").locator(`[data-incident-id="${added.id}"]`)).toHaveCount(1);
      await expect(card(board, ids.first).getByText("Обновлено импортом D30")).toBeVisible();
    }
    expect(await readLive(app.dataDir)).toBe(validText);
    expect(await readFile(join(app.dataDir, "baseline.json"), "utf8")).toBe(baseline);
    expect((await ticket(right.request, app, ids.archived)).ticket.present).toBe(false);

    await app.restart();
    await right.goto(app.url + ticketPath(ids.archived), { waitUntil: "domcontentloaded" });
    await expect(right.getByRole("heading", { name: "Восстановление очереди заказов" })).toBeVisible();
    await expect(right.getByText("В архиве", { exact: true })).toBeVisible();
    expect((await ticket(right.request, app, ids.archived)).history.map(({ present }) => present)).toEqual([false, true]);
    const replay = await right.request.post(`${app.url}${API_PREFIX}/incidents/import/apply`, {
      headers: { authorization: `Bearer ${OPERATOR_TOKEN}` }, data: submitted[0],
    });
    expect(await replay.json()).toEqual({ revision: accepted[0] });
    expect((await snapshot(right.request, app)).revision).toBe(accepted[0]);

    await (await openService(left)).getByRole("button", { name: "Загрузить JSON" }).click();
    await upload.setInputFiles(jsonFile("same.json", validText));
    await check.click();
    await expect(preview).toBeVisible();
    await apply.click();
    await expect(dialog.getByRole("status").filter({ hasText: "Импорт завершён" })).toHaveText(`Импорт завершён. Ревизия ${accepted[0]} принята.`);
  } finally {
    await Promise.all([operator.close(), observer.close()]);
    await app.stop();
  }
});

async function openBoard(page: Page, app: RunningApp) {
  await page.goto(app.url + dashboard, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Goida-board" })).toBeVisible();
  await expect(page.getByText("Данные актуальны", { exact: true })).toBeVisible();
}

async function runScenario(page: Page, name: string, action: string) {
  const response = page.waitForResponse((candidate) =>
    candidate.url().endsWith("/dev/scenarios") && candidate.request().postDataJSON()?.action === action);
  await page.getByRole("button", { name, exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole("status").getByText(/Запись подтверждена/)).toBeVisible();
}

async function snapshot(request: APIRequestContext, app: RunningApp) {
  const response = await request.get(`${app.url}${API_PREFIX}/dashboard`);
  expect(response.ok()).toBe(true);
  return SnapshotSchema.parse(await response.json());
}

async function ticket(request: APIRequestContext, app: RunningApp, id: string) {
  const response = await request.get(`${app.url}${API_PREFIX}${ticketPath(id)}`);
  expect(response.ok()).toBe(true);
  return FullTicketDetailSchema.parse(await response.json());
}

async function liveRows(app: RunningApp): Promise<RawIncidentFields[]> {
  return JSON.parse(await readLive(app.dataDir));
}

function jsonFile(name: string, data: string) {
  return { name, mimeType: "application/json", buffer: Buffer.from(data) };
}
