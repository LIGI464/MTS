import { API_PREFIX, COORDINATOR_TEAM, PriorityFeedSchema, type RawIncidentFields } from "@mts/contracts";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { openService, OPERATOR_TOKEN, returnToBoard, startDashboard, writeLive } from "./support/harness.js";

const priorityPath = `${API_PREFIX}/incidents/priorities`;
const feed = (page: Page) => page.getByRole("region", { name: "В работу сейчас" });
const recommendation = (page: Page, id: string) => feed(page).getByRole("button").filter({ hasText: id });

async function seed() {
  const [example] = JSON.parse(await readFile("data/demo/character_problems.json", "utf8")) as RawIncidentFields[];
  const now = Date.now();
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  const base = { ...example, submitDate: at(-150), deadline: null, impactId: null, urgencyId: null };
  return [
    { ...base, id: "INC-PR-C", header: "Недоступны заказы", priorityId: 4 },
    { ...base, id: "INC-PR-G", header: "Передан группе координаторов", priorityId: 2, assignedGroupName: COORDINATOR_TEAM },
    { ...base, id: "INC-PR-N", header: "Задержка уведомления", priorityId: 2, deadline: at(15) },
    { ...base, id: "INC-PR-O", header: "Сбой выгрузки", priorityId: 2, deadline: at(-15) },
    { ...base, id: "INC-PR-H", header: "Проверка очереди заказов", priorityId: 3 },
    { ...base, id: "INC-PR-M", header: "Проверка отправки чеков", priorityId: 2, impactId: 4 },
    { ...base, id: "INC-PR-L", header: "Ошибка в каталоге", priorityId: 1,
      shortDescription: "Пользователи не могут найти товар и завершить покупку." },
  ];
}

