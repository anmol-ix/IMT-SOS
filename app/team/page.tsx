import { requireCurrentUser } from "@/server/auth/current-user";
import { listDevices } from "@/server/devices";
import { listTeamAccess } from "@/server/team-access";
import AppShell from "@/components/AppShell";
import TeamWorkspace from "./TeamWorkspace";

export default async function TeamPage() {
  const user = await requireCurrentUser(["BUSINESS_OWNER"]);
  const [initialTeam, initialDevices] = await Promise.all([
    listTeamAccess(user),
    listDevices(user),
  ]);

  return (
    <AppShell displayName={user.displayName} role="BUSINESS_OWNER">
      <TeamWorkspace initialTeam={initialTeam} initialDevices={initialDevices} />
    </AppShell>
  );
}
