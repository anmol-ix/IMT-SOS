import { type AppRole, requireRole } from "@/server/auth/roles";

export function ownerProof(user: { displayName: string; role: AppRole }) {
  requireRole(user.role, ["BUSINESS_OWNER"]);
  return { proof: "owner_authorization_enforced", actor: user.displayName };
}
