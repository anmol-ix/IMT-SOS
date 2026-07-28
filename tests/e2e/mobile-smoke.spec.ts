import { expect, test } from "@playwright/test";

test("mobile selling sign-in shell and liveness endpoint are available", async ({ page, request }) => {
  const health = await request.get("/api/v1/health/live");
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({ status: "ok" });
  expect(health.headers()["x-request-id"]).toBeTruthy();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sell toys without calling the owner." })).toBeVisible();
  await expect(page.getByText("Application ready")).toBeVisible();
  await expect(page.getByLabel("Connection status")).toContainText("Online");
  await expect(page.getByRole("link", { name: "Sign in to start selling" })).toBeVisible();
  await expect(page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  })).resolves.toBe(true);
  await expect(page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("itsmytoy-offline", 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = Array.from(database.objectStoreNames);
    database.close();
    return stores;
  })).resolves.toEqual(["catalog", "device", "sales"]);

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
