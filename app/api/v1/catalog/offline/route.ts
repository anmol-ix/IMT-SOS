import { requireCurrentUser } from "@/server/auth/current-user";
import { getOfflineCatalogSnapshot } from "@/server/catalog";
import { api, json } from "@/server/http";

export async function GET(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser();
    return json(await getOfflineCatalogSnapshot(user), 200, id);
  });
}
