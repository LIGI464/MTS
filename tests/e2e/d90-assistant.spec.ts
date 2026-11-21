import { API_PREFIX, AssistantChatResponseSchema } from "@mts/contracts";
import { expect, test, type Page } from "@playwright/test";
import { OPERATOR_TOKEN, startDashboard, type RunningApp } from "./support/harness.js";

const DASHBOARD = "/admin/incidents";

function seed() {
  const base = {
    priorityId: 3,
    productName: "Складской учёт",
    service: "Печать",
    submitDate: "2026-05-15T09:30:00.000Z",
  };
  return [
    { ...base, id: "SYN-D90/A", stateEnum: "Assigned", header: "Зависает печать A", description: "Очередь печати A" },
    { ...base, id: "SYN-D90/B", stateEnum: "Assigned", header: "Зависает печать B", description: "Очередь печати B" },
    {
      ...base, id: "SYN-D90/match-1", stateEnum: "Resolved", header: "Зависает печать A",
      shortDescription: "Зависание печати", solution: "Перезапуск службы.", completionDate: "2026-05-15T10:00:00.000Z",
    },
    { ...base, id: "SYN-D90/match-2", stateEnum: "Closed", header: "Печать этикеток", shortDescription: "Очередь", solution: "Очистили." },
  ];
}

let app: RunningApp;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  app = await startDashboard("rules", "https://itsm.example/{id}", { incidents: seed() });
});

test.afterAll(async () => {
  await app?.stop();
});

async function board(page: Page) {
  await page.goto(`${app.url}${DASHBOARD}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Goida-board" })).toBeVisible();
}

const launcher = (page: Page) => page.getByRole("button", { name: /Помощник МТС/ });
const panel = (page: Page) => page.getByRole("complementary", { name: "Помощник МТС" });

test("D90 общий чат с пульта без авто-запроса", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1680, height: 1040 });
  await board(page);
  await expect(launcher(page)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("d90-00-dashboard-launcher.png"), animations: "disabled" });

  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/assistant/chat")) requests.push(request.url());
  });
  await launcher(page).click();
  await expect(launcher(page)).toBeHidden();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText("Укажите ID инцидента или опишите симптомы.")).toBeVisible();
  expect(requests).toHaveLength(0);
  await expect(panel(page).getByRole("heading", { name: "Помощник МТС" })).toBeVisible();
  expect(await panel(page).getByText("SYN-D90/A").count()).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("d90-05-general-chat.png"), animations: "disabled" });

  await panel(page).getByRole("textbox", { name: "Вопрос помощнику" }).fill("Не заряжается аккумулятор.");
  await panel(page).getByRole("button", { name: "Отправить сообщение" }).click();
  await expect(panel(page).getByText("Не заряжается аккумулятор.")).toBeVisible();
  await expect(panel(page).locator("article").filter({ hasText: "Подходящих завершённых" })).toBeVisible();
  await panel(page).getByRole("button", { name: "Свернуть чат" }).click();
  await expect(launcher(page)).toBeVisible();
});

test("D90 контекстный чат из деталей без ИИ-анализа", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1680, height: 1040 });
  await board(page);
  if (await panel(page).isVisible()) await panel(page).getByRole("button", { name: "Свернуть чат" }).click();
  const card = page.locator('[data-incident-id="SYN-D90/A"]');
  await card.getByRole("button", { name: "Подробнее" }).click();
  const details = page.getByRole("dialog");
  await expect(details).toBeVisible();
  await expect(details.getByText("ИИ-анализ")).toHaveCount(0);
  await expect(details.getByText(/^SLA/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("d90-01-details-launcher.png"), animations: "disabled" });

  await launcher(page).click();
  await expect(launcher(page)).toBeHidden();
  await expect(panel(page)).toContainText("SYN-D90/A");
  await expect(panel(page)).toContainText("Зависает печать A");
  await expect.poll(async () => panel(page).getByText("Перезапуск службы.").count()).toBeGreaterThan(0);
  await expect(panel(page).getByRole("link", { name: /В ITSM.*SYN-D90\/match-1/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("d90-02-context-results.png"), animations: "disabled" });

  await panel(page).getByRole("button", { name: "Свернуть чат" }).click();
  await expect(launcher(page)).toBeVisible();
  await expect(panel(page)).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("d90-03-collapsed.png"), animations: "disabled" });

  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await launcher(page).click();
  await expect(panel(page).getByText("Укажите ID инцидента")).toBeVisible();
  expect(await panel(page).getByText("Перезапуск службы.").count()).toBe(0);

  await panel(page).getByRole("button", { name: "Свернуть чат" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  const cardB = page.locator('[data-incident-id="SYN-D90/B"]');
  await cardB.getByRole("button", { name: "Подробнее" }).click();
  await launcher(page).click();
  await expect(panel(page)).toContainText("SYN-D90/B");
  await expect(panel(page)).toContainText("Зависает печать B");
  await expect.poll(async () => panel(page).getByText(/Найдено|завершён/i).count()).toBeGreaterThan(0);
  await expect(panel(page).getByText("Укажите ID инцидента")).toHaveCount(0);
});

test("D90 API и ITSM ссылка на собранном инстансе", async ({ page }) => {
  await board(page);
  const chat = await page.request.post(`${app.url}${API_PREFIX}/assistant/chat`, {
    data: { mode: "incident", context: { incidentId: "SYN-D90/A" } },
  });
  const body = AssistantChatResponseSchema.parse(await chat.json());
  expect(body.status).toBe("answered");
  expect(body.matches[0]?.href).toContain("SYN-D90");
  const matchId = body.matches[0]?.id ?? "";
  expect(matchId).not.toBe("");
  const ticket = await page.request.get(`${app.url}${API_PREFIX}/itsm/incidents/${encodeURIComponent(matchId)}`);
  expect(ticket.ok()).toBeTruthy();
  await page.goto(`${app.url}/itsm/incidents/${encodeURIComponent(matchId)}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Зависает печать A/ })).toBeVisible();
});

test("D90 узкий экран и reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await board(page);
  await launcher(page).click();
  await expect(panel(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await panel(page).getByRole("button", { name: "Свернуть чат" }).click();
  await expect(launcher(page)).toBeVisible();
});