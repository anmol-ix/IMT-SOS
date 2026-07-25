import "server-only";

import { withAuth } from "@workos-inc/authkit-nextjs";
import { database } from "@/server/database";
import { APP_ROLES, type AppRole, ForbiddenError, requireRole } from "./roles";

export type CurrentUser = {
  id: string;
  businessId: string;
  workosUserId: string;
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
  const session = await withAuth();
  if (!session.user) throw new UnauthenticatedError();

  const result = await database.query<{
    id: string;
    business_id: string;
    workos_user_id: string;
    display_name: string;
    role: string;
  }>(
    `SELECT id, business_id, workos_user_id, display_name, role
       FROM app_users
      WHERE workos_user_id = $1 AND status = 'ACTIVE'`,
    [session.user.id],
  );

  const row = result.rows[0];
  if (!row || !APP_ROLES.includes(row.role as AppRole)) {
    throw new ForbiddenError("This account has not been approved for ItsMyToy.");
  }

  return {
    id: row.id,
    businessId: row.business_id,
    workosUserId: row.workos_user_id,
    displayName: row.display_name,
    role: row.role as AppRole,
  };
}

export async function requireCurrentUser(
  allowed: readonly AppRole[] = APP_ROLES,
): Promise<CurrentUser> {
  const user = await getCurrentUser();
  requireRole(user.role, allowed);
  return user;
}
