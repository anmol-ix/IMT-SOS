import { requireCurrentUser } from "@/server/auth/current-user";
import { listDevices } from "@/server/devices";
import { listTeamAccess } from "@/server/team-access";

export async function loadSettings() {
  const user = await requireCurrentUser(["BUSINESS_OWNER"]);
  const [team, devices] = await Promise.all([
    listTeamAccess(user),
    listDevices(user),
  ]);
  return { user, team, devices };
}
