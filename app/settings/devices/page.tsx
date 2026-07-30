import AppShell from "@/components/AppShell";
import TeamWorkspace from "../../team/TeamWorkspace";
import { loadSettings } from "../data";

export default async function SettingsDevicesPage() {
  const { user, team, devices } = await loadSettings();
  return <AppShell displayName={user.displayName} role="BUSINESS_OWNER"><TeamWorkspace initialTeam={team} initialDevices={devices} mode="DEVICES" /></AppShell>;
}
