import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { api, json } from "@/server/http";
import { setReorderPolicy } from "@/server/reorder-policy";
import { REORDER_POLICY_REASONS } from "@/shared/reorder-policy";

const bodySchema = z.object({
  reorderPoint: z.number().int().min(0).max(100_000).nullable(),
  restockTarget: z.number().int().min(1).max(100_000).nullable(),
  reason: z.enum(REORDER_POLICY_REASONS),
  note: z.string().trim().min(3).max(500),
});

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    const variantId = z.string().uuid().parse((await context.params).id);
    const commandId = z.string().uuid().parse(
      request.headers.get("idempotency-key"),
    );
    const change = await setReorderPolicy(
      user,
      variantId,
      commandId,
      bodySchema.parse(await request.json()),
    );
    return json({ change }, change.replayed ? 200 : 201, requestId);
  });
}
