import { expect, test } from "@playwright/test";

test("mobile selling sign-in shell and liveness endpoint are available", async ({ page, request }, testInfo) => {
  const health = await request.get("/api/v1/health/live");
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({ status: "ok" });
  expect(health.headers()["x-request-id"]).toBeTruthy();

  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
  expect(new URL(page.url()).origin).toBe(
    new URL(testInfo.project.use.baseURL as string).origin,
  );
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByLabel("Connection status")).toContainText("Online");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    return registrations.length;
  })).resolves.toBe(0);
  await expect(page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("itsmytoy-offline", 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = Array.from(database.objectStoreNames);
    database.close();
    return stores;
  })).resolves.toEqual([]);

  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  await expect(manifest.json()).resolves.toMatchObject({
    name: "ItsMyToy Operations",
    display: "standalone",
    start_url: "/",
  });

  const serviceWorker = await request.get("/sw.js");
  expect(serviceWorker.status()).toBe(200);
  expect(serviceWorker.headers()["cache-control"]).toContain("no-cache");
  expect(await serviceWorker.text()).not.toContain("/api/");
});
