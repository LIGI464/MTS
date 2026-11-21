import { COORDINATOR_TEAM, type RawIncidentFields } from "@mts/contracts";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { readLive, startDashboard, writeLive } from "./support/harness.js";

test("лента и звук реагируют на новый инцидент один раз, в том числе после восстановления связи", async ({ page }, testInfo) => {
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

  const app = await startDashboard();
  try {
    await page.goto(`${app.url}/admin/incidents`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Данные актуальны")).toBeVisible();
    const sound = page.getByRole("button", { name: "Звук оповещений" });
    await expect(sound).toHaveAttribute("aria-pressed", "false");
    await sound.click();
    await expect(sound).toHaveAttribute("aria-pressed", "true");
    const notes = () => page.evaluate(() => Reflect.get(window, "__testNotes") as number);
    expect(await notes()).toBe(0);

    const rows = JSON.parse(await readLive(app.dataDir)) as Array<Record<string, unknown>>;
    rows.push({
      ...rows[0],
      id: "INC001000000001",
      header: "Новый тестовый инцидент в витрине",
      priorityId: 3,
    });
    await writeLive(app.dataDir, JSON.stringify(rows));
    const trigger = page.getByRole("button", { name: "События, новых: 1" });
    await expect(trigger).toBeVisible();
    await expect.poll(notes).toBe(2);

    await app.halt();
    await expect(page.getByText("Переподключение")).toBeVisible();
    await app.resume();
    await expect(page.getByText("Данные актуальны")).toBeVisible();
    await expect(trigger).toBeVisible();
    await trigger.click();
    const feed = page.getByRole("dialog", { name: "События" });
    await expect(feed.getByRole("listitem").getByText("Новый инцидент", { exact: true })).toHaveCount(1);
    expect(await notes()).toBe(2);
    await page.screenshot({ path: testInfo.outputPath("dashboard-events.png") });

    await feed.getByRole("button", { name: "Новый тестовый инцидент в витрине" }).click();
    const dialog = page.getByRole("dialog", { name: "Новый тестовый инцидент в витрине" });
    await expect(dialog.getByText("INC001000000001", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(feed.getByRole("button", { name: "Новый тестовый инцидент в витрине" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "События", exact: true })).toBeFocused();

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
    await expect(page.getByRole("region", { name: "Сроки", exact: true }).getByText("Нет инцидентов")).toHaveCount(2);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await expect(summary).toBeInViewport();
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
    await expect(deadline("near").locator(sameId)).toHaveCount(1);
    await expect(deadline("overdue").locator(sameId)).toHaveCount(0);
    await expect(page.locator("#queue-high").locator(sameId)).toHaveCount(1);
    await expect(page.locator("#queue-coordinator").locator(`[data-incident-id=${JSON.stringify(research.id)}]`)).toHaveCount(1);
    await expect(page.locator("#queue-medium").locator(`[data-incident-id=${JSON.stringify(research.id)}]`)).toHaveCount(0);

    const nearButton = summary.getByRole("button", { name: /Срок близко/ });
    const overdueButton = summary.getByRole("button", { name: /Просрочены/ });
    await nearButton.focus();
    await page.keyboard.press("Enter");
    await expect(deadline("near")).toBeFocused();
    await expect(deadline("near").getByRole("heading")).toBeInViewport();
    await overdueButton.click();
    await expect(deadline("overdue")).toBeFocused();
    await expect(deadline("overdue").getByRole("heading")).toBeInViewport();

    const search = page.getByRole("searchbox", { name: "Поиск инцидентов" });
    await search.fill(String(overdue.id));
    await expect(nearButton).toHaveText("Срок близко1");
    await expect(deadline("near").getByText("Нет инцидентов")).toBeVisible();
    await expect(page.locator("#queue-count-note")).toBeVisible();
    await page.getByRole("button", { name: "Сбросить", exact: true }).click();
    await expect(deadline("near").locator(sameId)).toHaveCount(1);

    await page.clock.fastForward(300_000);
    await expect(nearButton).toHaveText("Срок близко0");
    await expect(overdueButton).toHaveText("Просрочены2");
    await expect(deadline("near").locator(sameId)).toHaveCount(0);
    await expect(deadline("overdue").locator(sameId)).toHaveCount(1);
    await expect(page.locator("#queue-high").locator(sameId)).toHaveCount(1);
    await overdueButton.click();
    await expect(deadline("overdue")).toBeFocused();
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
