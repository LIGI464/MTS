import { expect, test } from "@playwright/test";

test("opens the coordinator console", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Goida-board" })).toBeVisible();
  await expect(page.getByText("goida-code · Кейс МТС")).toBeVisible();
  await expect(page.getByText("Демонстрационные данные")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Критические/ })).toBeVisible();
  await expect(page.getByText("INC000000000001")).toBeVisible();
  await expect(page.getByText("Нет инцидентов").first()).toBeVisible();
});
