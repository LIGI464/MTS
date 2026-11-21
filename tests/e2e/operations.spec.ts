import { expect, test } from "@playwright/test";
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
    await expect(dialog.getByText("INC001000000001")).toBeVisible();
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

test("показатели сводки фильтруют очереди и возвращают полный список", async ({ page }) => {
  await page.goto("/admin/incidents");
  const summary = page.getByRole("group", { name: "Сводка инцидентов" });
  const high = page.getByRole("region", { name: "Высокий приоритет", exact: true });
  await expect(high.locator("article")).toHaveCount(5);
  const picker = summary.getByRole("button", { name: /Критические/ });
  await picker.click();
  await expect(picker).toHaveAttribute("aria-pressed", "true");
  await expect(high.getByText("Нет инцидентов")).toBeVisible();
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await expect(high.locator("article")).toHaveCount(5);
});
