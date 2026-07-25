import { database } from "@/server/database";
import { api, json } from "@/server/http";

export async function GET(request: Request) {
  return api(request, async (id) => {
    try {
      await database.query("SELECT 1");
      return json({ status: "ready", database: "reachable" }, 200, id);
    } catch {
      return json({ status: "not_ready" }, 503, id);
    }
  });
}
