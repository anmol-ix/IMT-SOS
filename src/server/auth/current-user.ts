import "server-only";

import { APP_ROLES, type AppRole, requireRole } from "./roles";
import { currentSessionUser } from "./session";

export type CurrentUser = {
  id: string;
  businessId: string;
  email: string | null;
  displayName: string;
  role: AppRole;
};

export class UnauthenticatedError extends Error {
  readonly status = 401;
  readonly code = "UNAUTHENTICATED";

  constructor() {
    super("Sign in is required.");
    this.name = "UnauthenticatedError";
  }
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const row = await currentSessionUser();
  if (!row) throw new UnauthenticatedError();

  return {
    id: row.id,
    businessId: row.businessId,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
  };
}

export async function requireCurrentUser(
  allowed: readonly AppRole[] = APP_ROLES,
): Promise<CurrentUser> {
  const user = await getCurrentUser();
  requireRole(user.role, allowed);
  return user;
}
