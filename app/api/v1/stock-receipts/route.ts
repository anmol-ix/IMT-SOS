import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import {
  completeStockReceipt,
  createStockReceiptDraft,
} from "@/server/complete-stock-receipt";
import { api, json } from "@/server/http";

const optionalText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).optional();

const bodySchema = z.object({
  supplierId: z.string().uuid(),
  supplierInvoiceReference: optionalText(120),
  note: optionalText(500),
  duplicateAcknowledged: z.boolean().optional(),
  lines: z.array(z.object({
    variantId: z.string().uuid(),
    sellableQuantity: z.number().int().min(0).max(5_000),
    openBoxQuantity: z.number().int().min(0).max(5_000),
    damagedQuantity: z.number().int().min(0).max(5_000),
    invoiceUnitCostPaise: z.number().int().positive().max(100_000_000),
  }).refine(
    (line) =>
      line.sellableQuantity + line.openBoxQuantity + line.damagedQuantity > 0,
    "Add at least one sellable, open-box or damaged unit.",
  )).min(1).max(100),
});

export async function POST(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER", "TRUSTED_OPERATOR"]);
    const commandId = z.string().uuid().parse(request.headers.get("idempotency-key"));
    const body = bodySchema.parse(await request.json());
    if (user.role === "TRUSTED_OPERATOR") {
      const draft = await createStockReceiptDraft(user, commandId, body);
      return json({ draft }, draft.replayed ? 200 : 201, id);
    }
    const result = await completeStockReceipt(user, commandId, body);
    return json({ receipt: result }, result.replayed ? 200 : 201, id);
  });
}
