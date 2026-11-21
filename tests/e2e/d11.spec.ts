import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startDashboard, type RunningApp } from "./support/harness.js";

const GROUPS = ["Критические", "У координаторов", "Высокий приоритет", "Исследование"] as const;
const LOCAL_ID = "INC000000000003";
const SHOTS = join("D:\\MTS", "d11-screenshots");

test.afterEach(async () => {
  await stopCurrent();
});

let current: RunningApp | undefined;

async function openApp(): Promise<RunningApp> {
  await stopCurrent();
  current = await startDashboard();
  return current;
}

async function stopCurrent(): Promise<void> {
  const app = current;
  current = undefined;
  await app?.stop();
}

async function openDashboard(page: Page, app: RunningApp): Promise<void> {
  await page.goto(`${app.url}/admin/incidents`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Пульт координатора" })).toBeVisible();
}

test("D11 показывает пульт, меню и общий адрес ITSM", async ({ page }) => {
  const app = await openApp();
  await mkdir(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDashboard(page, app);

  await expect(page.getByRole("link", { name: "Пульт", exact: true }).first()).toHaveAttribute("href", "/admin/incidents");
  await expect(page.getByRole("link", { name: "Реестр ITSM" }).first()).toHaveAttribute("href", "/itsm/incidents");
  await expect(page.getByRole("link", { name: "Разработчикам" }).first()).toHaveAttribute("href", "/dev");

  for (const name of GROUPS) {
    const region = page.getByRole("region", { name, exact: true });
    await expect(region.getByRole("heading", { name, exact: true })).toBeInViewport();
    if (name === "Критические") {
      await expect(region.getByText("Нет инцидентов")).toBeInViewport();
    } else {
      await expect(region.locator("article").first()).toBeInViewport();
    }
  }
  await page.screenshot({ path: join(SHOTS, "pult-1440x900.png") });

  const card = page.getByRole("region", { name: "У координаторов", exact: true }).locator("article").filter({ hasText: LOCAL_ID });
  const href = "/itsm/incidents/INC000000000003";
  await expect(card.getByRole("link", { name: "В ITSM" })).toHaveAttribute("href", href);
  await expect(card.getByRole("button", { name: "Детали" })).toBeVisible();
  await card.getByRole("button", { name: "Детали" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("link", { name: "В ITSM" })).toHaveAttribute("href", href);
  const launch = dialog.getByRole("button", { name: "ИИ-анализ" });
  await expect(launch).toHaveCSS("background-color", "rgb(224, 0, 44)");
  await expect(launch).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  const menu = page.getByRole("button", { name: "Частным лицам", exact: true });
  await menu.click();
  await expect(page.getByRole("heading", { name: "Частным лицам" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Реестр ITSM" }).first()).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "menu-1440x900.png") });
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();

  for (const size of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    for (const name of GROUPS) {
      const heading = page.getByRole("region", { name, exact: true }).getByRole("heading", { name, exact: true });
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeVisible();
    }
  }
});
