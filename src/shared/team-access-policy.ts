import type { AppRole } from "@/server/auth/roles";

export const INVITABLE_ROLES = [
  "TRUSTED_OPERATOR",
  "STORE_OPERATOR",
] as const satisfies readonly AppRole[];

export type InvitableRole = (typeof INVITABLE_ROLES)[number];
export type TeamMemberStatus = "ACTIVE" | "DISABLED";

export class InvalidTeamAccessError extends Error {
  readonly status = 400;
  readonly code = "INVALID_TEAM_ACCESS";

  constructor(message: string) {
    super(message);
    this.name = "InvalidTeamAccessError";
  }
}

export function normalizeAccessEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function requireValidInvitation(input: {
  email: string;
  displayName?: string;
  role: string;
}): {
  email: string;
  displayName: string;
  role: InvitableRole;
} {
  const email = normalizeAccessEmail(input.email);
  const displayName = input.displayName?.trim() ?? "";
  if (
    email.length < 3
    || email.length > 320
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new InvalidTeamAccessError("Enter a valid email address.");
  }
  if (displayName.length > 120) {
    throw new InvalidTeamAccessError("Name must be 120 characters or fewer.");
  }
  if (!INVITABLE_ROLES.includes(input.role as InvitableRole)) {
    throw new InvalidTeamAccessError("Choose a valid operator role.");
  }
  return {
    email,
    displayName,
    role: input.role as InvitableRole,
  };
}

export function requireValidMemberAccess(input: {
  role: string;
  status: string;
}): {
  role: InvitableRole;
  status: TeamMemberStatus;
} {
  if (!INVITABLE_ROLES.includes(input.role as InvitableRole)) {
    throw new InvalidTeamAccessError("Choose a valid operator role.");
  }
  if (input.status !== "ACTIVE" && input.status !== "DISABLED") {
    throw new InvalidTeamAccessError("Choose a valid access status.");
  }
  return {
    role: input.role as InvitableRole,
    status: input.status,
  };
}
