export const APP_ROLES = [
  "BUSINESS_OWNER",
  "TRUSTED_OPERATOR",
  "STORE_OPERATOR",
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export class ForbiddenError extends Error {
  readonly status = 403;
  readonly code = "FORBIDDEN";

  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function requireRole(role: AppRole, allowed: readonly AppRole[]): void {
  if (!allowed.includes(role)) {
    throw new ForbiddenError();
  }
}
