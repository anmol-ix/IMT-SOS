import Link from "next/link";
import { requireCurrentUser } from "@/server/auth/current-user";
import { listDevices } from "@/server/devices";
import { listTeamAccess } from "@/server/team-access";
import TeamWorkspace from "./TeamWorkspace";

export default async function TeamPage() {
  const user = await requireCurrentUser(["BUSINESS_OWNER"]);
  const [initialTeam, initialDevices] = await Promise.all([
    listTeamAccess(user),
    listDevices(user),
  ]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="brand">ItsMyToy</p>
          <p className="welcome">Hi, {user.displayName}</p>
        </div>
        <nav className="app-nav" aria-label="Operations">
          <Link href="/dashboard">Home</Link>
          <Link href="/">Sell</Link>
          <Link href="/receive">Receive</Link>
          <Link href="/inventory">Inventory</Link>
          <Link href="/activity">Activity</Link>
          <Link className="active" href="/team">Team</Link>
        </nav>
        <span className="role-chip">Business owner</span>
      </header>

      <TeamWorkspace initialTeam={initialTeam} initialDevices={initialDevices} />
    </main>
  );
}
