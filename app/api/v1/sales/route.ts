import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { completeSale } from "@/server/complete-sale";
import { api, json } from "@/server/http";
import { PAYMENT_MODES } from "@/server/payment-policy";
import { PRICE_EXCEPTION_REASONS } from "@/server/sale-policy";

const lineSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  unitPricePaise: z.number().int().positive().max(100_000_000),
  approvalId: z.string().uuid().optional(),
  ownerException: z
    .object({
      reason: z.enum(PRICE_EXCEPTION_REASONS),
      note: z.string().trim().min(1).max(500).optional(),
    })
    .optional(),
});

const bodySchema = z.object({
  lines: z.array(lineSchema).min(1).max(20).superRefine((lines, context) => {
    if (new Set(lines.map((line) => line.variantId)).size !== lines.length) {
      context.addIssue({ code: "custom", message: "Each product may appear only once." });
    }
  }),
  customerId: z.string().uuid().optional(),
  guestApprovalId: z.string().uuid().optional(),
  ownerGuestOverride: z.boolean().optional(),
  payments: z
    .array(z.object({
      paymentMode: z.enum(PAYMENT_MODES),
      amountPaise: z.number().int().positive().max(100_000_000),
    }))
    .min(1)
    .max(2)
    .superRefine((payments, context) => {
      if (new Set(payments.map((payment) => payment.paymentMode)).size !== payments.length) {
        context.addIssue({
          code: "custom",
          message: "Choose two different payment methods for a split sale.",
        });
      }
    }),
  offline: z
    .object({
      schemaVersion: z.literal(1),
      deviceId: z.string().uuid(),
      devicePublicId: z.string().uuid(),
      validatedAt: z.string().datetime(),
      createdAt: z.string().datetime(),
      catalogAsOf: z.string().datetime(),
      lines: z.array(z.object({
        variantId: z.string().uuid(),
        priceVersionId: z.string().uuid(),
        cachedStock: z.number().int().min(0),
        queuedBeforeQuantity: z.number().int().min(0),
      })).min(1).max(20),
    })
    .optional(),
});

export async function POST(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser();
    const commandId = z.string().uuid().parse(request.headers.get("idempotency-key"));
    const body = bodySchema.parse(await request.json());
    const result = await completeSale(user, commandId, {
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
