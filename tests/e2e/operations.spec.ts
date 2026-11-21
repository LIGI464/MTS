import { API_PREFIX, COORDINATOR_TEAM, type RawIncidentFields } from "@mts/contracts";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { OPERATOR_TOKEN, readLive, startDashboard, writeLive } from "./support/harness.js";

async function mockAudio(page: Page) {
  await page.addInitScript(() => {
    Reflect.set(window, "__testNotes", 0);
    class AudioStub {
      currentTime = 0;
      destination = {};
      state = "suspended";
      async resume() { this.state = "running"; }
      async suspend() { this.state = "suspended"; }
      async close() { this.state = "closed"; }
      createOscillator() {
        return {
          frequency: {},
          connect: (target: unknown) => target,
          disconnect() {},
          stop() {},
          start() { Reflect.set(window, "__testNotes", Number(Reflect.get(window, "__testNotes")) + 1); },
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
          disconnect() {},
        };
      }
    }
    Reflect.set(window, "AudioContext", AudioStub);
  });
  // A chime consists of the two oscillators used by the application.
  return async () => (await page.evaluate(() => Reflect.get(window, "__testNotes") as number)) / 2;
}

async function inspectAndClose(page: Page, card: Locator) {
  const details = card.getByRole("button", { name: "Подробнее", exact: true });
  await details.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toBeFocused();
}

test("D30 публикует тихие приоритеты один раз и сохраняет точки после переподключения", async ({ page }, testInfo) => {
  const chimes = await mockAudio(page);
  const app = await startDashboard();
  try {
    await page.goto(`${app.url}/admin/incidents`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Данные актуальны")).toBeVisible();
    const sound = page.getByRole("button", { name: "Звук оповещений" });
    await expect(sound).toHaveAttribute("aria-pressed", "false");
    await sound.click();
    await expect(sound).toHaveAttribute("aria-pressed", "true");
    expect(await chimes()).toBe(0);

    const rows = JSON.parse(await readLive(app.dataDir)) as Array<Record<string, unknown>>;
    const incident = {
      ...rows[0],
      id: "INC001000000001",
      header: "Новый тестовый инцидент в витрине",
      priorityId: 3,
      submitDate: new Date(Date.now() - 2 * 3600_000).toISOString(),
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    rows.push(
      incident,
      { ...incident, id: "INC-Q-MEDIUM", header: "Тихий средний", priorityId: 2, deadline: null },
      { ...incident, id: "INC-Q-LOW", header: "Тихий низкий", priorityId: 1, deadline: null },
    );
    await writeLive(app.dataDir, JSON.stringify(rows));
    const trigger = page.getByRole("button", { name: "События, новых: 3" });
    await expect(trigger).toBeVisible();
    const summary = page.locator("[data-category]");
    for (const category of ["high", "medium", "low", "near"]) {
      await expect(page.locator(`[data-category="${category}"]`)).toHaveAttribute("data-unread", "true");
    }
    await expect(summary.filter({ hasText: "У координаторов" })).not.toHaveAttribute("data-unread", "true");
    expect(await chimes()).toBe(0);

    await app.halt();
    await expect(page.getByText("Переподключение")).toBeVisible();
    await app.resume();
    await expect(page.getByText("Данные актуальны")).toBeVisible();
    await expect(trigger).toBeVisible();
    await trigger.click();
    const feed = page.getByRole("dialog", { name: "События" });
    await expect(feed.getByRole("listitem").getByText("Новый инцидент", { exact: true })).toHaveCount(3);
    await expect(page.locator('[data-category="high"]')).toHaveAttribute("data-unread", "true");
    expect(await chimes()).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("dashboard-events.png") });

    await feed.getByRole("button", { name: "Новый тестовый инцидент в витрине" }).click();
    const dialog = page.getByRole("dialog", { name: "Новый тестовый инцидент в витрине" });
    await expect(dialog.getByText("INC001000000001", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(feed.getByRole("button", { name: "Новый тестовый инцидент в витрине" })).toBeFocused();
    await expect(page.locator('[data-category="high"]')).not.toHaveAttribute("data-unread", "true");
    await expect(page.locator('[data-category="near"]')).not.toHaveAttribute("data-unread", "true");
    await expect(page.locator('[data-category="low"]')).toHaveAttribute("data-unread", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "События", exact: true })).toBeFocused();

    const medium = page.locator('[data-category="medium"]');
    await medium.click();
    const quietCard = page.locator('#queue-medium [data-incident-id="INC-Q-MEDIUM"]');
    await expect(quietCard.locator("[data-card-title]")).toBeFocused();
    await expect(medium).toHaveAttribute("data-unread", "true");
    await expect(quietCard).toHaveAttribute("data-selected", "true");
    await inspectAndClose(page, quietCard);
    await expect(medium).not.toHaveAttribute("data-unread", "true");
    await expect(quietCard).not.toHaveAttribute("data-selected", "true");
    expect(await chimes()).toBe(0);

    await sound.click();
    await expect(sound).toHaveAttribute("aria-pressed", "false");
  } finally {
    await app.stop();
  }
});

