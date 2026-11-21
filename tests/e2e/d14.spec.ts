import {
  ImportApplyRequestSchema, ImportPreviewRequestSchema, ImportPreviewResultSchema,
  type ImportApplyRequest, type Snapshot,
} from "@mts/contracts";
import { expect, test, type Page } from "@playwright/test";
import { createIncidentFixtures } from "../../apps/web/src/data/incident-fixtures";
import { OPERATOR_TOKEN, startDashboard, type RunningApp } from "./support/harness.js";

const example = createIncidentFixtures(Date.now()).initial;
const importedTitle = "Сбои регистрации SIM после обновления";
const imported = [
  { ...example.incidents[0], title: "Обновлено описание сбоя авторизации", version: "imported-1" },
  example.incidents[1],
  { ...example.incidents[3], title: importedTitle, priority: 4 as const, version: "imported-4" },
  { ...example.incidents[4], priority: 1 as const, version: "imported-5" },
  { ...example.incidents[5], priority: 2 as const, version: "imported-6" },
];
const validRows = imported.map(({ id, title, priority, createdAt, state }) => ({
  id, header: title, priorityId: priority, submitDate: createdAt, stateEnum: state,
}));

const invalidRows = [
  { ...validRows[0], priorityId: "3", submitDate: "вчера" },
  { ...validRows[1], sysId: 900719 },
  { ...validRows[2], id: validRows[0].id },
  false,
];

let app: RunningApp;
test.beforeAll(async () => { app = await startDashboard(); });
test.afterAll(async () => { await app?.stop(); });

