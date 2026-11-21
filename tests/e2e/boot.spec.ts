import { expect, test } from "@playwright/test";

test("opens the coordinator console", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Пульт координатора" })).toBeVisible();
  await expect(page.getByText("goida-code · Кейс МТС")).toBeVisible();
  await expect(page.getByText("Демонстрационные данные")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Критические/ })).toBeVisible();
  const queues = page.getByRole("region", { name: "Высокий приоритет", exact: true });
  await expect(queues.getByText("INC000000000001", { exact: true })).toBeVisible();
  await expect(page.getByText("Нет инцидентов").first()).toBeVisible();
});
