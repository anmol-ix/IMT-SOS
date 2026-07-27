import { describe, expect, it } from "vitest";
import {
  InvalidTeamAccessError,
  normalizeAccessEmail,
  requireValidInvitation,
  requireValidMemberAccess,
} from "@/shared/team-access-policy";

describe("team access policy", () => {
  it("normalizes a valid operator invitation", () => {
    expect(
      requireValidInvitation({
        email: "  Staff.Person@Example.com ",
        displayName: " Staff Person ",
        role: "STORE_OPERATOR",
      }),
    ).toEqual({
      email: "staff.person@example.com",
      displayName: "Staff Person",
      role: "STORE_OPERATOR",
    });
    expect(normalizeAccessEmail(" OWNER@EXAMPLE.COM ")).toBe(
      "owner@example.com",
    );
  });

  it.each(["BUSINESS_OWNER", "ADMIN", ""])(
    "does not allow %s to be granted from the team invitation form",
    (role) => {
      expect(() =>
        requireValidInvitation({
          email: "staff@example.com",
          role,
        }),
      ).toThrow(InvalidTeamAccessError);
    },
  );

  it("accepts only active or disabled operator access", () => {
    expect(
      requireValidMemberAccess({
        role: "TRUSTED_OPERATOR",
        status: "DISABLED",
      }),
    ).toEqual({ role: "TRUSTED_OPERATOR", status: "DISABLED" });
    expect(() =>
      requireValidMemberAccess({
        role: "STORE_OPERATOR",
        status: "INVITED",
      }),
    ).toThrow(InvalidTeamAccessError);
  });
});
