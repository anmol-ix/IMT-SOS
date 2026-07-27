import "server-only";

import { withAuth } from "@workos-inc/authkit-nextjs";
import { getDatabase } from "@/server/database";
import { APP_ROLES, type AppRole, ForbiddenError, requireRole } from "./roles";

export type CurrentUser = {
  id: string;
  businessId: string;
  workosUserId: string;
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

export class AccessNotApprovedError extends ForbiddenError {
  readonly code = "ACCESS_NOT_APPROVED";
  readonly email: string;

  constructor(email: string) {
    super("This email has not been invited to ItsMyToy Operations.");
    this.name = "AccessNotApprovedError";
    this.email = email;
  }
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const session = await withAuth();
  if (!session.user) throw new UnauthenticatedError();

  const result = await getDatabase().query<{
    id: string;
    business_id: string;
    workos_user_id: string;
    email: string | null;
    display_name: string;
    role: string;
  }>(
    `SELECT id, business_id, workos_user_id, email, display_name, role
       FROM claim_app_access($1, $2, $3, $4, $5)`,
    [
      session.user.id,
      session.user.email,
      session.user.emailVerified,
      session.user.name
        || [session.user.firstName, session.user.lastName].filter(Boolean).join(" ")
        || session.user.email,
      process.env.BUSINESS_NAME?.trim() || "ItsMyToy",
    ],
  );

  const row = result.rows[0];
  if (!row || !APP_ROLES.includes(row.role as AppRole)) {
    throw new AccessNotApprovedError(session.user.email);
  }

  return {
    id: row.id,
    businessId: row.business_id,
    workosUserId: row.workos_user_id,
    email: row.email,
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
