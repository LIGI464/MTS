import { COORDINATOR_TEAM, type RawIncidentFields } from "@mts/contracts";
import { expect, test, type Page } from "@playwright/test";
import { readLive, startDashboard, writeLive } from "./support/harness.js";

const ID = "INC000000000001";
const card = (page: Page, id = ID) => page.locator(`[data-incident-id="${id}"]`);
const count = (page: Page) => page.locator("[data-incident-id]");

test("D13 показывает 24/44, сочетает фильтры и помещает приоритет 4 в одну очередь", async ({ page }) => {
  await page.goto("/admin/incidents");
  await expect(count(page)).toHaveCount(24);
  await expect(page.getByText("Показано 24 из 44")).toBeVisible();
  const status = page.getByRole("combobox", { name: "Статус", exact: true });
  await status.selectOption("all");
  await expect(count(page)).toHaveCount(44);
  expect(new Set(await count(page).evaluateAll((cards) => cards.map((item) => item.getAttribute("data-incident-id")))).size).toBe(44);
  await status.selectOption("Research");
  await expect(count(page)).toHaveCount(5);
  await expect(page.getByRole("region", { name: "Исследование", exact: true })).toHaveCount(0);

  const reset = page.getByRole("button", { name: "Сбросить", exact: true });
  await reset.click();
  const search = page.getByRole("searchbox", { name: "Поиск инцидентов" });
  await search.fill("АВТОРИЗАЦИЯ");
  await expect(card(page)).toBeVisible();
  await page.getByRole("button", { name: "У координатора", exact: true }).click();
  await expect(card(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Без координатора", exact: true }).click();
  await expect(card(page)).toBeVisible();

  await reset.click();
  await page.getByRole("button", { name: "Фильтры", exact: true }).click();
  await page.getByRole("combobox", { name: "Дубли", exact: true }).selectOption("yes");
  await expect(count(page)).toHaveCount(2);
  await page.getByRole("combobox", { name: "Устранение последствий", exact: true }).selectOption("yes");
  await expect(count(page)).toHaveCount(0);
  await reset.click();
  await expect(count(page)).toHaveCount(24);

  await page.getByRole("button", { name: "Критический", exact: true }).click();
  const critical = page.getByRole("region", { name: "Критические", exact: true });
  await expect(critical.locator(`[data-incident-id="${ID}"]`)).toBeVisible();
  await expect(card(page)).toHaveCount(1);
  await expect(card(page).getByText("Критический", { exact: true })).toBeVisible();
});

test("D13 проверяет карточку, детали, события, клавиатуру и reduced motion в двух размерах", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const viewport = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await page.goto("/admin/incidents");
    await expect(count(page)).toHaveCount(24);
    await page.screenshot({ path: testInfo.outputPath(`board-${viewport}.png`), animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);

    await page.getByRole("button", { name: "Критический", exact: true }).click();
    await page.getByRole("button", { name: "Имитировать обновление ITSM", exact: true }).click();
    const eventTrigger = page.getByRole("button", { name: "События, новых: 2" });
    await expect(eventTrigger).toBeVisible();
    await eventTrigger.focus();
    await page.keyboard.press("Enter");
    const events = page.getByRole("dialog", { name: "События", exact: true });
    await expect(events).toBeVisible();
    const layout = await events.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
      animation: getComputedStyle(element).animationName,
    }));
    expect(layout.animation).toBe("none");
    if (size.width === 390) expect(layout).toMatchObject({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath(`events-${viewport}.png`), animations: "disabled" });
    await events.getByRole("combobox", { name: "Тип события", exact: true }).selectOption("critical.new");
    await expect(events.getByRole("listitem")).toHaveCount(1);
    const incidentLink = events.getByRole("button", { name: "Массовый отказ авторизации" });
    await incidentLink.focus();
    await page.keyboard.press("Enter");
    const details = page.getByRole("dialog", { name: "Массовый отказ авторизации" });
    await expect(details.getByRole("heading", { name: "Решение", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`details-${viewport}.png`), animations: "disabled" });
    await details.getByText("Состояние и сроки", { exact: true }).click();
    await expect(details.getByText("null", { exact: true }).first()).toBeVisible();
    await details.getByText("Исходные тексты и признаки", { exact: true }).click();
    await expect(details.getByText("false", { exact: true }).first()).toBeVisible();
    await details.getByText("Неизвестные поля", { exact: true }).click();
    await expect(details.getByText("0", { exact: true })).toBeVisible();
    await expect(details.getByText('"0007"', { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(incidentLink).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "События", exact: true })).toBeFocused();
  }
});

test("D13 открывает детали и обновляет координатора после новой выгрузки ITSM", async ({ page }) => {
  const app = await startDashboard("rules", "", { coordinators: [{ id: "irina", name: "Ирина Волкова" }] });
  try {
    await page.goto(`${app.url}/admin/incidents`);
    await expect(page.getByText("Данные актуальны", { exact: true })).toBeVisible();
    const incident = card(page);
    await expect(incident.getByText("Координатор не указан в ITSM", { exact: true })).toBeVisible();
    const opener = incident.getByRole("button", { name: "Подробнее" });
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Задержка обновления статусов заказов" });
    await expect(dialog.getByText("Координатор не указан в ITSM", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "В ITSM" })).toHaveAttribute("href", `/itsm/incidents/${ID}`);

    const rows: RawIncidentFields[] = JSON.parse(await readLive(app.dataDir));
    await writeLive(app.dataDir, JSON.stringify(rows.map((row) => row.id === ID
      ? { ...row, assignedGroupName: COORDINATOR_TEAM, assignedEmployee: "  Ирина Волкова  " }
      : row)));
    await expect(dialog.locator("dd").filter({ hasText: "ITSM" })).toHaveText("Ирина Волкова ITSM");
    await expect(dialog.getByRole("button", { name: /назначить|сменить координатора/i })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
    await expect(incident.locator("p").filter({ hasText: "Координатор ·" })).toHaveText("Координатор · Ирина Волкова ITSM");
  } finally {
    await app.stop();
  }
});
