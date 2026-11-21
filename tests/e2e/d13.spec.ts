import { AssignCoordinatorSchema } from "@mts/contracts";
import { expect, test, type Page } from "@playwright/test";
import { DashboardRequestError } from "../../apps/web/src/data/api";
import { createIncidentFixtures } from "../../apps/web/src/data/incident-fixtures";
import { openService, OPERATOR_TOKEN, returnToBoard, startDashboard } from "./support/harness.js";

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
    await page.getByRole("button", { name: "Назначение", exact: true }).click();
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

test("D13 отправляет версию и UUID, восстанавливается после 409 и ждёт SSE перед обновлением", async ({ page }) => {
  const app = await startDashboard();
  try {
    const fixtures = createIncidentFixtures(Date.now());
    let frame = fixtures.initial;
    let allowEvents = true;
    let conflict = true;
    const client = fixtures.client((next) => { frame = next; });
    const seenVersions: string[] = [];
    const requestIds = new Set<string>();

    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/dashboard")) return route.fulfill({ json: fixtures.initial });
      if (path.endsWith("/events")) {
        return route.fulfill({
          headers: { "content-type": "text/event-stream" },
          body: allowEvents ? `retry: 100\nevent: dashboard\ndata: ${JSON.stringify(frame)}\n\n` : "retry: 100\n\n",
        });
      }
      if (path.endsWith("/coordinators")) return route.fulfill({ json: await client.coordinators() });
      if (path.endsWith(`/${ID}`)) return route.fulfill({ json: await client.detail(ID) });
      if (path.endsWith(`/${ID}/coordinator`)) {
        const body = AssignCoordinatorSchema.parse(request.postDataJSON());
        expect(request.headers().authorization).toBe(`Bearer ${OPERATOR_TOKEN}`);
        seenVersions.push(body.expectedVersion);
        requestIds.add(body.requestId);
        if (conflict) {
          conflict = false;
          await client.assign(ID, { ...body, coordinatorId: "anna", requestId: crypto.randomUUID() });
        }
        try {
          return route.fulfill({ json: await client.assign(ID, body) });
        } catch (error) {
          if (!(error instanceof DashboardRequestError)) throw error;
          return route.fulfill({ status: error.status, json: { code: error.code, message: error.message } });
        }
      }
      return route.continue();
    });
    await page.goto(`${app.url}/admin/incidents`);
    await expect(count(page)).toHaveCount(24);
    allowEvents = false;
    await (await openService(page)).getByLabel("Токен оператора").fill(OPERATOR_TOKEN);
    await returnToBoard(page);

    const assign = card(page).getByRole("button", { name: "Назначить координатора" });
    await assign.click();
    const dialog = page.getByRole("dialog");
    const chooser = dialog.getByRole("combobox", { name: "Координатор для назначения", exact: true });
    await chooser.selectOption("irina");
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Карточка изменилась");
    await dialog.getByRole("button", { name: "Перечитать карточку" }).click();
    await expect(chooser).toHaveValue("irina");
    await expect(chooser.locator("option").first()).toHaveText("Сейчас · Анна Кузнецова");
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(dialog.getByText("Ожидаем обновление от сервера…")).toBeVisible();
    await expect(card(page).getByText("Координатор не назначен")).toHaveCount(1);
    allowEvents = true;
    await expect(dialog.getByText("Координатор обновлён")).toBeVisible();
    await expect(chooser.locator("option").first()).toHaveText("Сейчас · Ирина Волкова");
    await page.keyboard.press("Escape");
    await expect(card(page).getByText("Координатор · Ирина Волкова")).toBeVisible();

    await card(page).getByRole("button", { name: "Подробнее" }).click();
    await dialog.getByRole("combobox", { name: "Координатор для назначения", exact: true }).selectOption("maksim");
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(dialog.getByText("Координатор обновлён")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card(page).getByText("Координатор · Максим Орлов")).toBeVisible();
    expect(seenVersions).toHaveLength(3);
    expect(new Set(seenVersions).size).toBe(3);
    expect(requestIds.size).toBe(3);
  } finally {
    await app.stop();
  }
});