for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`D14 показывает ошибки, предпросмотр и принятую ревизию при ${size.width}×${size.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(size);
    const fixture = await useImportFixture(page);
    const dialog = await openImport(page);
    await expect.poll(async () => (await dialog.boundingBox())?.width).toBe(size.width === 390 ? 390 : 720);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    const file = dialog.getByLabel("Файл JSON", { exact: true });
    const check = dialog.getByRole("button", { name: "Проверить файл" });
    const confirm = dialog.getByRole("button", { name: "Подтвердить импорт" });

    await file.setInputFiles(jsonFile("incidents-errors.json", invalidRows));
    await check.click();
    const issues = dialog.getByRole("region", { name: "Ошибки в файле" });
    await expect(issues.getByRole("listitem")).toHaveCount(5);
    const priorityIssue = issues.getByRole("listitem").filter({ hasText: "$[0].priorityId" });
    await expect(priorityIssue).toContainText("Запись 1");
    await expect(priorityIssue).toContainText(String(validRows[0].id));
    await expect(priorityIssue).toContainText("Укажите числовой приоритет от 1 до 4.");
    await expect(issues.getByText("ID уже встречался в файле.")).toBeVisible();
    await expect(confirm).toHaveCount(0);
    const viewport = `${size.width}x${size.height}`;
    await page.screenshot({ path: testInfo.outputPath(`import-errors-${viewport}.png`), animations: "disabled" });

    await file.setInputFiles(jsonFile("incidents-valid.json", validRows));
    await expect(issues).toHaveCount(0);
    await check.click();
    const preview = dialog.getByRole("region", { name: "Предпросмотр импорта" });
    await expect(preview.getByText("Всего записей 5")).toBeVisible();
    for (const [label, value] of [
      ["Критический", 1], ["Высокий", 2], ["Средний", 1], ["Низкий", 1],
      ["Добавятся", 3], ["Изменятся", 1], ["Уйдут в архив", 1],
    ] as const) {
      await expect(preview.locator("dl > div").filter({ hasText: label }).locator("dd")).toHaveText(String(value));
    }
    await page.screenshot({ path: testInfo.outputPath(`import-preview-${viewport}.png`), animations: "disabled" });
    await file.setInputFiles(jsonFile("incidents-updated.json", validRows));
    await expect(preview).toHaveCount(0);
    await expect(confirm).toHaveCount(0);
    await check.click();
    await expect(preview).toBeVisible();
    await confirm.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(dialog.getByText(/Ждём обновление снимка/)).toBeVisible();
    expect(fixture.applyRequests).toHaveLength(1);
    await expect(page.locator("[data-incident-id]").filter({ hasText: importedTitle })).toHaveCount(0);
    fixture.publish();
    await expect(dialog.getByRole("status")).toHaveText("Импорт завершён. Ревизия 2 принята.");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Загрузить JSON" })).toBeFocused();
    await expect(page.locator("[data-incident-id]").filter({ hasText: importedTitle })).toHaveCount(1);
    expect(fixture.applyRequests).toHaveLength(1);
  });
}

test("D14 раздельно определяет доступность импорта и сброса", async ({ page }) => {
  await useImportFixture(page, { importAvailable: false, resetAvailable: true });
  const probe = page.waitForResponse((response) => response.url().endsWith("/import/preview") && response.status() === 404);
  await page.goto(`${app.url}/admin/incidents`);
  await probe;
  const footer = page.getByRole("contentinfo");
  await footer.getByText("Служебное", { exact: true }).click();
  await expect(footer.getByRole("button", { name: "Сбросить демо" })).toBeVisible();
  await expect(footer.getByRole("button", { name: "Загрузить JSON" })).toHaveCount(0);
});

test("D14 восстанавливается после отказа доступа, сетевого сбоя и конфликта ревизии", async ({ page }) => {
  const fixture = await useImportFixture(page);
  const dialog = await openImport(page, "invalid-operator-token");
  const check = dialog.getByRole("button", { name: "Проверить файл" });
  await dialog.getByLabel("Файл JSON", { exact: true }).setInputFiles(jsonFile("incidents-valid.json", validRows));
  await check.click();
  await expect(dialog.getByRole("alert")).toContainText("Доступ отклонён");
  await dialog.getByRole("button", { name: "Закрыть импорт" }).click();
  await page.getByLabel("Токен оператора").fill(OPERATOR_TOKEN);
  await page.getByRole("button", { name: "Загрузить JSON" }).click();
  await expect(dialog.getByText("incidents-valid.json")).toBeVisible();

  fixture.failPreview = true;
  await check.click();
  await expect(dialog.getByRole("alert")).toContainText("Не удалось связаться с сервером");
  await check.click();
  const confirm = dialog.getByRole("button", { name: "Подтвердить импорт" });
  const preview = dialog.getByRole("region", { name: "Предпросмотр импорта" });
  await expect(preview).toBeVisible();

  fixture.conflict = true;
  await confirm.click();
  await expect(dialog.getByRole("alert")).toContainText("Данные изменились после предпросмотра");
  await expect(preview).toHaveCount(0);
  await expect(confirm).toHaveCount(0);
  await dialog.getByRole("button", { name: "Проверить заново" }).click();
  await expect(preview).toBeVisible();

  fixture.loseApplyResponse = true;
  await confirm.click();
  await expect(dialog.getByRole("alert")).toContainText("Не удалось получить ответ сервера");
  await dialog.getByRole("button", { name: "Повторить подтверждение" }).click();
  await expect(dialog.getByText(/Ждём обновление снимка/)).toBeVisible();
  expect(fixture.applyRequests.map(({ expectedRevision }) => expectedRevision)).toEqual([1, 2, 2]);
  expect(fixture.applyRequests[1]).toEqual(fixture.applyRequests[2]);
  expect(fixture.applyRequests[0].requestId).not.toBe(fixture.applyRequests[1].requestId);
  fixture.publish();
  await expect(dialog.getByRole("status")).toHaveText("Импорт завершён. Ревизия 3 принята.");
});

async function openImport(page: Page, token = OPERATOR_TOKEN) {
  await page.goto(`${app.url}/admin/incidents`);
  const footer = page.getByRole("contentinfo");
  await footer.getByText("Служебное", { exact: true }).click();
  await expect(footer.getByRole("button", { name: "Сбросить демо" })).toHaveCount(0);
  await footer.getByLabel("Токен оператора").fill(token);
  await footer.getByRole("button", { name: "Загрузить JSON" }).click();
  return page.getByRole("dialog", { name: "Загрузить JSON" });
}

function jsonFile(name: string, rows: unknown[]) {
  return { name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(rows)) };
}

async function useImportFixture(page: Page, { importAvailable = true, resetAvailable = false } = {}) {
  let frame: Snapshot = {
    ...example,
    incidents: example.incidents.slice(0, 3),
    capabilities: { demoReset: resetAvailable, liveAnalysis: false },
  };
  let accepted: Snapshot | undefined;
  let previewNumber = 0;
  let lastPreview: { previewId: string; expectedRevision: number } | undefined;
  const flags = {
    failPreview: false, conflict: false, loseApplyResponse: false, applyRequests: [] as ImportApplyRequest[],
    publish() {
      if (!accepted) throw new Error("Импорт ещё не был принят фикстурой.");
      frame = accepted;
    },
  };

  await page.route("**/api/v1/dashboard", (route) => route.fulfill({ json: frame }));
  await page.route("**/api/v1/events", (route) => route.fulfill({
    headers: { "content-type": "text/event-stream" },
    body: `retry: 180\nevent: dashboard\ndata: ${JSON.stringify(frame)}\n\n`,
  }));
  await page.route("**/api/v1/incidents/import/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    expect(request.method()).toBe("POST");
    if (!importAvailable) {
      return route.fulfill({ status: 404, json: { code: "NOT_FOUND", message: "Маршрут не найден." } });
    }
    if (request.headers().authorization !== `Bearer ${OPERATOR_TOKEN}`) {
      if (!request.headers().authorization) expect(request.postDataJSON()).toEqual({});
      return route.fulfill({ status: 403, json: { code: "OPERATOR_TOKEN_INVALID", message: "Токен отклонён." } });
    }
    if (path.endsWith("/preview")) {
      const body = ImportPreviewRequestSchema.parse(request.postDataJSON());
      if (flags.failPreview) {
        flags.failPreview = false;
        return route.abort("internetdisconnected");
      }
      if (body.fileName === "incidents-errors.json") {
        expect(JSON.parse(body.jsonText)).toEqual(invalidRows);
        return route.fulfill({ json: ImportPreviewResultSchema.parse({
          valid: false, total: 4, byPriority: { 1: 0, 2: 0, 3: 1, 4: 1 }, added: 0, updated: 0, archived: 0,
          errors: ["Запись 1, поле priorityId: некорректное значение.", "Запись 1, поле submitDate: некорректное значение.",
            "Запись 2, поле sysId: некорректное значение.", "Запись 4: ожидается объект заявки."],
        }) });
      }
      expect(JSON.parse(body.jsonText)).toEqual(validRows);
      lastPreview = { previewId: `preview-${++previewNumber}`, expectedRevision: frame.revision };
      return route.fulfill({ json: ImportPreviewResultSchema.parse({
        valid: true, errors: [], total: 5, byPriority: { 1: 1, 2: 1, 3: 2, 4: 1 }, added: 3, updated: 1, archived: 1,
        ...lastPreview,
      }) });
    }

    const body = ImportApplyRequestSchema.parse(request.postDataJSON());
    expect(lastPreview).toEqual({ previewId: body.previewId, expectedRevision: body.expectedRevision });
    flags.applyRequests.push(body);
    if (flags.conflict) {
      flags.conflict = false;
      frame = { ...frame, revision: frame.revision + 1 };
      return route.fulfill({ status: 409, json: { code: "REVISION_CONFLICT", message: "Ревизия устарела." } });
    }
    accepted ??= {
      ...frame, revision: frame.revision + 1, incidents: imported,
      groups: { critical: [imported[2].id], high: imported.slice(0, 2).map(({ id }) => id), coordinator: [], research: [] },
    };
    if (flags.loseApplyResponse) {
      flags.loseApplyResponse = false;
      return route.abort("connectionclosed");
    }
    return route.fulfill({ json: { revision: accepted.revision } });
  });
  return flags;
}
