import { describe, expect, it } from "vitest";
import { ForbiddenError, requireRole } from "@/server/auth/roles";
import { ownerProof } from "@/server/owner-proof";

describe("server authorization", () => {
  it("allows a business owner through the owner-only policy", () => {
    expect(
      ownerProof({ displayName: "Owner", role: "BUSINESS_OWNER" }),
    ).toEqual({ proof: "owner_authorization_enforced", actor: "Owner" });
  });

  it.each(["TRUSTED_OPERATOR", "STORE_OPERATOR"] as const)(
    "denies %s from the owner-only endpoint policy",
    (role) => {
      expect(() => ownerProof({ displayName: "Operator", role })).toThrow(
        ForbiddenError,
      );
    },
  );

  it("allows every accepted role through an ordinary signed-in policy", () => {
    for (const role of [
      "BUSINESS_OWNER",
      "TRUSTED_OPERATOR",
      "STORE_OPERATOR",
    ] as const) {
      expect(() =>
        requireRole(role, ["BUSINESS_OWNER", "TRUSTED_OPERATOR", "STORE_OPERATOR"]),
      ).not.toThrow();
    }
  });
});