test("D20 показывает пустую сводку, два ряда и обе секции сроков", async ({ page }) => {
  const app = await startDashboard("rules", "", { incidents: [] });
  try {
    await page.goto(`${app.url}/admin/incidents`);
    await expect(page.getByText("Данные актуальны")).toBeVisible();
    const summary = page.getByRole("group", { name: "Сводка инцидентов" });
    await expect(summary.getByRole("button")).toHaveText([
      "Критические0", "У координаторов0", "Срок близко0", "Просрочены0",
      "Высокий приоритет0", "Средний приоритет0", "Низкий приоритет0",
    ]);
    const strip = await summary.locator("[aria-controls='queue-near']").evaluate((button) => {
      const panel = button.parentElement!;
      return {
        border: getComputedStyle(panel).borderTopWidth,
        dividers: Array.from(panel.children).filter((item) => getComputedStyle(item, "::before").transform !== "none").length,
      };
    });
    expect(strip).toEqual({ border: "1px", dividers: 4 });

    const ids = ["critical", "coordinator", "deadlines", "high", "medium", "low"];
    const groups = page.locator(ids.map((id) => `#queue-${id}`).join(", "));
    const deadlines = page.getByRole("region", { name: "Сроки", exact: true });
    await expect(deadlines.locator('button[aria-expanded="false"]')).toHaveCount(2);
    const toggle = deadlines.getByRole("button", { name: /Срок близко/ });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(deadlines.getByText("Нет инцидентов")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(deadlines.getByText("Нет инцидентов")).toHaveCount(0);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await expect(summary).toBeInViewport();
      const segments = summary.locator("[data-category]");
      for (const index of [2, 3, 4, 5, 6]) {
        const segment = segments.nth(index);
        await segment.hover();
        const outlines = await segments.evaluateAll((buttons) => buttons.map((button) => {
          const style = getComputedStyle(button, "::after");
          return [style.content, style.borderColor, style.borderWidth, style.transform, style.pointerEvents];
        }));
        expect(outlines.filter(([content]) => content !== "none")).toHaveLength(1);
        expect(outlines[index]).toEqual(['""', "rgb(255, 0, 50)", "1px", "matrix(1, 0, -0.267949, 1, 0, 0)", "none"]);
      }
      await page.getByRole("heading", { name: "Goida-board" }).hover();
      expect(await segments.evaluateAll((buttons) => buttons.every((button) =>
        getComputedStyle(button, "::after").content === "none"))).toBe(true);
      const layout = await groups.evaluateAll((items) => items.map((item) => {
        const { x, y } = item.getBoundingClientRect();
        return { id: item.id, x, y };
      }));
      expect(layout.map(({ id }) => id)).toEqual(ids.map((id) => `queue-${id}`));
      if (viewport.width >= 1280) {
        expect(layout.slice(0, 3).map(({ y }) => y)).toEqual(Array(3).fill(layout[0].y));
        expect(layout.slice(3).map(({ x }) => x)).toEqual(layout.slice(0, 3).map(({ x }) => x));
        expect(layout.slice(3).map(({ y }) => y)).toEqual(Array(3).fill(layout[3].y));
        expect(layout[3].y).toBeGreaterThan(layout[0].y);
      } else {
        expect(new Set(layout.map(({ x }) => x)).size).toBe(1);
        expect(layout.map(({ y }) => y)).toEqual(layout.map(({ y }) => y).toSorted((a, b) => a - b));
      }
    }
  } finally {
    await app.stop();
  }
});

