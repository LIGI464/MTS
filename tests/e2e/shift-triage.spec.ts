import type { RawIncidentFields } from "@mts/contracts";
import { expect, test } from "@playwright/test";
import { startDashboard, writeLive } from "./support/harness.js";

test("разбор смены связывает активные заявки, показывает очередь команды и фиксирует сводку", async ({ page, context }) => {
  const now = Date.now();
  const instant = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  const first: RawIncidentFields = {
    id: "INC-TRIAGE-1", header: "Сбой авторизации", productName: "Личный кабинет", service: "Вход",
    assignedGroupName: "Сетевое сопровождение", stateEnum: "Assigned", priorityId: 4,
    submitDate: instant(-50), deadline: instant(-5),
  };
  const second = {
    ...first, id: "INC-TRIAGE-2", header: "СБОЙ авторизации!", stateEnum: "WorkInProgress", priorityId: 3,
    submitDate: instant(-45), deadline: instant(5),
  };
  const unrelated = { ...second, id: "INC-TRIAGE-3", service: "Платежи", assignedGroupName: "Платежи", deadline: null };
  const history = { ...second, id: "INC-TRIAGE-4", stateEnum: "Closed", completionDate: instant(-1) };
  const incidents = [first, second, unrelated, history];
  const app = await startDashboard("rules", "", { incidents });
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.url });
    await page.goto(`${app.url}/admin/incidents`);
    await expect(page.getByText("Данные актуальны")).toBeVisible();

    const shift = page.getByRole("region", { name: "Разбор смены" });
    const search = page.getByRole("searchbox", { name: "Поиск инцидентов" });
    await search.fill("INC-TRIAGE-3");
    await shift.getByText("Возможные общие сбои", { exact: true }).click();
    const cluster = shift.getByRole("list", { name: "Группы совпадений" });
    await expect(cluster.getByRole("button")).toHaveText(["INC-TRIAGE-1", "INC-TRIAGE-2"]);
    const openIncident = cluster.getByRole("button", { name: first.id });
    await openIncident.click();
    const details = page.getByRole("dialog", { name: first.header as string });
    const workload = details.getByRole("region", { name: "Нагрузка команды по снимку ITSM" });
    await expect(workload.locator("dd")).toHaveText(["2", "1", "1"]);
    let chatRequests = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/assistant/chat")) chatRequests += 1;
    });
    await page.getByRole("button", { name: /Помощник МТС/ }).click();
    const assistant = page.getByRole("complementary", { name: "Помощник МТС" });
    await expect(assistant.getByText(first.id, { exact: true })).toBeVisible();
    await expect(assistant.getByRole("textbox", { name: "Вопрос помощнику" })).toBeEnabled();
    expect(chatRequests).toBe(0);
    await assistant.getByRole("button", { name: "Свернуть чат" }).click();
    await expect(workload).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(openIncident).toBeFocused();

    await openIncident.click();
    await writeLive(app.dataDir, JSON.stringify([first, { ...second, deadline: instant(-2) }, unrelated, history]));
    await expect(workload.locator("dd")).toHaveText(["2", "0", "2"]);
    await workload.getByRole("button", { name: "Показать очередь команды" }).click();
    await expect(details).toBeHidden();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("");
    await expect(page.getByText("Показано 2 из 4")).toBeVisible();
    await expect(page.getByRole("region", { name: "Очереди инцидентов" })
      .locator(`[data-incident-id="${unrelated.id}"]`)).toHaveCount(0);

    const handoff = shift.getByRole("button", { name: "Передать смену" });
    await handoff.click();
    const preview = page.getByRole("dialog", { name: "Передача смены" });
    const text = preview.getByRole("textbox", { name: "Текст сводки" });
    const original = await text.inputValue();
    expect(original).toContain("Требуют внимания (2)");
    expect(original).toContain("Возможные общие сбои (1)");
    expect(original).toContain("Критические, Просрочены");
    const copy = preview.getByRole("button", { name: "Копировать сводку" });
    await copy.click();
    await expect(preview.getByRole("status")).toHaveText("Сводка скопирована.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(original);

    await writeLive(app.dataDir, JSON.stringify([first, { ...second, stateEnum: "Resolved", completionDate: instant(0) }, unrelated, history]));
    await expect(page.getByText("Групп совпадений пока нет.")).toBeVisible();
    await expect(text).toHaveValue(original);
    await page.keyboard.press("Escape");
    await expect(handoff).toBeFocused();

    await page.setViewportSize({ width: 375, height: 780 });
    await handoff.click();
    await expect(text).toHaveValue(/Требуют внимания \(1\)/);
    await expect(text).toHaveValue(/Возможные общие сбои \(0\)/);
    expect(await preview.evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(375);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async () => { throw new Error("blocked"); } },
        configurable: true,
      });
    });
    await copy.click();
    await expect(preview.getByRole("status")).toHaveText("Буфер недоступен. Текст выделен для ручного копирования.");
    await expect(text).toBeFocused();
    expect(await text.evaluate((node) => {
      const field = node as HTMLTextAreaElement;
      return [field.selectionStart, field.selectionEnd];
    })).toEqual([0, (await text.inputValue()).length]);
    await preview.getByRole("button", { name: "Закрыть сводку" }).click();
    await expect(handoff).toBeFocused();

    await writeLive(app.dataDir, "{");
    await expect(page.getByText("Показан последний сохранённый снимок. Источник устарел.")).toBeVisible();
    await handoff.click();
    await expect(text).toHaveValue(/Источник устарел/);
    await expect(text).toHaveValue(/Последний успешный снимок/);
  } finally {
    await app.stop();
  }
});
