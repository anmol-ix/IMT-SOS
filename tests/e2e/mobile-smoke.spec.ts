import { expect, test } from "@playwright/test";

test("mobile selling sign-in shell and liveness endpoint are available", async ({ page, request }) => {
  const health = await request.get("/api/v1/health/live");
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({ status: "ok" });
  expect(health.headers()["x-request-id"]).toBeTruthy();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sell toys without calling the owner." })).toBeVisible();
  await expect(page.getByText("Application online")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to start selling" })).toBeVisible();
});
