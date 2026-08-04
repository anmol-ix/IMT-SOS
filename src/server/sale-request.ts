import { z } from "zod";
import { DUE_REASONS, PAYMENT_MODES } from "@/server/payment-policy";
import { PRICE_EXCEPTION_REASONS } from "@/server/sale-policy";

export const saleLineSchema = z.object({
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

export const saleRequestSchema = z.object({
  saleType: z.enum(["RETAIL", "WHOLESALE"]).default("RETAIL"),
  lines: z.array(saleLineSchema).min(1).max(20).superRefine((lines, context) => {
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
    .max(2)
    .superRefine((payments, context) => {
      if (new Set(payments.map((payment) => payment.paymentMode)).size !== payments.length) {
        context.addIssue({
          code: "custom",
          message: "Choose two different payment methods for a split sale.",
        });
      }
    }),
  dueReason: z.enum(DUE_REASONS).optional(),
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

export type SaleRequest = z.input<typeof saleRequestSchema>;
