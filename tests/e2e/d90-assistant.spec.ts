import { API_PREFIX, AssistantChatResponseSchema, type AssistantChatRequest } from "@mts/contracts";
import { expect, test, type Page } from "@playwright/test";
import { OPERATOR_TOKEN, startDashboard, writeLive, type RunningApp } from "./support/harness.js";

const DASHBOARD = "/admin/incidents";
const contextHint = "Задайте вопрос по заявке или по сводке пульта.";
const firstQuestion = "Что известно по этой заявке?";

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
const input = (page: Page) => panel(page).getByRole("textbox", { name: "Вопрос помощнику" });
const send = (page: Page) => panel(page).getByRole("button", { name: "Отправить сообщение" });
const openDetails = (page: Page, id: string) =>
  page.locator(`[data-incident-id="${id}"]`).getByRole("button", { name: "Подробнее" }).click();
const closeDetails = (page: Page) => page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click();

function recordChatRequests(page: Page) {
  const requests: Array<{ payload: AssistantChatRequest; validTestToken: boolean }> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname !== `${API_PREFIX}/assistant/chat`) return;
    requests.push({
      payload: request.postDataJSON(),
      validTestToken: request.headers().authorization === `Bearer ${OPERATOR_TOKEN}`,
    });
  });
  return requests;
}

async function operatorBoard(page: Page, running: RunningApp, token: string) {
  await page.goto(running.url + "/admin/developers");
  await page.getByLabel("Токен оператора").fill(token);
  await page.getByRole("link", { name: "Дашборд", exact: true }).click();
}

async function ask(page: Page, question: string) {
  await input(page).fill(question);
  await send(page).click();
}

test("D90 общий чат с пульта без авто-запроса", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1680, height: 1040 });
  await board(page);
  await expect(launcher(page)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("d90-00-dashboard-launcher.png"), animations: "disabled" });

  const requests = recordChatRequests(page);
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

test("G20 ждёт вопроса при открытии, повторном открытии и переключении заявки", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1680, height: 1040 });
  await board(page);
  if (await panel(page).isVisible()) await panel(page).getByRole("button", { name: "Свернуть чат" }).click();
  const requests = recordChatRequests(page);
  await openDetails(page, "SYN-D90/A");
  const details = page.getByRole("dialog");
  await expect(details).toBeVisible();
  await expect(details.getByText("ИИ-анализ")).toHaveCount(0);
  await expect(details.getByText(/^SLA/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("d90-01-details-launcher.png"), animations: "disabled" });

  await launcher(page).click();
  await expect(launcher(page)).toBeHidden();
  await expect(panel(page)).toContainText("SYN-D90/A");
  await expect(panel(page)).toContainText("Зависает печать A");
  await expect(panel(page).getByText(contextHint)).toBeVisible();
  await expect(panel(page).locator("article")).toHaveCount(0);
  await expect(panel(page).getByText("Помощник готовит ответ…")).toHaveCount(0);
  await expect(input(page)).toBeEnabled();
  expect(requests).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("g20-01-incident-idle.png"), animations: "disabled" });

  await ask(page, "Найди похожие завершённые инциденты.");
  await expect(panel(page).getByRole("link", { name: /В ITSM.*SYN-D90\/match-1/ })).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath("d90-02-context-results.png"), animations: "disabled" });

  await panel(page).getByRole("button", { name: "Свернуть чат" }).click();
  await expect(launcher(page)).toBeVisible();
  await expect(panel(page)).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("d90-03-collapsed.png"), animations: "disabled" });

  await launcher(page).click();
  await expect(panel(page).getByRole("link", { name: /В ITSM.*SYN-D90\/match-1/ })).toBeVisible();
  expect(requests).toHaveLength(1);
  await closeDetails(page);
  await expect(details).toBeHidden();
  await expect(panel(page).getByText("Укажите ID инцидента")).toBeVisible();
  expect(await panel(page).getByText("Перезапуск службы.").count()).toBe(0);

  await openDetails(page, "SYN-D90/B");
  await expect(panel(page)).toContainText("SYN-D90/B");
  await expect(panel(page)).toContainText("Зависает печать B");
  await expect(panel(page).getByText(contextHint)).toBeVisible();
  await expect(panel(page).locator("article")).toHaveCount(0);
  expect(requests).toHaveLength(1);
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

