import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { api, json } from "@/server/http";
import {
  listPendingStockAdjustments,
  requestStockAdjustment,
} from "@/server/stock-adjustments";
import {
  STOCK_ADJUSTMENT_REASONS,
  STOCK_CONDITIONS,
} from "@/shared/stock-adjustment-policy";

const requestSchema = z.object({
  variantId: z.string().uuid(),
  stockCondition: z.enum(STOCK_CONDITIONS),
  countedQuantity: z.number().int().min(0).max(100_000),
  reason: z.enum(STOCK_ADJUSTMENT_REASONS),
  note: z.string().trim().min(3).max(500),
});

export async function GET(request: Request) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    return json(
      { adjustments: await listPendingStockAdjustments(user) },
      200,
      requestId,
    );
  });
}

export async function POST(request: Request) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser([
      "BUSINESS_OWNER",
      "TRUSTED_OPERATOR",
    ]);
    const commandId = z.string().uuid().parse(
      request.headers.get("idempotency-key"),
    );
    const input = requestSchema.parse(await request.json());
    const adjustment = await requestStockAdjustment(user, commandId, input);
    return json(
      { adjustment },
      adjustment.replayed ? 200 : 201,
      requestId,
    );
  });
}
