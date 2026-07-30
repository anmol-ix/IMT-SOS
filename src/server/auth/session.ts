import "server-only";

import { cookies } from "next/headers";
import { inTransaction, getDatabase } from "@/server/database";
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  verifyPassword,
} from "@/server/auth/password";
import { SESSION_COOKIE_NAME, SESSION_LIFETIME_SECONDS } from "@/shared/auth";
import { APP_ROLES, type AppRole } from "./roles";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

type AuthUserRow = {
  id: string;
  business_id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  password_hash: string | null;
  failed_login_attempts: number;
  locked_until: Date | null;
};

export type AuthenticatedUser = {
  id: string;
  businessId: string;
  email: string;
  displayName: string;
  role: AppRole;
};

export class InvalidCredentialsError extends Error {
  readonly status = 401;
  readonly code = "INVALID_CREDENTIALS";

  constructor() {
    super("Email or password is incorrect.");
    this.name = "InvalidCredentialsError";
  }
}

export class InvalidSetupLinkError extends Error {
  readonly status = 400;
  readonly code = "INVALID_SETUP_LINK";

  constructor() {
    super("This setup link is invalid, expired, or already used.");
    this.name = "InvalidSetupLinkError";
  }
}

let dummyHash: Promise<string> | undefined;

function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("not-a-real-user-password");
  return dummyHash;
}

function toAuthenticatedUser(row: AuthUserRow): AuthenticatedUser {
  if (!APP_ROLES.includes(row.role as AppRole)) throw new InvalidCredentialsError();
  return {
    id: row.id,
    businessId: row.business_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role as AppRole,
  };
}

async function createSession(user: AuthenticatedUser): Promise<string> {
  const token = createOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_SECONDS * 1000);

  await inTransaction(async (client) => {
    await client.query(
      `UPDATE app_users
          SET failed_login_attempts = 0,
              locked_until = NULL,
              updated_at = now()
        WHERE id = $1`,
      [user.id],
    );
    await client.query(
      `DELETE FROM auth_sessions
        WHERE user_id = $1
          AND (revoked_at IS NOT NULL OR expires_at <= now())`,
      [user.id],
    );
    await client.query(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt],
    );
  });

  return token;
}

export async function authenticateWithPassword(
  emailInput: string,
  password: string,
): Promise<{ user: AuthenticatedUser; token: string }> {
  const email = emailInput.trim().toLowerCase();
  const result = await getDatabase().query<AuthUserRow>(
    `SELECT id, business_id, email, display_name, role, status, password_hash,
            failed_login_attempts, locked_until
       FROM app_users
      WHERE lower(email) = $1
      LIMIT 1`,
    [email],
  );
  const row = result.rows[0];
  const validPassword = await verifyPassword(
    password,
    row?.password_hash ?? await getDummyHash(),
  );
  const locked = Boolean(row?.locked_until && row.locked_until > new Date());

  if (!row || !validPassword || row.status !== "ACTIVE" || locked) {
    if (row && !locked) {
      await getDatabase().query(
        `UPDATE app_users
            SET failed_login_attempts = LEAST(failed_login_attempts + 1, 100),
                locked_until = CASE
                  WHEN failed_login_attempts + 1 >= $2
                    THEN now() + make_interval(mins => $3)
                  ELSE locked_until
                END,
                updated_at = now()
          WHERE id = $1`,
        [row.id, MAX_FAILED_ATTEMPTS, LOCK_MINUTES],
      );
    }
    throw new InvalidCredentialsError();
  }

  const user = toAuthenticatedUser(row);
  return { user, token: await createSession(user) };
}

export async function activateAccount(
  rawToken: string,
  password: string,
): Promise<{ user: AuthenticatedUser; token: string }> {
  const passwordHash = await hashPassword(password);
  const result = await getDatabase().query<AuthUserRow>(
    `SELECT id, business_id, email, display_name, role, 'ACTIVE' AS status,
            NULL::text AS password_hash, 0 AS failed_login_attempts,
            NULL::timestamptz AS locked_until
       FROM activate_internal_account($1, $2)`,
    [hashOpaqueToken(rawToken), passwordHash],
  );
  const row = result.rows[0];
  if (!row) throw new InvalidSetupLinkError();
  const user = toAuthenticatedUser(row);
  return { user, token: await createSession(user) };
}

export async function currentSessionUser(): Promise<AuthenticatedUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const result = await getDatabase().query<AuthUserRow>(
    `SELECT u.id, u.business_id, u.email, u.display_name, u.role, u.status,
            u.password_hash, u.failed_login_attempts, u.locked_until
       FROM auth_sessions s
       JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.status = 'ACTIVE'
      LIMIT 1`,
    [hashOpaqueToken(token)],
  );
  const row = result.rows[0];
  return row ? toAuthenticatedUser(row) : null;
}

export async function revokeCurrentSession(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await getDatabase().query(
    `UPDATE auth_sessions
        SET revoked_at = now()
      WHERE token_hash = $1
        AND revoked_at IS NULL`,
    [hashOpaqueToken(rawToken)],
  );
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_LIFETIME_SECONDS,
};

export function safeReturnPath(value: string | null | undefined): string {
  if (
    !value
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return "/";
  }
  return value;
}
