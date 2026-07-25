import { requireCurrentUser } from "@/server/auth/current-user";
import { api, json } from "@/server/http";
import { getOwnerDashboard } from "@/server/owner-dashboard";

export async function GET(request: Request) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    return json(
      { dashboard: await getOwnerDashboard(user) },
      200,
      requestId,
    );
  });
}
