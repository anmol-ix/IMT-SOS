import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { api, json } from "@/server/http";
import { decideStockAdjustment } from "@/server/stock-adjustments";

const decisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().min(1).max(500).optional(),
});

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    const adjustmentId = z.string().uuid().parse((await context.params).id);
    const commandId = z.string().uuid().parse(
      request.headers.get("idempotency-key"),
    );
    const input = decisionSchema.parse(await request.json());
    return json(
      {
        adjustment: await decideStockAdjustment(
          user,
          adjustmentId,
          commandId,
          input,
        ),
      },
      200,
      requestId,
    );
  });
}
