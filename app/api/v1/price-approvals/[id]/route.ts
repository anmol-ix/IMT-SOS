import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { api, json } from "@/server/http";
import {
  decidePriceApproval,
  getPriceApproval,
} from "@/server/price-approvals";
import { PRICE_EXCEPTION_REASONS } from "@/server/sale-policy";

const decisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("APPROVE"),
    reason: z.enum(PRICE_EXCEPTION_REASONS),
    note: z.string().trim().min(1).max(500).optional(),
  }),
  z.object({
    decision: z.literal("REJECT"),
    note: z.string().trim().min(1).max(500).optional(),
  }),
]);

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return api(request, async (id) => {
    const user = await requireCurrentUser();
    const approvalId = z.string().uuid().parse((await context.params).id);
    return json({ approval: await getPriceApproval(user, approvalId) }, 200, id);
  });
}

export async function PATCH(request: Request, context: Context) {
  return api(request, async (id) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    const approvalId = z.string().uuid().parse((await context.params).id);
    const body = decisionSchema.parse(await request.json());
    return json(
      { approval: await decidePriceApproval(user, approvalId, body) },
      200,
      id,
    );
  });
}
