import { afterEach, describe, expect, it, vi } from "vitest";

describe("database runtime configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("does not require DATABASE_URL merely to import server modules during a build", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const databaseModule = await import("@/server/database");

    expect(() => databaseModule.getDatabase()).toThrow(
      "DATABASE_URL is required at runtime",
    );
  });
});
