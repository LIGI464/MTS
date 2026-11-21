import { expect, test, type Locator, type Page } from "@playwright/test";
import { applyDemoStep, OPERATOR_TOKEN, readLive, removeLive, startDashboard, writeLive, type RunningApp } from "./support/harness.js";

const GROUPS = ["Критические", "У координаторов", "Высокий приоритет", "Исследование"] as const;
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

test("A2 показывает один ID в двух группах, включая Research", async ({ page }) => {
  const app = await openApp();
  await openDashboard(page, app);
  const research = card(page, "Исследование", RESEARCH_ID);
  const coordinators = card(page, "У координаторов", RESEARCH_ID);
  await expect(research).toBeVisible();
  await expect(coordinators).toBeVisible();
  await expect(research.getByText("Каталог услуг")).toBeVisible();
  await expect(coordinators.getByText("Каталог услуг")).toBeVisible();
  await expect(research.getByText(/Решён · исследование/)).toBeVisible();
  await expect(research.locator("[title='Срок не задан']")).toBeVisible();
});

test("A3–A6 и A11 проводят critical, assign, deadline, resolve и скрытый сброс", async ({ page }) => {
  const app = await openApp();
  await openDashboard(page, app);
  await expect(page.locator("main").getByRole("button", { name: "Сбросить демо" })).toHaveCount(0);

  applyDemoStep(app.dataDir, "critical");
  const critical = card(page, "Критические", HIGH_ID);
  await expect(critical).toBeVisible();
  await expect(page.locator(".toasts").getByText(`Новый критический инцидент ${HIGH_ID}`)).toHaveCount(1);

  applyDemoStep(app.dataDir, "assign");
  const assigned = card(page, "У координаторов", HIGH_ID);
  await expect(assigned).toBeVisible();
  await expect(critical.getByText("Каталог услуг")).toBeVisible();
  await expect(assigned.getByText("Каталог услуг")).toBeVisible();
  await expect(critical.getByText("КЦ ИТ Координаторы Массовых Инцидентов")).toBeVisible();
  await expect(assigned.getByText("КЦ ИТ Координаторы Массовых Инцидентов")).toBeVisible();
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
  await card(page, "Высокий приоритет", OTHER_ID).getByRole("button", { name: "Детали" }).click();
  await page.getByRole("tab", { name: "История" }).click();
  await expect(page.getByRole("tabpanel").getByText(HIGH_ID)).toBeVisible();
  await closeDetails(page);

  const reset = page.getByRole("button", { name: "Сбросить демо" });
  await expect(reset).toBeHidden();
  await page.getByText("Служебное", { exact: true }).click();
  await page.getByLabel("Токен оператора").fill(OPERATOR_TOKEN);
  await reset.click();
  await page.getByRole("button", { name: "Подтвердить сброс" }).click();
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
  await page.getByText("Служебное", { exact: true }).click();
  await page.getByLabel("Токен оператора").fill(OPERATOR_TOKEN);
  await analyze(page, "Высокий приоритет", HIGH_ID);
  await expect(analysis(page).getByText("Выжимка мок-провайдера для координатора.")).toBeVisible();
  await expect(analysis(page).getByText("codex.sale")).toBeVisible();
  await expect(page.getByText("Данные актуальны")).toBeVisible();
  await closeDetails(page);

  const fallback = await openApp("live-fail");
  await openDashboard(page, fallback);
  await page.getByText("Служебное", { exact: true }).click();
  await page.getByLabel("Токен оператора").fill(OPERATOR_TOKEN);
  await analyze(page, "Высокий приоритет", HIGH_ID);
  await expect(analysis(page).getByText("Локальные правила")).toBeVisible();
  await expect(analysis(page).getByText("Ошибка поставщика")).toBeVisible();
  await expect(page.getByText("Данные актуальны")).toBeVisible();
});

test("A8 открывает ITSM по шаблону и локальную карточку без него", async ({ page }) => {
  const linked = await openApp("rules", "https://itsm.example/incidents/{id}");
  await openDashboard(page, linked);
  const link = card(page, "У координаторов", "INC000000000003").getByRole("link", { name: "В ITSM" });
  await expect(link).toHaveAttribute("href", "https://itsm.example/incidents/INC000000000003");
  await expect(link).toHaveAttribute("target", "_blank");
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

  const local = await openApp();
  await openDashboard(page, local);
  await card(page, "У координаторов", "INC000000000003").getByRole("button", { name: "Детали" }).click();
  await expect(page.getByText("Ссылка ITSM не настроена")).toBeVisible();
  await expect(page.getByRole("link", { name: "В ITSM" })).toHaveCount(0);
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
  applyDemoStep(app.dataDir, "assign");
  await app.resume();
  await expect(page.getByText("Данные актуальны")).toBeVisible();
  await expect(card(page, "У координаторов", HIGH_ID)).toBeVisible();
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

test("A13 открывает шторки, футер, мобильные разделы и клавиатуру", async ({ page }) => {
  const app = await openApp();
  await openDashboard(page, app);

  const audience = page.getByRole("button", { name: "Частным лицам", exact: true });
  await audience.click();
  await expect(page.getByRole("heading", { name: "Частным лицам" })).toBeVisible();
  await expect(page.getByText("Демо", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(audience).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(audience).not.toBeFocused();

  const footer = page.locator("footer");
  await footer.getByRole("button", { name: "Связь и дом", exact: true }).click();
  await expect(footer.getByText("Домашний интернет")).toBeVisible();
  await expect(footer.getByText("Демо").first()).toBeVisible();
  await footer.getByRole("button", { name: "О проекте", exact: true }).click();
  const showcase = footer.getByRole("link", { name: "Публичная витрина" });
  await expect(showcase).toHaveAttribute("href", "https://rnd.mts.ru/personal");
  await expect(showcase).toHaveAttribute("target", "_blank");

  await page.setViewportSize({ width: 390, height: 844 });
  const sections = page.getByRole("button", { name: "Разделы", exact: true });
  await expect(sections).toBeVisible();
  await sections.click();
  await expect(page.getByRole("heading", { name: "Документы" })).toBeVisible();
  await expect(page.getByText("Условия использования")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sections).toBeFocused();
});

function analysis(page: Page): Locator {
  return page.getByRole("region", { name: "ИИ-анализ" });
}

async function closeDetails(page: Page): Promise<void> {
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть" }).click();
}

async function analyze(page: Page, groupName: string, id: string): Promise<void> {
  await card(page, groupName, id).getByRole("button", { name: "Детали" }).click();
  await page.getByRole("button", { name: "ИИ-анализ" }).click();
}
