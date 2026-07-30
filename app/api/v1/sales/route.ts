import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { completeSale } from "@/server/complete-sale";
import { api, json } from "@/server/http";
import { saleRequestSchema } from "@/server/sale-request";

export async function POST(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser();
    const commandId = z.string().uuid().parse(request.headers.get("idempotency-key"));
    const body = saleRequestSchema.parse(await request.json());
    const result = await completeSale(user, commandId, {
      saleType: body.saleType,
      lines: body.lines,
      customerId: body.customerId,
      guestApprovalId: body.guestApprovalId,
      ownerGuestOverride: body.ownerGuestOverride,
      payments: body.payments,
      offline: body.offline,
    });
    if (user.role !== "BUSINESS_OWNER") {
      const safe = {
        saleId: result.saleId,
        saleNumber: result.saleNumber,
        completedAt: result.completedAt,
        customerName: result.customerName,
        saleType: result.saleType,
        payments: result.payments,
        totalPaise: result.totalPaise,
        lines: result.lines.map((line) => ({
          variantId: line.variantId,
          productName: line.productName,
          sku: line.sku,
          quantity: line.quantity,
          unitPricePaise: line.unitPricePaise,
          totalPaise: line.totalPaise,
          remainingStock: line.remainingStock,
        })),
        replayed: result.replayed,
      };
      return json({ sale: safe }, result.replayed ? 200 : 201, id);
    }
    return json({ sale: result }, result.replayed ? 200 : 201, id);
  });
}