test("P30 показывает серверный порядок, открывает точные детали всех типов и возвращает фокус", async ({ page }) => {
  const incidents = await seed();
  const app = await startDashboard("rules", "", { incidents });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(app.url + "/");
    await expect(feed(page).getByText("Локальные правила")).toBeVisible();
    const response = await page.request.post(app.url + priorityPath);
    const { recommendations } = PriorityFeedSchema.parse(await response.json());
    const ordered = feed(page).getByRole("button");
    await expect(ordered).toHaveCount(7);
    expect(new Set(recommendations.map(({ target }) => target))).toEqual(
      new Set(["critical", "coordinator", "near", "overdue", "high", "medium", "low"]),
    );
    for (const [index, entry] of recommendations.entries()) {
      await expect(ordered.nth(index)).toContainText(entry.incidentId);
      await expect(ordered.nth(index)).toContainText(entry.reason);
    }

    const list = feed(page).getByRole("list");
    const cardsInView = () => list.evaluate((element) => {
      const { left, right } = element.getBoundingClientRect();
      return [...element.children].filter((child) => {
        const box = child.getBoundingClientRect();
        return box.left >= left - 1 && box.right <= right + 1;
      }).length;
    });
    await expect.poll(cardsInView).toBe(4);
    const search = page.getByRole("searchbox");
    await search.fill("Фильтр, не совпадающий с заявками");
    for (const [index, entry] of recommendations.entries()) {
      const button = recommendation(page, entry.incidentId);
      if (index % 2 === 0) {
        await button.focus();
        await page.keyboard.press("Enter");
      } else {
        await button.click();
      }
      const target = page.locator(`#queue-${entry.target} [data-incident-id="${entry.incidentId}"]`);
      const details = page.getByRole("dialog", { name: entry.title });
      await expect(details.getByText(entry.incidentId, { exact: true })).toBeVisible();
      const reason = details.getByRole("region", { name: "Обоснование рекомендации" });
      await expect(reason).toContainText(`${entry.rank} в ленте`);
      await expect(reason).toContainText(entry.reason);
      await expect(target).toBeInViewport();
      if (entry.target === "near" || entry.target === "overdue") {
        await expect(page.locator(`#queue-${entry.target} [data-sla-toggle]`)).toHaveAttribute("aria-expanded", "true");
        const other = entry.target === "near" ? "overdue" : "near";
        await expect(page.locator(`#queue-${other} [data-sla-toggle]`)).toHaveAttribute("aria-expanded", "false");
      }
      await page.keyboard.press("Escape");
      await expect(button).toBeFocused();
      await expect(search).toHaveValue("Фильтр, не совпадающий с заявками");
    }

    await page.goto(app.url + "/admin/incidents");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(feed(page).getByRole("button")).toHaveCount(7);
    await feed(page).getByRole("button").nth(0).focus();
    await page.keyboard.press("Tab");
    await expect(feed(page).getByRole("button").nth(1)).toBeFocused();
    await expect.poll(() => list.evaluate((element) => element.scrollWidth > element.clientWidth && element.scrollLeft > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(feed(page).getByRole("button").nth(1)).toBeFocused();
  } finally {
    await app.stop();
  }
});

test("P30 убирает устаревшую позицию при обновлении снимка и сохраняет пригодные карточки", async ({ page }) => {
  const incidents = await seed();
  const app = await startDashboard("rules", "", { incidents });
  const release = Promise.withResolvers<void>();
  try {
    await page.goto(app.url + "/admin/incidents");
    const deleted = incidents[0]!;
    const changed = incidents[4]!;
    const added = { ...deleted, id: "INC-PR-FRESH", header: "Недоступны кассы", impactId: 4,
      shortDescription: "Все операторы не могут завершить оплату в кассах." };
    await expect(recommendation(page, deleted.id)).toBeVisible();
    const requestStarted = Promise.withResolvers<void>();
    await page.route(`**${priorityPath}`, async (route) => {
      requestStarted.resolve();
      await release.promise;
      await route.continue();
    });
    const updated = incidents.slice(1).map((incident) =>
      incident.id === changed.id ? { ...incident, header: "Новая версия проверки заказов" } : incident);
    await writeLive(app.dataDir, JSON.stringify([...updated, added]));
    await requestStarted.promise;
    await expect(recommendation(page, deleted.id)).toHaveCount(0);
    await expect(recommendation(page, changed.id)).toHaveCount(0);
    await expect(recommendation(page, incidents[1]!.id)).toBeVisible();
    await expect(feed(page).getByRole("status")).toHaveText("Обновляем рекомендации…");
    release.resolve();
    await expect(recommendation(page, changed.id)).toContainText("Новая версия проверки заказов");
    await expect(feed(page).getByRole("button").first()).toContainText(added.id);
    await expect(recommendation(page, added.id)).toBeInViewport({ ratio: .95 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".toasts")).toHaveCount(0);
  } finally {
    release.resolve();
    await app.stop();
  }
});

test("P30 показывает пустую ленту и резервный расчёт при сбое провайдера", async ({ page }) => {
  const empty = await startDashboard("rules", "", { incidents: [] });
  try {
    await page.goto(empty.url + "/admin/incidents");
    await expect(feed(page).getByText("Нет заявок, требующих действий сейчас")).toBeVisible();
  } finally {
    await empty.stop();
  }

  const app = await startDashboard("live-fail", "", { incidents: await seed() });
  try {
    await page.goto(app.url + "/admin/incidents");
    await expect(feed(page).getByText("Локальные правила")).toBeVisible();
    await (await openService(page)).getByLabel("Токен оператора").fill(OPERATOR_TOKEN);
    await returnToBoard(page);
    await expect(feed(page).getByText("Расчёт ИИ временно недоступен.")).toBeVisible();
    await expect(feed(page).getByRole("button")).toHaveCount(7);
  } finally {
    await app.stop();
  }
});

test("P30 рассчитывает ленту на синтетических данных dev:web", async ({ page }) => {
  await page.goto("/admin/incidents");
  await expect(page.getByText("Демонстрационные данные")).toBeVisible();
  await expect(feed(page).getByText("Локальные правила")).toBeVisible();
  const first = feed(page).getByRole("button").first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.getByRole("region", { name: "Обоснование рекомендации" })).toBeVisible();
});