test("D20 ведёт к точной секции SLA и пересчитывает её отдельно от приоритета", async ({ page }) => {
  const demo: RawIncidentFields[] = JSON.parse(await readFile("data/demo/character_problems.json", "utf8"));
  const now = Date.now();
  const near = { ...demo[0], assignedGroupName: COORDINATOR_TEAM, deadline: new Date(now + 240_000).toISOString() };
  const overdue = { ...demo[1], deadline: new Date(now - 240_000).toISOString() };
  const research = demo.find(({ stateEnum }) => stateEnum === "Research")!;
  const app = await startDashboard("rules", "", { incidents: [near, overdue, research] });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install({ time: now });
    await page.goto(`${app.url}/admin/incidents`);
    const summary = page.getByRole("group", { name: "Сводка инцидентов" });
    const deadline = (kind: "near" | "overdue") => page.locator(`#queue-${kind}`);
    const sameId = `[data-incident-id=${JSON.stringify(near.id)}]`;
    const toggle = (kind: "near" | "overdue") => deadline(kind).locator("[data-sla-toggle]");
    await expect(toggle("near")).toHaveAttribute("aria-expanded", "false");
    await expect(toggle("overdue")).toHaveAttribute("aria-expanded", "false");
    await expect(deadline("near").locator(sameId)).toHaveCount(0);
    await expect(deadline("overdue").locator(sameId)).toHaveCount(0);
    await expect(page.locator("#queue-high").locator(sameId)).toHaveCount(1);
    await expect(page.locator("#queue-coordinator").locator(`[data-incident-id=${JSON.stringify(research.id)}]`)).toHaveCount(1);
    await expect(page.locator("#queue-medium").locator(`[data-incident-id=${JSON.stringify(research.id)}]`)).toHaveCount(0);

    const nearButton = summary.getByRole("button", { name: /Срок близко/ });
    await summary.locator('[data-category="coordinator"]').focus();
    await page.keyboard.press("Tab");
    await expect(nearButton).toBeFocused();
    expect(await nearButton.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
    const overdueButton = summary.getByRole("button", { name: /Просрочены/ });
    await page.keyboard.press("Enter");
    await expect(deadline("near").locator(sameId).locator("[data-card-title]")).toBeFocused();
    await expect(deadline("near").locator(sameId)).toHaveAttribute("data-selected", "true");
    await expect(page.locator("#queue-high").locator(sameId)).not.toHaveAttribute("data-selected", "true");
    const description = "Статусы новых заказов обновляются с задержкой.";
    await expect(deadline("near").locator(sameId).getByText(description)).toBeVisible();
    await expect(page.locator("#queue-high").locator(sameId).getByText(description)).toBeVisible();
    await expect(toggle("overdue")).toHaveAttribute("aria-expanded", "false");
    await overdueButton.click();
    await expect(deadline("overdue").locator("[data-card-title]")).toBeFocused();
    await expect(toggle("near")).toHaveAttribute("aria-expanded", "false");

    const search = page.getByRole("searchbox", { name: "Поиск инцидентов" });
    await search.fill(String(overdue.id));
    await expect(nearButton).toHaveText("Срок близко1");
    await expect(page.locator("#queue-count-note")).toBeVisible();
    await nearButton.click();
    await expect(deadline("near").locator(sameId).locator("[data-card-title]")).toBeFocused();
    await expect(search).toHaveValue(String(overdue.id));
    await page.getByRole("button", { name: "Сбросить", exact: true }).click();
    await expect(deadline("near").locator(sameId)).toHaveAttribute("data-selected", "true");

    await page.clock.fastForward(300_000);
    await expect(nearButton).toHaveText("Срок близко0");
    await expect(overdueButton).toHaveText("Просрочены2");
    await expect(deadline("near").locator(sameId)).toHaveCount(0);
    await expect(page.locator("#queue-high").locator(sameId)).toHaveCount(1);
    await overdueButton.click();
    const overdueCard = deadline("overdue").locator(sameId);
    await expect(overdueCard.locator("[data-card-title]")).toBeFocused();
    await expect(overdueCard).toHaveAttribute("data-selected", "true");
    await expect(overdueButton).toHaveAttribute("data-unread", "true");
    await inspectAndClose(page, overdueCard);
    await expect(overdueButton).not.toHaveAttribute("data-unread", "true");
  } finally {
    await app.stop();
  }
});

