import { getDatabase } from "@/server/database";
import { api, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return api(request, async (id) => {
    try {
      await getDatabase().query("SELECT 1");
      return json({ status: "ready", database: "reachable" }, 200, id);
    } catch {
      return json({ status: "not_ready" }, 503, id);
    }
  });
}
