import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { completeStockReceiptDraft } from "@/server/complete-stock-receipt";
import { api, json } from "@/server/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    const receiptId = z.string().uuid().parse((await context.params).id);
    const commandId = z.string().uuid().parse(request.headers.get("idempotency-key"));
    const receipt = await completeStockReceiptDraft(user, receiptId, commandId);
    return json({ receipt }, receipt.replayed ? 200 : 201, requestId);
  });
}