test("P20 группирует звук, сохраняет точную подсветку и подтверждает просмотр при открытии деталей", async ({ page }) => {
  const chimes = await mockAudio(page);
  const demo: RawIncidentFields[] = JSON.parse(await readFile("data/demo/character_problems.json", "utf8"));
  const timestamp = Date.now();
  const base = { ...demo[0], assignedEmployee: null, priorityId: 4 };
  const rows = [1, 2, 3].map((index) => ({
    ...base, id: `INC-SYN-10${index}`, header: `Прежний критический ${index}`,
    submitDate: new Date(timestamp - index * 3600_000).toISOString(), deadline: null,
  }));
  const next = {
    ...base, id: "INC-SYN-104", header: "Новый критический у координаторов",
    assignedGroupName: COORDINATOR_TEAM, assignedEmployee: "Ирина Волкова",
    submitDate: new Date(timestamp - 3600_000).toISOString(),
    deadline: new Date(timestamp + 4 * 60_000).toISOString(),
  };
  const second = { ...base, id: "INC-SYN-105", header: "Второй новый критический", deadline: null };
  const app = await startDashboard("rules", "", { incidents: rows });
  try {
    await page.goto(`${app.url}/admin/incidents`);
    const critical = page.locator('[data-category="critical"]');
    const coordinator = page.locator('[data-category="coordinator"]');
    const near = page.locator('[data-category="near"]');
    const criticalCard = (id: string) => page.locator(`#queue-critical [data-incident-id="${id}"]`);
    const sound = page.getByRole("button", { name: "Звук оповещений" });
    await expect(critical.locator("strong")).toHaveText("3");
    await expect(critical).not.toHaveAttribute("data-unread", "true");
    await expect(critical).toHaveCSS("border-top-color", "rgb(255, 0, 50)");
    await sound.click();
    expect(await chimes()).toBe(0);

    await writeLive(app.dataDir, JSON.stringify([...rows, next]));
    await expect(critical.locator("strong")).toHaveText("4");
    await expect(critical).toHaveAttribute("data-unread", "true");
    await expect(coordinator).toHaveAttribute("data-unread", "true");
    await expect(near).toHaveAttribute("data-unread", "true");
    await expect.poll(chimes).toBe(1);
    const firstLabel = criticalCard(next.id).getByText("Новый", { exact: true });
    await expect(firstLabel).toBeVisible();
    const markerAnimation = () => firstLabel.evaluate((label) =>
      getComputedStyle(label.parentElement!, "::before").animationName);
    expect(await markerAnimation()).not.toBe("none");

    await app.halt();
    await expect(page.getByText("Переподключение", { exact: true })).toBeVisible();
    await app.resume();
    await expect(page.getByText("Данные актуальны", { exact: true })).toBeVisible();
    await expect(critical).toHaveAttribute("data-unread", "true");
    expect(await chimes()).toBe(1);

    await page.getByRole("button", { name: /^События/ }).click();
    const journal = page.getByRole("dialog", { name: "События" });
    await expect(journal.getByRole("listitem").getByText("Новый критический инцидент", { exact: true })).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(critical).toHaveAttribute("data-unread", "true");

    await writeLive(app.dataDir, JSON.stringify([...rows, next, second]));
    await expect(critical.locator("strong")).toHaveText("5");
    await expect.poll(chimes).toBe(2);
    const search = page.getByRole("searchbox", { name: "Поиск инцидентов" });
    await search.fill("Прежний");
    await expect(criticalCard(second.id)).toHaveCount(0);
    await critical.focus();
    await page.keyboard.press("Enter");
    const target = criticalCard(second.id);
    await expect(target.locator("[data-card-title]")).toBeFocused();
    await expect(target).toHaveAttribute("data-selected", "true");
    await expect(criticalCard(next.id)).toHaveCount(0);
    await expect(critical).toHaveAccessibleName(/непросмотрено 2/);
    await expect(critical.locator("strong")).toHaveText("5");
    await expect(search).toHaveValue("Прежний");
    await page.waitForTimeout(1100);
    await expect(target).toHaveAttribute("data-selected", "true");
    await inspectAndClose(page, target);
    await expect(target).not.toHaveAttribute("data-selected", "true");
    await expect(critical).toHaveAccessibleName(/непросмотрено 1/);

    await page.getByRole("button", { name: "Сбросить", exact: true }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await markerAnimation()).toBe("none");
    await near.click();
    const slaCard = page.locator(`#queue-near [data-incident-id="${next.id}"]`);
    await expect(slaCard.locator("[data-card-title]")).toBeFocused();
    await expect(slaCard).toHaveAttribute("data-selected", "true");
    await expect(critical).toHaveAttribute("data-unread", "true");
    await inspectAndClose(page, slaCard);
    await expect(critical).not.toHaveAttribute("data-unread", "true");
    await expect(critical).toHaveCSS("border-top-color", "rgb(255, 0, 50)");
    await expect(coordinator).not.toHaveAttribute("data-unread", "true");
    await expect(firstLabel).toHaveCount(0);
    expect(await chimes()).toBe(2);

    await sound.click();
    await expect(sound).toHaveAttribute("aria-pressed", "false");
    const changed = { ...next, assignedEmployee: "Анна Кузнецова" };
    await writeLive(app.dataDir, JSON.stringify([...rows, changed, second]));
    await expect(coordinator).toHaveAttribute("data-unread", "true");
    await sound.click();
    await expect(sound).toHaveAttribute("aria-pressed", "true");
    expect(await chimes()).toBe(2);
    const latest = [...rows, { ...changed, assignedEmployee: "Ольга Иванова" }, second];
    await writeLive(app.dataDir, JSON.stringify(latest));
    await expect.poll(chimes).toBe(3);
    await expect(coordinator).toHaveAccessibleName(/непросмотрено 2/);
    await coordinator.click();
    const nextCoordinator = page.locator(`#queue-coordinator [data-incident-id="${next.id}"]`);
    await expect(nextCoordinator.locator("[data-card-title]")).toBeFocused();
    await expect(nextCoordinator).toHaveAttribute("data-selected", "true");
    await expect(coordinator).toHaveAccessibleName(/непросмотрено 2/);
    await inspectAndClose(page, nextCoordinator);
    await expect(coordinator).toHaveAccessibleName(/непросмотрено 1/);
    expect(await chimes()).toBe(3);

    const reduced = { ...second, id: "INC-SYN-106", header: "Критический с сокращённым движением" };
    await writeLive(app.dataDir, JSON.stringify([...latest, reduced]));
    await expect.poll(chimes).toBe(4);
    await expect(critical).toHaveCSS("animation-name", "none");
    await critical.click();
    const staticCard = criticalCard(reduced.id);
    await expect(staticCard).toHaveAttribute("data-selected", "true");
    await expect(staticCard).toHaveCSS("animation-name", "none");
    await expect(staticCard).toHaveCSS("border-top-color", "rgb(255, 0, 50)");
    await writeLive(app.dataDir, JSON.stringify([...latest, { ...reduced, stateEnum: "Resolved",
      completionDate: new Date().toISOString() }]));
    await expect(critical.locator("strong")).toHaveText("5");
    await page.getByRole("button", { name: /^События/ }).click();
    await expect(journal.getByRole("listitem").getByText("Критический инцидент решён", { exact: true })).toHaveCount(1);
    await page.keyboard.press("Escape");
    expect(await chimes()).toBe(4);

    const reset = await page.request.post(`${app.url}${API_PREFIX}/demo/reset`, {
      data: {}, headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
    });
    expect(reset.ok()).toBe(true);
    await expect(critical.locator("strong")).toHaveText("3");
    await expect(page.locator('[data-category][data-unread="true"]')).toHaveCount(0);
    await expect(page.locator('[data-incident-id][data-selected="true"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "События, новых: 1" })).toBeVisible();
    expect(await chimes()).toBe(4);
  } finally {
    await app.stop();
  }
});

test("D40 проверяет переходы всех тихих сегментов и устаревшую цель SLA", async ({ page }) => {
  const chimes = await mockAudio(page);
  const [demo]: RawIncidentFields[] = JSON.parse(await readFile("data/demo/character_problems.json", "utf8"));
  const now = Date.now();
  const time = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  const base = { ...demo, assignedEmployee: null, submitDate: time(-240), deadline: null, priorityId: 3 };
  const first = { ...base, id: "INC-D40-SLA-01", header: "Контроль срока 1", deadline: time(35) };
  const second = { ...base, id: "INC-D40-SLA-02", header: "Контроль срока 2", deadline: time(36) };
  const priorityCases = [
    { category: "high", id: "INC-D40-HIGH", priority: 3 },
    { category: "medium", id: "INC-D40-MEDIUM", priority: 2 },
    { category: "low", id: "INC-D40-LOW", priority: 1 },
  ];
  const added = priorityCases.map(({ id, priority }) => ({
    ...base, id, header: id, priorityId: priority, deadline: priority === 2 ? time(15) : null,
  }));
  const app = await startDashboard("rules", "", { incidents: [first, second] });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install({ time: now });
    await page.goto(`${app.url}/admin/incidents`);
    const metric = (category: string) => page.locator(`[data-category="${category}"]`);
    const title = (category: string, id: string) =>
      page.locator(`#queue-${category} [data-incident-id="${id}"] [data-card-title]`);
    const unread = (category: string) => expect(metric(category)).toHaveAttribute("data-unread", "true");
    const viewed = (category: string) => expect(metric(category)).not.toHaveAttribute("data-unread", "true");
    const sound = page.getByRole("button", { name: "Звук оповещений" });
    await expect(page.getByText("Данные актуальны", { exact: true })).toBeVisible();
    await sound.click();
    await expect(sound).toHaveAttribute("aria-pressed", "true");

    await writeLive(app.dataDir, JSON.stringify([first, second, ...added]));
    await unread("near");
    await expect(title("near", added[1].id)).toHaveCount(0);
    const card = (category: string, id: string) => title(category, id).locator("..").locator("..");
    for (const { category, id } of priorityCases) {
      await unread(category);
      await metric(category).click();
      await expect(title(category, id)).toBeFocused();
      await expect(card(category, id)).toHaveAttribute("data-selected", "true");
      await unread(category);
    }
    await inspectAndClose(page, card("medium", added[1].id));
    await viewed("medium");
    await viewed("near");
    await expect(card("low", added[2].id)).toHaveAttribute("data-selected", "true");

    await page.clock.fastForward(7 * 60_000);
    await unread("near");
    await expect(metric("near").locator("strong")).toHaveText("3");
    await metric("near").focus();
    await page.keyboard.press("Enter");
    await expect(title("near", second.id)).toBeFocused();
    await unread("near");
    await expect(title("high", second.id)).toHaveCount(1);

    await page.clock.fastForward(30 * 60_000);
    await expect(metric("near").locator("strong")).toHaveText("0");
    await viewed("near");
    await unread("overdue");
    await metric("near").click();
    await expect(page.locator("#queue-near [data-sla-toggle]")).toBeFocused();
    await unread("overdue");
    await expect(title("near", second.id)).toHaveCount(0);
    await expect(title("overdue", second.id)).toHaveCount(0);

    await metric("overdue").click();
    await expect(title("overdue", second.id)).toBeFocused();
    await expect(card("overdue", second.id)).toHaveAttribute("data-selected", "true");
    await inspectAndClose(page, card("overdue", second.id));
    await unread("overdue");
    await metric("overdue").click();
    await expect(title("overdue", first.id)).toBeFocused();
    await expect(card("overdue", first.id)).toHaveAttribute("data-selected", "true");
    await inspectAndClose(page, card("overdue", first.id));
    await unread("overdue");
    await metric("overdue").click();
    await expect(title("overdue", added[1].id)).toBeFocused();
    await expect(card("overdue", added[1].id)).toHaveAttribute("data-selected", "true");
    await inspectAndClose(page, card("overdue", added[1].id));
    await viewed("overdue");
    expect(await chimes()).toBe(0);
  } finally {
    await app.stop();
  }
});

test("события можно закрепить, отфильтровать и открепить после перезагрузки", async ({ page }) => {
  const app = await startDashboard();
  try {
    await page.goto(`${app.url}/admin/incidents`);
    await expect(page.getByText("Данные актуальны")).toBeVisible();

    const records = JSON.parse(await readLive(app.dataDir)) as Array<Record<string, unknown>>;
    records.push({ ...records[0], id: "INC001000000002", header: "Новый инцидент для закрепления" });
    records[0] = { ...records[0], priorityId: 4 };
    await writeLive(app.dataDir, JSON.stringify(records));

    const trigger = page.getByRole("button", { name: /^События/ });
    const feed = page.getByRole("dialog", { name: "События" });
    const filter = feed.getByRole("combobox", { name: "Тип события" });
    await trigger.click();
    await feed.getByRole("button", { name: "Закрепить событие «Новый инцидент»", exact: true }).click();
    await feed.getByRole("button", { name: "Закрепить событие «Новый критический инцидент»", exact: true }).click();
    await filter.selectOption({ label: "Закрепленные" });
    await expect(feed.getByRole("listitem")).toHaveCount(2);

    await page.reload();
    await trigger.click();
    await expect(feed.getByRole("listitem")).toHaveCount(2);
    await filter.selectOption({ label: "Закрепленные" });
    await expect(feed.getByRole("listitem")).toHaveCount(2);
    await expect(feed.getByText("Новый инцидент для закрепления")).toBeVisible();

    await feed.getByRole("button", { name: "Открепить событие «Новый инцидент»", exact: true }).click();
    await expect(feed.getByRole("listitem")).toHaveCount(1);
    await expect(filter).toBeFocused();
    await filter.selectOption("critical.new");
    await expect(feed.getByRole("listitem")).toHaveCount(1);
    await feed.getByRole("button", { name: "Открепить событие «Новый критический инцидент»", exact: true }).click();
    await expect(feed.getByRole("button", { name: "Закрепить событие «Новый критический инцидент»", exact: true })).toBeVisible();
    await filter.selectOption({ label: "Закрепленные" });
    await expect(feed.getByText("Нет закрепленных событий")).toBeVisible();
  } finally {
    await app.stop();
  }
});
