import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { api, json } from "@/server/http";
import { getInventoryHistory } from "@/server/inventory-history";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser();
    const variantId = z.string().uuid().parse((await context.params).id);
    return json(
      { inventory: await getInventoryHistory(user, variantId) },
      200,
      requestId,
    );
  });
}
