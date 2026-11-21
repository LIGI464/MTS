import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startDashboard, type RunningApp } from "./support/harness.js";

const GROUPS = ["Критические", "У координаторов", "Высокий приоритет", "Исследование"] as const;
const HIGH_ID = "INC000000000001";
const LONG_TITLE =
  "ДлинноеНазваниеИнцидентаБезПробеловКотороеДолжноПереноситьсяВнутриКарточкиИОставатьсяЧитаемымНаУзкомЭкране";
const SHOTS = join("D:\\MTS", "d10b-screenshots");

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

function group(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

test("D10B читает очереди, SLA, пустую очередь и перенос названия", async ({ page }) => {
  const app = await openApp();
  await mkdir(SHOTS, { recursive: true });
  const sizes = [
    { width: 1440, height: 900, shot: "pult-1440x900.png" },
    { width: 1280, height: 720, shot: null },
    { width: 390, height: 844, shot: "pult-390x844.png" },
  ] as const;

  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await openDashboard(page, app);
    for (const name of GROUPS) {
      const heading = group(page, name).getByRole("heading", { name, exact: true });
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeVisible();
    }
    const empty = group(page, "Критические").getByText("Нет инцидентов");
    await empty.scrollIntoViewIfNeeded();
    await expect(empty).toBeVisible();

    const incident = group(page, "Высокий приоритет").locator("article").filter({ hasText: HIGH_ID });
    await incident.scrollIntoViewIfNeeded();
    await expect(incident.getByText("Назначен", { exact: true })).toBeVisible();
    await expect(incident.getByText("В сроке")).toBeVisible();
    await expect(incident.getByText(HIGH_ID)).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    if (size.shot) {
      await page.screenshot({ path: join(SHOTS, size.shot), fullPage: false });
    }

    const title = incident.getByRole("button", { name: "Задержка обновления статусов заказов" });
    const wrapped = await title.evaluate((element, nextTitle) => {
      element.textContent = nextTitle;
      const style = getComputedStyle(element);
      const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
      return {
        whiteSpace: style.whiteSpace,
        overflowWrap: style.overflowWrap,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        height: element.getBoundingClientRect().height,
        lineHeight,
      };
    }, LONG_TITLE);
    expect(wrapped.whiteSpace).not.toBe("nowrap");
    expect(wrapped.overflowWrap === "anywhere" || wrapped.overflowWrap === "break-word").toBe(true);
    expect(wrapped.scrollWidth).toBeLessThanOrEqual(wrapped.clientWidth + 1);
    expect(wrapped.height).toBeGreaterThan(wrapped.lineHeight * 1.4);
  }
});

test("D10B оставляет системный шрифт, если файлы MTS не загрузились", async ({ page }) => {
  const app = await openApp();
  await page.route("https://static.mts.ru/**", (route) => route.abort());
  await openDashboard(page, app);
  const font = await page.evaluate(async () => {
    await document.fonts.ready;
    const heading = document.querySelector("h1");
    const style = heading ? getComputedStyle(heading) : null;
    return {
      family: style?.fontFamily ?? "",
      width: heading?.getBoundingClientRect().width ?? 0,
      faces: [...document.fonts].map((face) => face.status),
    };
  });
  expect(font.family).toContain("Segoe UI");
  expect(font.width).toBeGreaterThan(40);
  expect(font.faces.every((status) => status !== "loaded")).toBe(true);
});

test("D10B ведёт Tab, Shift+Tab, Esc и возвращает фокус", async ({ page }) => {
  const app = await openApp();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDashboard(page, app);

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press("Tab");
  await expectFocusRing(page);
  const first = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveText(first);
  await expectFocusRing(page);

  const details = group(page, "Высокий приоритет")
    .locator("article")
    .filter({ hasText: HIGH_ID })
    .getByRole("button", { name: "Детали" });
  await details.focus();
  await expectFocusRing(page);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  await expectFocusRing(page);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(details).toBeFocused();
  await expectFocusRing(page);
});

test("D10B при 200% оставляет очереди достижимыми", async ({ page }) => {
  const app = await openApp();
  await page.setViewportSize({ width: 720, height: 450 });
  await openDashboard(page, app);
  for (const name of GROUPS) {
    const heading = group(page, name).getByRole("heading", { name, exact: true });
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeVisible();
  }
  await expect(group(page, "Критические").getByText("Нет инцидентов")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("D10B выключает переходы при prefers-reduced-motion", async ({ browser }) => {
  const app = await openApp();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  try {
    await openDashboard(page, app);
    const duration = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Детали");
      const root = getComputedStyle(document.documentElement).getPropertyValue("--motion").trim();
      const transition = button ? getComputedStyle(button).transitionDuration : "";
      return { root, transition };
    });
    expect(duration.root).toBe("0ms");
    expect(duration.transition.split(",").every((part) => part.trim() === "0s")).toBe(true);
  } finally {
    await context.close();
  }
});

async function expectFocusRing(page: Page): Promise<void> {
  const ring = await page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    const style = getComputedStyle(element);
    return {
      visible: element.matches(":focus-visible"),
      style: style.outlineStyle,
      width: style.outlineWidth,
      color: style.outlineColor,
    };
  });
  expect(ring?.visible).toBe(true);
  expect(ring?.style).toBe("solid");
  expect(Number.parseFloat(ring?.width ?? "0")).toBeGreaterThanOrEqual(2);
  expect(ring?.color).toBe("rgb(0, 101, 206)");
}
