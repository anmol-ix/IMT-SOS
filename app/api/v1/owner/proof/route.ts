import { requireCurrentUser } from "@/server/auth/current-user";
import { api, json } from "@/server/http";
import { ownerProof } from "@/server/owner-proof";

export async function GET(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser();
    return json(ownerProof(user), 200, id);
  });
}
