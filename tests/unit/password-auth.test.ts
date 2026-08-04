import { describe, expect, it } from "vitest";
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  requireStrongPassword,
  verifyPassword,
} from "@/server/auth/password";
import { safeReturnPath } from "@/server/auth/session";

describe("internal authentication primitives", () => {
  it("hashes and verifies passwords without storing the password", async () => {
    const password = "correct horse battery staple";
    const stored = await hashPassword(password);

    expect(stored).not.toContain(password);
    await expect(verifyPassword(password, stored)).resolves.toBe(true);
    await expect(verifyPassword("incorrect password", stored)).resolves.toBe(false);
  });

  it("rejects short passwords and malformed stored hashes", async () => {
    expect(() => requireStrongPassword("too short")).toThrow(/12/);
    await expect(verifyPassword("anything at all", "broken")).resolves.toBe(false);
  });

  it("creates random tokens and stores only a deterministic digest", () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();

    expect(first).not.toBe(second);
    expect(hashOpaqueToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashOpaqueToken(first)).toBe(hashOpaqueToken(first));
    expect(hashOpaqueToken(first)).not.toContain(first);
  });

  it("accepts only local return paths", () => {
    expect(safeReturnPath("/dashboard?period=today")).toBe(
      "/dashboard?period=today",
    );
    expect(safeReturnPath("https://example.com")).toBe("/");
    expect(safeReturnPath("//example.com")).toBe("/");
    expect(safeReturnPath("/\\example.com")).toBe("/");
    expect(safeReturnPath("/dashboard\nset-cookie:x")).toBe("/");
  });
});
