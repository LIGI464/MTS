import { API_PREFIX, type AssistantChatResponse } from "@mts/contracts";
import { expect, test } from "@playwright/test";
import { startDashboard, type RunningApp } from "./support/harness.js";

const incidentId = "SYN-G10-SCROLL";
const title = "Зависает печать этикеток после отправки задания";
const endOfSolution = "Последняя строка решения доступна.";
const paragraph = "Печать этикеток останавливается после отправки задания в очередь. Проверьте состояние задания и соединение с принтером.";
const description = Array.from({ length: 45 }, (_, index) => `${index + 1}. ${paragraph}`).join("\n\n");
const solution = `${paragraph}\n\n${endOfSolution}`;
const chatReply: AssistantChatResponse = {
  mode: "incident",
  status: "answered",
  evaluatedAt: "2026-05-15T10:30:00.000Z",
  source: "rules",
  reason: "rules_mode",
  context: { incidentId },
  summary: "Результаты проверки печати этикеток.",
  nextSteps: Array.from({ length: 8 }, (_, index) => `Проверка ${index + 1}. ${paragraph} ${paragraph}`),
  matches: [],
};

let app: RunningApp;

test.beforeAll(async () => {
  const base = {
    productName: "Складской учёт",
    service: "Печать этикеток",
    submitDate: "2026-05-15T09:30:00.000Z",
    priorityId: 3,
  };
  app = await startDashboard("rules", "", {
    incidents: [{ ...base, id: incidentId, stateEnum: "Assigned", header: title, description, solution }],
  });
});

test.afterAll(async () => { await app?.stop(); });

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`панель инцидента прокручивается под закреплённой шапкой при ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route(`**${API_PREFIX}/assistant/chat`, (route) => {
      const reply = route.request().postDataJSON().question
        ? chatReply
        : { ...chatReply, summary: "Открыта заявка о печати этикеток.", nextSteps: [] };
      return route.fulfill({ json: reply });
    });
    await page.goto(`${app.url}/admin/incidents`, { waitUntil: "domcontentloaded" });
    const opener = page.locator(`[data-incident-id="${incidentId}"]`).getByRole("button", { name: "Подробнее" });
    await opener.click();

    const dialog = page.getByRole("dialog", { name: title });
    const content = dialog.getByRole("region", { name: "Содержимое инцидента" });
    const close = dialog.getByRole("button", { name: "Закрыть", exact: true });
    await expect(close).toBeFocused();
    await expect(content.getByRole("region", { name: "Описание и решение" })
      .getByText(endOfSolution, { exact: false })).toBeAttached();
    const windowScroll = await page.evaluate(() => window.scrollY);
    const closeTop = (await close.boundingBox())?.y;
    await content.press("End");
    await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(500);
    expect((await close.boundingBox())?.y).toBe(closeTop);
    await expect(close).toBeInViewport();

    const history = content.getByText(/^История · \d+$/);
    await history.click();
    const version = content.locator("ol li summary").first();
    await version.press("Enter");
    const lastLine = content.locator("ol li").getByText(endOfSolution, { exact: false });
    await content.press("End");
    await expect(lastLine).toBeInViewport();
    await expect(close).toBeInViewport();
    await expect.poll(() => content.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await close.hover();
    await page.mouse.wheel(0, 400);

    await page.screenshot({ path: testInfo.outputPath("details-history.png"), animations: "disabled" });
    expect(await page.evaluate(() => window.scrollY)).toBe(windowScroll);
    const launcher = page.getByRole("button", { name: /Помощник МТС/ });
    await launcher.click();
    const assistant = page.getByRole("complementary", { name: "Помощник МТС" });
    await expect(assistant).toContainText(incidentId);
    await expect(assistant.getByRole("heading", { name: "Помощник МТС" })).toBeVisible();
    await assistant.getByRole("textbox", { name: "Вопрос помощнику" }).fill("Что проверить?");
    await assistant.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(assistant.getByText(chatReply.summary)).toBeVisible();
    if (viewport.width > 1000) {
      const detailRect = await dialog.boundingBox();
      const chatRect = await assistant.boundingBox();
      expect(detailRect!.x + detailRect!.width).toBeLessThan(chatRect!.x);
      const messages = assistant.locator('[aria-live="polite"]');
      await expect.poll(() => messages.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
      const detailsScroll = await content.evaluate((element) => element.scrollTop);
      await messages.hover();
      await page.mouse.wheel(0, 500);
      await expect.poll(() => messages.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await content.evaluate((element) => element.scrollTop)).toBe(detailsScroll);
    } else {
      await expect(dialog).toBeHidden();
    }
    expect(await page.evaluate(() => window.scrollY)).toBe(windowScroll);
    await page.screenshot({ path: testInfo.outputPath("details-assistant.png"), animations: "disabled" });
    await assistant.getByRole("button", { name: "Свернуть чат" }).click();
    await expect(dialog).toBeVisible();
    await expect(launcher).toBeFocused();
    await expect(lastLine).toBeInViewport();
    await close.click();
    await expect(opener).toBeFocused();
  });
}
