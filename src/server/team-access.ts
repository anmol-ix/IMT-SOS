import "server-only";

import { WorkOS } from "@workos-inc/node";
import { z } from "zod";
import { getDatabase } from "@/server/database";
import type { CurrentUser } from "@/server/auth/current-user";
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
  createdAt: string;
};

export type AccessInvitation = {
  id: string;
  email: string;
  displayName: string | null;
  role: InvitableRole;
  deliveryStatus: "SENT" | "NEEDS_ATTENTION";
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

class InvitationDeliveryError extends Error {
  readonly status = 502;
  readonly code = "INVITATION_DELIVERY_FAILED";

  constructor() {
    super(
      "Access is pre-approved, but the invitation email could not be sent. Try sending it again.",
    );
    this.name = "InvitationDeliveryError";
  }
}

type InvitationRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: InvitableRole;
  workos_invitation_id: string | null;
  created_at: Date;
};

let workosClient: WorkOS | undefined;

function getWorkOSClient(): WorkOS {
  if (workosClient) return workosClient;
  const config = z.object({
    WORKOS_API_KEY: z.string().trim().min(1),
    WORKOS_CLIENT_ID: z.string().trim().min(1),
  }).parse(process.env);
  workosClient = new WorkOS(config.WORKOS_API_KEY, {
    clientId: config.WORKOS_CLIENT_ID,
  });
  return workosClient;
}

function invitationFromRow(row: InvitationRow): AccessInvitation {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    deliveryStatus: row.workos_invitation_id ? "SENT" : "NEEDS_ATTENTION",
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
      created_at: Date;
    }>(
      `SELECT id, email, display_name, role, status, created_at
         FROM app_users
        WHERE business_id = $1
          AND status IN ('ACTIVE', 'DISABLED')
        ORDER BY
          CASE role WHEN 'BUSINESS_OWNER' THEN 0 WHEN 'TRUSTED_OPERATOR' THEN 1 ELSE 2 END,
          lower(display_name)`,
      [actor.businessId],
    ),
    getDatabase().query<InvitationRow>(
      `SELECT id, email, display_name, role, workos_invitation_id, created_at
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
      createdAt: row.created_at.toISOString(),
    })),
    invitations: invitations.rows.map(invitationFromRow),
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

  try {
    const workosInvitation = await getWorkOSClient().userManagement.sendInvitation({
      email: valid.email,
      expiresInDays: 7,
      inviterUserId: actor.workosUserId,
    });
    await getDatabase().query(
      "SELECT attach_workos_invitation($1, $2, $3)",
      [actor.id, row.id, workosInvitation.id],
    );
    row.workos_invitation_id = workosInvitation.id;
  } catch {
    // The database approval intentionally remains pending so the owner can retry
    // delivery without recreating or manually provisioning access.
  }

  return invitationFromRow(row);
}

export async function resendTeamInvitation(
  actor: CurrentUser,
  invitationId: string,
): Promise<AccessInvitation> {
  requireRole(actor.role, ["BUSINESS_OWNER"]);
  const result = await getDatabase().query<InvitationRow>(
    `SELECT id, email, display_name, role, workos_invitation_id, created_at
       FROM access_invitations
      WHERE id = $1 AND business_id = $2 AND status = 'PENDING'`,
    [invitationId, actor.businessId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new TeamAccessConflictError("This invitation is no longer pending.");
  }

  try {
    const invitation = row.workos_invitation_id
      ? await getWorkOSClient().userManagement.resendInvitation(
          row.workos_invitation_id,
        )
      : await getWorkOSClient().userManagement.sendInvitation({
          email: row.email,
          expiresInDays: 7,
          inviterUserId: actor.workosUserId,
        });
    await getDatabase().query(
      "SELECT attach_workos_invitation($1, $2, $3)",
      [actor.id, row.id, invitation.id],
    );
    row.workos_invitation_id = invitation.id;
    return invitationFromRow(row);
  } catch {
    throw new InvitationDeliveryError();
  }
}

export async function revokeTeamInvitation(
  actor: CurrentUser,
  invitationId: string,
): Promise<void> {
  requireRole(actor.role, ["BUSINESS_OWNER"]);
  const result = await getDatabase().query<{ workos_invitation_id: string | null }>(
    `SELECT workos_invitation_id
       FROM access_invitations
      WHERE id = $1 AND business_id = $2 AND status = 'PENDING'`,
    [invitationId, actor.businessId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new TeamAccessConflictError("This invitation is no longer pending.");
  }

  if (row.workos_invitation_id) {
    try {
      await getWorkOSClient().userManagement.revokeInvitation(
        row.workos_invitation_id,
      );
    } catch {
      // App access is still revoked below. A stale WorkOS invitation cannot
      // claim access because the database invitation is no longer pending.
    }
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
    created_at: Date;
  }>(
    `SELECT id, email, display_name, role, status, created_at
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
    createdAt: row.created_at.toISOString(),
  };
}
