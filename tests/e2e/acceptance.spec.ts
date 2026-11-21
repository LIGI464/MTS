import { COORDINATOR_TEAM, type RawIncidentFields } from "@mts/contracts";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { applyDemoStep, openService, OPERATOR_TOKEN, readLive, removeLive, returnToBoard, startDashboard, writeLive, type RunningApp } from "./support/harness.js";

const GROUPS = ["Критические", "Высокий приоритет", "Средний приоритет", "Низкий приоритет"] as const;
const HIGH_ID = "INC000000000001";
const OTHER_ID = "INC000000000002";
const RESEARCH_ID = "INC000000000004";

test.afterEach(async () => {
  await stopCurrent();
});

let current: RunningApp | undefined;

async function openApp(mode: "rules" | "live-ok" | "live-fail" = "rules", itsmTemplate = ""): Promise<RunningApp> {
  await stopCurrent();
  current = await startDashboard(mode, itsmTemplate);
  return current;
}

async function stopCurrent(): Promise<void> {
  const app = current;
  current = undefined;
  await app?.stop();
}

async function openDashboard(page: Page, app: RunningApp, path = "/admin/incidents"): Promise<void> {
  await page.goto(`${app.url}${path}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Пульт координатора" })).toBeVisible();
  await expect(page.getByText("Данные актуальны")).toBeVisible();
}

function group(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

function card(page: Page, groupName: string, id: string): Locator {
  return group(page, groupName).locator("article").filter({ hasText: id });
}

async function updateCoordinatorTeam(app: RunningApp) {
  const rows: RawIncidentFields[] = JSON.parse(await readLive(app.dataDir));
  await writeLive(app.dataDir, JSON.stringify(rows.map((row) => row.id === HIGH_ID
    ? { ...row, assignedGroupName: COORDINATOR_TEAM }
    : row)));
}

test("A1 показывает четыре группы и обе точки входа", async ({ page }) => {
  const app = await openApp();
  await openDashboard(page, app, "/");
  await openDashboard(page, app, "/admin/incidents");

  for (const name of GROUPS) {
    await expect(group(page, name).getByRole("heading", { name, exact: true })).toBeInViewport();
  }

  await expect(group(page, "Критические").getByText("Нет инцидентов")).toBeVisible();
  const incident = card(page, "Высокий приоритет", HIGH_ID);
  await expect(incident.getByText("Каталог услуг")).toBeVisible();
  await expect(incident.getByText(/Регистрация/)).toBeVisible();
  await expect(incident.getByText("Исполнитель не назначен")).toBeVisible();
  await expect(incident.getByText("Поддержка платформы заказов")).toBeVisible();
  await expect(incident.getByText("Назначен", { exact: true })).toBeVisible();
  await expect(incident.getByText("В сроке")).toBeVisible();
});

test("A2 показывает Research по фильтру в одной очереди", async ({ page }) => {
  const app = await openApp();
  await openDashboard(page, app);
  await expect(page.locator(`[data-incident-id="${RESEARCH_ID}"]`)).toHaveCount(0);
  await page.getByRole("combobox", { name: "Статус", exact: true }).selectOption("Research");
  const research = card(page, "Средний приоритет", RESEARCH_ID);
  await expect(research).toBeVisible();
  await expect(page.locator(`[data-incident-id="${RESEARCH_ID}"]`)).toHaveCount(1);
  await expect(research.getByText("Каталог услуг")).toBeVisible();
  await expect(research.getByText(/Решён · исследование/)).toBeVisible();
  await expect(research.locator("[title='Срок не задан']")).toBeVisible();
});

test("A3–A6 и A11 проводят сценарии, обновление ITSM и сброс у разработчиков", async ({ page }) => {
  const app = await openApp();
  await openDashboard(page, app);
  await expect(page.locator("main").getByRole("button", { name: "Сбросить демо" })).toHaveCount(0);

  applyDemoStep(app.dataDir, "critical");
  const critical = card(page, "Критические", HIGH_ID);
  await expect(critical).toBeVisible();
  await expect(page.locator(".toasts").getByText(`Новый критический инцидент ${HIGH_ID}`)).toHaveCount(1);

  await updateCoordinatorTeam(app);
  await expect(critical.getByText("КЦ ИТ Координаторы Массовых Инцидентов")).toBeVisible();
  await expect(page.locator(`[data-incident-id="${HIGH_ID}"]`)).toHaveCount(1);
  await expect(page.locator(".toasts").getByText(`Назначен координаторам ${HIGH_ID}`)).toHaveCount(1);
  await expect(page.locator(".toasts").getByText(`Новый критический инцидент ${HIGH_ID}`)).toHaveCount(1);

  applyDemoStep(app.dataDir, "deadline");
  const timed = card(page, "Высокий приоритет", OTHER_ID);
  await expect(timed.getByText("Срок близко")).toBeVisible();
  await expect(timed.getByText("1 мин")).toBeVisible();
  await expect(timed).toHaveCSS("color", "rgb(138, 90, 18)");

  applyDemoStep(app.dataDir, "resolve");
  await expect(group(page, "Критические").getByText(HIGH_ID)).toHaveCount(0);
  await expect(page.locator(".toasts").getByText(`Критический инцидент решён ${HIGH_ID}`)).toHaveCount(1);
  await page.getByRole("combobox", { name: "Статус", exact: true }).selectOption("Resolved");
  await expect(critical).toBeVisible();
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();

  await expect(page.getByRole("button", { name: "Сбросить демо" })).toHaveCount(0);
  const service = await openService(page);
  await service.getByLabel("Токен оператора").fill(OPERATOR_TOKEN);
  await service.getByRole("button", { name: "Сбросить демо" }).click();
  await page.getByRole("button", { name: "Подтвердить сброс" }).click();
  await expect(service.getByRole("status")).toHaveText("Набор восстановлен");
  await returnToBoard(page);
  await expect(page.locator(".toasts").getByText("Набор восстановлен")).toBeVisible();
  await expect(group(page, "Критические").getByText("Нет инцидентов")).toBeVisible();
  await expect(group(page, "Критические").getByText(HIGH_ID)).toHaveCount(0);
});

test("A6 обновляет таймер каждую секунду и показывает пропущенный срок", async ({ page }) => {
  const app = await openApp();
  await openDashboard(page, app);
  const rows = JSON.parse(await readLive(app.dataDir)) as Array<Record<string, unknown>>;
  const soon = new Date(Date.now() + 8_000).toISOString();
  for (const row of rows) {
    if (row.id === HIGH_ID) row.deadline = null;
    if (row.id === OTHER_ID) row.deadline = soon;
  }
  await writeLive(app.dataDir, `${JSON.stringify(rows, null, 2)}\n`);

  const missing = card(page, "Высокий приоритет", HIGH_ID);
  const ticking = card(page, "Высокий приоритет", OTHER_ID);
  await expect(missing.getByText("Срок не задан")).toBeVisible();
  await expect(ticking.getByText("Срок близко")).toBeVisible();
  await expect(ticking).toHaveCSS("color", "rgb(138, 90, 18)");
  await expect(ticking.getByText("Просрочен")).toBeVisible({ timeout: 20_000 });
  await expect(ticking).toHaveCSS("color", "rgb(168, 32, 66)");
});

test("A7 показывает локальные правила, мок codex.sale и резервный источник", async ({ page }) => {
  const rules = await openApp("rules");
  await openDashboard(page, rules);
  await analyze(page, "Высокий приоритет", HIGH_ID);
  await expect(analysis(page).getByText("Локальные правила")).toBeVisible();
  await expect(analysis(page).getByText("Режим правил")).toBeVisible();
  await expect(page.getByText("Данные актуальны")).toBeVisible();
  await closeDetails(page);

  const live = await openApp("live-ok");
  await openDashboard(page, live);
  await (await openService(page)).getByLabel("Токен оператора").fill(OPERATOR_TOKEN);
  await returnToBoard(page);
  await analyze(page, "Высокий приоритет", HIGH_ID);
  await expect(analysis(page).getByText("Выжимка мок-провайдера для координатора.")).toBeVisible();
  await expect(analysis(page).getByText("codex.sale")).toBeVisible();
  await expect(page.getByText("Данные актуальны")).toBeVisible();
  await closeDetails(page);

  const fallback = await openApp("live-fail");
  await openDashboard(page, fallback);
  await (await openService(page)).getByLabel("Токен оператора").fill(OPERATOR_TOKEN);
  await returnToBoard(page);
  await analyze(page, "Высокий приоритет", HIGH_ID);
  await expect(analysis(page).getByText("Локальные правила")).toBeVisible();
  await expect(analysis(page).getByText("Ошибка поставщика")).toBeVisible();
  await expect(page.getByText("Данные актуальны")).toBeVisible();
});

test("A8 открывает ITSM по шаблону и локальный адрес без него", async ({ page }) => {
  const linked = await openApp("rules", "https://itsm.example/incidents/{id}");
  await openDashboard(page, linked);
  const link = card(page, "Средний приоритет", "INC000000000003").getByRole("link", { name: "В ITSM" });
  await expect(link).toHaveAttribute("href", "https://itsm.example/incidents/INC000000000003");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await page.context().route("https://itsm.example/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><title>ITSM</title><p>INC000000000003</p>",
    });
  });
  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://itsm.example/incidents/INC000000000003");
  await expect(popup.getByText("INC000000000003")).toBeVisible();
  await popup.close();
  await card(page, "Средний приоритет", "INC000000000003").getByRole("button", { name: "Подробнее" }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "В ITSM" })).toHaveAttribute(
    "href",
    "https://itsm.example/incidents/INC000000000003",
  );

  const local = await openApp();
  await openDashboard(page, local);
  const localCard = card(page, "Средний приоритет", "INC000000000003");
  const localHref = "/itsm/incidents/INC000000000003";
  await expect(localCard.getByRole("link", { name: "В ITSM" })).toHaveAttribute("href", localHref);
  await expect(localCard.getByRole("link", { name: "В ITSM" })).toHaveAttribute("target", "_blank");
  await localCard.getByRole("button", { name: "Подробнее" }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "В ITSM" })).toHaveAttribute("href", localHref);
  const localPopupPromise = page.waitForEvent("popup");
  await page.getByRole("dialog").getByRole("link", { name: "В ITSM" }).click();
  const localPopup = await localPopupPromise;
  await expect(localPopup).toHaveURL(local.url + localHref);
  await expect(localPopup.getByRole("heading", { name: "Перебои доставки уведомлений", exact: true })).toBeVisible();
  await expect(localPopup.getByRole("main").getByText("INC000000000003", { exact: true })).toBeVisible();
  await localPopup.close();
});

test("A9 сохраняет последний снимок при битом и отсутствующем файле", async ({ page }) => {
  const app = await openApp();
  await openDashboard(page, app);
  const intact = await readLive(app.dataDir);
  await expect(card(page, "Высокий приоритет", HIGH_ID)).toBeVisible();

  await writeLive(app.dataDir, "{ битый json");
  await expect(page.getByText("Показан последний сохранённый снимок. Источник устарел.")).toBeVisible();
  await expect(card(page, "Высокий приоритет", HIGH_ID)).toBeVisible();

  await writeLive(app.dataDir, intact);
  await expect(page.getByText("Показан последний сохранённый снимок. Источник устарел.")).toHaveCount(0);
  await expect(page.getByText("Данные актуальны")).toBeVisible();

  await removeLive(app.dataDir);
  await expect(page.getByText("Показан последний сохранённый снимок. Источник устарел.")).toBeVisible();
  await expect(card(page, "Высокий приоритет", HIGH_ID)).toBeVisible();

  await writeLive(app.dataDir, intact);
  await expect(page.getByText("Данные актуальны")).toBeVisible();
  await expect(page.getByText("Показан последний сохранённый снимок. Источник устарел.")).toHaveCount(0);
});

test("A10 после обрыва SSE не повторяет оповещение и подхватывает правку", async ({ page }) => {
  const app = await openApp();
  await openDashboard(page, app);
  applyDemoStep(app.dataDir, "critical");
  await expect(page.locator(".toasts").getByText(`Новый критический инцидент ${HIGH_ID}`)).toHaveCount(1);

  await app.halt();
  await expect(page.getByText("Переподключение")).toBeVisible();
  await app.resume();
  await expect(page.getByText("Данные актуальны")).toBeVisible();
  await expect(page.locator(".toasts").getByText(`Новый критический инцидент ${HIGH_ID}`)).toHaveCount(1);
  await expect(card(page, "Критические", HIGH_ID)).toBeVisible();

  await app.halt();
  await expect(page.getByText("Переподключение")).toBeVisible();
  await updateCoordinatorTeam(app);
  await app.resume();
  await expect(page.getByText("Данные актуальны")).toBeVisible();
  await expect(card(page, "Критические", HIGH_ID).getByText("КЦ ИТ Координаторы Массовых Инцидентов")).toBeVisible();
  await expect(page.locator(".toasts").getByText(`Назначен координаторам ${HIGH_ID}`)).toHaveCount(1);
  await expect(page.locator(".toasts").getByText(`Новый критический инцидент ${HIGH_ID}`)).toHaveCount(1);
});

test("две страницы видят одну атомарную правку файла", async ({ browser }) => {
  const app = await openApp();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const left = await context.newPage();
  const right = await context.newPage();
  try {
    await openDashboard(left, app);
    await openDashboard(right, app);
    applyDemoStep(app.dataDir, "critical");
    await expect(card(left, "Критические", HIGH_ID)).toBeVisible();
    await expect(card(right, "Критические", HIGH_ID)).toBeVisible();
    await expect(left.locator(".toasts").getByText(`Новый критический инцидент ${HIGH_ID}`)).toHaveCount(1);
    await expect(right.locator(".toasts").getByText(`Новый критический инцидент ${HIGH_ID}`)).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test("A13 сохраняет рабочую навигацию и служебные действия на телефоне", async ({ page }) => {
  const app = await openApp();
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page, app);

  const navigation = page.getByRole("navigation", { name: "Разделы проекта" });
  await expect(navigation.getByRole("link")).toHaveCount(3);
  const dashboard = navigation.getByRole("link", { name: "Пульт", exact: true });
  await expect(dashboard).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("link", { name: "Реестр ITSM" })).toHaveAttribute("href", "/itsm/incidents");
  await expect(navigation.getByRole("link", { name: "Разработчикам" })).toHaveAttribute("href", "/admin/developers");
  await dashboard.focus();
  await page.keyboard.press("Tab");
  await expect(navigation.getByRole("link", { name: "Реестр ITSM" })).toBeFocused();

  const footer = page.getByRole("contentinfo");
  await expect(footer.getByText("goida-code · Кейс МТС")).toBeVisible();
  await expect(footer.getByRole("link")).toHaveCount(0);
  await expect(footer.getByText("Служебное", { exact: true })).toHaveCount(0);
  await expect((await openService(page)).getByLabel("Токен оператора")).toBeVisible();
  await returnToBoard(page);

  const details = card(page, "Высокий приоритет", HIGH_ID).getByRole("button", { name: "Подробнее" });
  await details.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

function analysis(page: Page): Locator {
  return page.getByRole("region", { name: "ИИ-анализ" });
}

async function closeDetails(page: Page): Promise<void> {
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть" }).click();
}

async function analyze(page: Page, groupName: string, id: string): Promise<void> {
  await card(page, groupName, id).getByRole("button", { name: "Подробнее" }).click();
  await page.getByRole("button", { name: "ИИ-анализ" }).click();
}
