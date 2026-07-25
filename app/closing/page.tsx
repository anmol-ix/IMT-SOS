import { requireCurrentUser } from "@/server/auth/current-user";
import { getDailyClosingView } from "@/server/daily-closing";
import DailyClosingWorkspace from "./DailyClosingWorkspace";

export default async function DailyClosingPage() {
  const user = await requireCurrentUser(["BUSINESS_OWNER"]);
  const closing = await getDailyClosingView(user);

  return (
    <DailyClosingWorkspace
      displayName={user.displayName}
      initialClosing={closing}
    />
  );
}
