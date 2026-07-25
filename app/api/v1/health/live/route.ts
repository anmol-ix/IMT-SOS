import { api, json } from "@/server/http";

export async function GET(request: Request) {
  return api(request, async (id) =>
    json({ status: "ok", service: "itsmytoy-operations" }, 200, id),
  );
}
