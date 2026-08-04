import "server-only";

import { getDatabase } from "@/server/database";
import type { CurrentUser } from "@/server/auth/current-user";
import { createOpaqueToken, hashOpaqueToken } from "@/server/auth/password";
import { requireRole } from "@/server/auth/roles";
import {
  requireValidInvitation,
  requireValidMemberAccess,
  type InvitableRole,
  type TeamMemberStatus,
} from "@/shared/team-access-policy";

export type TeamMember = {
  id: string;
  email: string | null;
  displayName: string;
  role: "BUSINESS_OWNER" | InvitableRole;
  status: "ACTIVE" | "DISABLED";
  passwordConfigured: boolean;
  createdAt: string;
};

export type AccessInvitation = {
  id: string;
  email: string;
  displayName: string | null;
  role: InvitableRole;
  deliveryStatus: "SETUP_LINK_REQUIRED" | "SETUP_LINK_READY";
  setupPath?: string;
  createdAt: string;
};

export type TeamAccessView = {
  members: TeamMember[];
  invitations: AccessInvitation[];
};

class TeamAccessConflictError extends Error {
  readonly status = 409;
  readonly code = "TEAM_ACCESS_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "TeamAccessConflictError";
  }
}

type InvitationRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: InvitableRole;
  created_at: Date;
};

async function createSetupPath(
  actor: CurrentUser,
  target: { userId?: string; invitationId?: string },
): Promise<string> {
  const token = createOpaqueToken();
  await getDatabase().query(
    `SELECT create_internal_auth_setup_token(
       $1, $2, $3, $4, now() + interval '7 days'
     )`,
    [
      actor.id,
      target.userId ?? null,
      target.invitationId ?? null,
      hashOpaqueToken(token),
    ],
  );
  return `/activate?token=${encodeURIComponent(token)}`;
}

function invitationFromRow(
  row: InvitationRow,
  setupPath?: string,
): AccessInvitation {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    deliveryStatus: setupPath ? "SETUP_LINK_READY" : "SETUP_LINK_REQUIRED",
    setupPath,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listTeamAccess(
  actor: CurrentUser,
): Promise<TeamAccessView> {
  requireRole(actor.role, ["BUSINESS_OWNER"]);
  const [members, invitations] = await Promise.all([
    getDatabase().query<{
      id: string;
      email: string | null;
      display_name: string;
      role: TeamMember["role"];
      status: TeamMember["status"];
      password_configured: boolean;
      created_at: Date;
    }>(
      `SELECT id, email, display_name, role, status,
              password_hash IS NOT NULL AS password_configured, created_at
         FROM app_users
        WHERE business_id = $1
          AND status IN ('ACTIVE', 'DISABLED')
        ORDER BY
          CASE role WHEN 'BUSINESS_OWNER' THEN 0 WHEN 'TRUSTED_OPERATOR' THEN 1 ELSE 2 END,
          lower(display_name)`,
      [actor.businessId],
    ),
    getDatabase().query<InvitationRow>(
      `SELECT id, email, display_name, role, created_at
         FROM access_invitations
        WHERE business_id = $1 AND status = 'PENDING'
        ORDER BY created_at DESC`,
      [actor.businessId],
    ),
  ]);

  return {
    members: members.rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      status: row.status,
      passwordConfigured: row.password_configured,
      createdAt: row.created_at.toISOString(),
    })),
    invitations: invitations.rows.map((row) => invitationFromRow(row)),
  };
}

export async function inviteTeamMember(
  actor: CurrentUser,
  input: { email: string; displayName?: string; role: string },
): Promise<AccessInvitation> {
  requireRole(actor.role, ["BUSINESS_OWNER"]);
  const valid = requireValidInvitation(input);
  const existing = await getDatabase().query(
    `SELECT 1
       FROM access_invitations
      WHERE business_id = $1
        AND lower(email) = $2
        AND status = 'PENDING'
      UNION ALL
     SELECT 1
       FROM app_users
      WHERE business_id = $1
        AND lower(email) = $2
      LIMIT 1`,
    [actor.businessId, valid.email],
  );
  if (existing.rowCount) {
    throw new TeamAccessConflictError(
      "This email is already a team member or has a pending invitation.",
    );
  }

  const created = await getDatabase().query<InvitationRow>(
    `SELECT * FROM create_app_access_invitation($1, $2, $3, $4)`,
    [actor.id, valid.email, valid.displayName, valid.role],
  );
  const row = created.rows[0];
  const setupPath = await createSetupPath(actor, { invitationId: row.id });
  return invitationFromRow(row, setupPath);
}

export async function resendTeamInvitation(
  actor: CurrentUser,
  invitationId: string,
): Promise<AccessInvitation> {
  requireRole(actor.role, ["BUSINESS_OWNER"]);
  const result = await getDatabase().query<InvitationRow>(
    `SELECT id, email, display_name, role, created_at
       FROM access_invitations
      WHERE id = $1 AND business_id = $2 AND status = 'PENDING'`,
    [invitationId, actor.businessId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new TeamAccessConflictError("This invitation is no longer pending.");
  }

  const setupPath = await createSetupPath(actor, { invitationId: row.id });
  return invitationFromRow(row, setupPath);
}

export async function revokeTeamInvitation(
  actor: CurrentUser,
  invitationId: string,
): Promise<void> {
  requireRole(actor.role, ["BUSINESS_OWNER"]);
  const result = await getDatabase().query(
    `SELECT 1
       FROM access_invitations
      WHERE id = $1 AND business_id = $2 AND status = 'PENDING'`,
    [invitationId, actor.businessId],
  );
  if (!result.rowCount) {
    throw new TeamAccessConflictError("This invitation is no longer pending.");
  }

  await getDatabase().query(
    "SELECT revoke_app_access_invitation($1, $2, 'OWNER_REVOKED')",
    [actor.id, invitationId],
  );
}

export async function changeTeamMemberAccess(
  actor: CurrentUser,
  memberId: string,
  input: { role: string; status: string },
): Promise<TeamMember> {
  requireRole(actor.role, ["BUSINESS_OWNER"]);
  const valid = requireValidMemberAccess(input);
  const result = await getDatabase().query<{
    id: string;
    email: string | null;
    display_name: string;
    role: InvitableRole;
    status: TeamMemberStatus;
    password_configured: boolean;
    created_at: Date;
  }>(
    `SELECT id, email, display_name, role, status,
            password_hash IS NOT NULL AS password_configured, created_at
       FROM update_app_team_member($1, $2, $3, $4)`,
    [actor.id, memberId, valid.role, valid.status],
  );
  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    passwordConfigured: row.password_configured,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createMemberPasswordSetup(
  actor: CurrentUser,
  memberId: string,
): Promise<{ setupPath: string }> {
  requireRole(actor.role, ["BUSINESS_OWNER"]);
  const target = await getDatabase().query(
    `SELECT 1
       FROM app_users
      WHERE id = $1
        AND business_id = $2`,
    [memberId, actor.businessId],
  );
  if (!target.rowCount) throw new TeamAccessConflictError("Team member not found.");
  return { setupPath: await createSetupPath(actor, { userId: memberId }) };
}
