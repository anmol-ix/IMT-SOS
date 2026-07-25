import { requireCurrentUser } from "@/server/auth/current-user";
import { api, json } from "@/server/http";

export async function GET(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser();
    return json(
      { user: { id: user.id, displayName: user.displayName, role: user.role } },
      200,
      id,
    );
  });
}