test("G20 ждёт данные заявки, сохраняет вопрос при сбое и отправляет его один раз", async ({ page }) => {
  const live = await startDashboard("live-ok", "", { incidents: seed() });
  const slowDetail = Promise.withResolvers<void>();
  const firstId = "SYN-D90/A";
  const secondId = "SYN-D90/B";
  try {
    await page.route(`**${API_PREFIX}/itsm/incidents/${encodeURIComponent(firstId)}`, async (route) => {
      await slowDetail.promise;
      await route.fulfill({ status: 503, json: { code: "UNAVAILABLE", message: "Источник заявки временно недоступен." } });
    }, { times: 1 });
    const requests = recordChatRequests(page);
    await operatorBoard(page, live, ` ${OPERATOR_TOKEN} `);
    await openDetails(page, firstId);
    await launcher(page).click();
    await expect(panel(page).getByText(contextHint)).toBeVisible();
    expect(requests).toHaveLength(0);

    await ask(page, firstQuestion);
    await expect(panel(page).getByText("Ждём данные заявки…")).toBeVisible();
    await expect(input(page)).toHaveValue(firstQuestion);
    await panel(page).getByRole("button", { name: "Отменить" }).click();
    await expect(input(page)).toBeEnabled();
    await expect(input(page)).toHaveValue(firstQuestion);
    await send(page).click();
    await expect(panel(page).getByText("Ждём данные заявки…")).toBeVisible();
    expect(requests).toHaveLength(0);

    slowDetail.resolve();
    await expect(panel(page).getByRole("alert")).toHaveText("Источник заявки временно недоступен.");
    expect(requests).toHaveLength(0);
    await panel(page).getByRole("button", { name: "Повторить загрузку" }).click();
    await expect(panel(page).getByText(`Данные заявки ${firstId} проверены.`)).toBeVisible();
    await expect(panel(page).getByText("codex.sale")).toBeVisible();
    expect(requests).toHaveLength(1);

    await closeDetails(page);
    await openDetails(page, secondId);
    await expect(panel(page).getByText(contextHint)).toBeVisible();
    expect(requests).toHaveLength(1);
    await ask(page, firstQuestion);
    await expect(panel(page).getByText(`Данные заявки ${secondId} проверены.`)).toBeVisible();
    expect(requests).toHaveLength(2);
    for (const [index, id] of [firstId, secondId].entries()) {
      expect(requests[index]).toMatchObject({
        validTestToken: true,
        payload: { question: firstQuestion, context: { incidentId: id, incidentVersion: expect.any(String) } },
      });
    }
  } finally {
    slowDetail.resolve();
    await live.stop();
  }
});

test("G20 отменяет запрос при переключении заявки и при смене её версии", async ({ page }) => {
  const live = await startDashboard("live-ok", "", { incidents: seed() });
  const firstId = "SYN-D90/A";
  const secondId = "SYN-D90/B";
  const releaseFirst = Promise.withResolvers<void>();
  const releaseSecond = Promise.withResolvers<void>();
  const gates = new Map([[firstId, releaseFirst], [secondId, releaseSecond]]);
  const firstVersion = new Map<string, string>();
  try {
    await page.route(`**${API_PREFIX}/assistant/chat`, async (route) => {
      const { context } = route.request().postDataJSON() as AssistantChatRequest;
      const id = context.incidentId ?? "";
      const gate = gates.get(id);
      if (!gate) return route.continue();
      gates.delete(id);
      firstVersion.set(id, context.incidentVersion ?? "");
      await gate.promise;
      const response = {
        mode: "incident", status: "answered", source: "rules", reason: "provider_error",
        evaluatedAt: "2026-05-15T09:30:00.000Z", context,
        summary: `Устаревший ответ для ${id}`, nextSteps: [], matches: [],
      };
      // The route can already be cancelled by the client's AbortSignal.
      await route.fulfill({ json: response }).catch(() => {});
    });
    const requests = recordChatRequests(page);
    await operatorBoard(page, live, OPERATOR_TOKEN);
    await openDetails(page, firstId);
    await launcher(page).click();
    await ask(page, firstQuestion);
    await expect.poll(() => firstVersion.has(firstId)).toBe(true);
    await closeDetails(page);
    await openDetails(page, secondId);
    await expect(panel(page).getByText(contextHint)).toBeVisible();
    await ask(page, firstQuestion);
    await expect.poll(() => firstVersion.has(secondId)).toBe(true);
    releaseFirst.resolve();
    await expect(panel(page).getByText("Помощник готовит ответ…")).toBeVisible();
    await expect(panel(page).getByText(/Устаревший ответ/)).toHaveCount(0);

    const updatedTitle = "Зависает печать B после обновления";
    await writeLive(live.dataDir, JSON.stringify(seed().map((entry) =>
      entry.id === secondId ? { ...entry, header: updatedTitle } : entry)));
    await expect(panel(page)).toContainText(updatedTitle);
    await expect(input(page)).toBeEnabled();
    await expect(input(page)).toHaveValue(firstQuestion);
    await expect(panel(page).getByRole("alert")).toContainText("Данные заявки обновились.");
    releaseSecond.resolve();
    await expect(panel(page).getByText(/Устаревший ответ/)).toHaveCount(0);
    expect(requests).toHaveLength(2);

    await send(page).click();
    await expect(panel(page).getByText(`Данные заявки ${secondId} проверены.`)).toBeVisible();
    expect(requests).toHaveLength(3);
    expect(requests[2].payload.context.incidentVersion).not.toBe(firstVersion.get(secondId));
    await expect(panel(page).getByText(/Устаревший ответ/)).toHaveCount(0);
  } finally {
    releaseFirst.resolve();
    releaseSecond.resolve();
    await live.stop();
  }
});

test("G20 отличает отказ токена от резервного ответа при сбое модели", async ({ page }) => {
  const live = await startDashboard("live-fail", "", { incidents: seed() });
  try {
    await operatorBoard(page, live, "wrong-operator-token");
    await openDetails(page, "SYN-D90/A");
    await launcher(page).click();
    await ask(page, firstQuestion);
    await expect(panel(page).getByRole("alert")).toContainText("Требуется действующий токен оператора.");
    await expect(input(page)).toHaveValue(firstQuestion);
    await expect(panel(page).getByRole("button", { name: "Повторить", exact: true })).toBeEnabled();
    await expect(panel(page).getByText("Локальные правила", { exact: true })).toHaveCount(0);

    await operatorBoard(page, live, OPERATOR_TOKEN);
    await openDetails(page, "SYN-D90/A");
    await launcher(page).click();
    await ask(page, firstQuestion);
    await expect(panel(page).getByText("Локальные правила · Сервис модели недоступен.")).toBeVisible();
  } finally {
    await live.stop();
  }
});
