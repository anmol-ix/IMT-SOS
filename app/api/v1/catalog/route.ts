import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { searchSellableProducts } from "@/server/catalog";
import { api, json } from "@/server/http";

const querySchema = z.string().trim().max(120).default("");

export async function GET(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser();
    const query = querySchema.parse(new URL(request.url).searchParams.get("q") ?? "");
    const products = await searchSellableProducts(user, query);
    return json({ products }, 200, id);
  });
}
