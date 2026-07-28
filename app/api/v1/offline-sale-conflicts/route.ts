import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import {
  listOfflineSaleConflicts,
  reportOfflineSaleConflict,
} from "@/server/offline-sale-conflicts";
import { api, json } from "@/server/http";
import { saleRequestSchema } from "@/server/sale-request";

const reportSchema = z.object({
  commandId: z.string().uuid(),
  payload: saleRequestSchema,
  display: z.object({
    totalPaise: z.number().int().positive().max(2_000_000_000),
    units: z.number().int().min(1).max(400),
    paymentMode: z.enum(["CASH", "UPI"]),
    products: z.array(z.object({
      variantId: z.string().uuid(),
      name: z.string().trim().min(1).max(200),
      sku: z.string().trim().min(1).max(100),
      quantity: z.number().int().min(1).max(20),
    })).min(1).max(20),
  }),
  error: z.object({
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(500),
  }),
});

export async function GET(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser();
    return json({ conflicts: await listOfflineSaleConflicts(user) }, 200, id);
  });
}

export async function POST(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser();
    const body = reportSchema.parse(await request.json());
    const conflict = await reportOfflineSaleConflict(user, {
      commandId: body.commandId,
      payload: body.payload,
      display: body.display,
      errorCode: body.error.code,
      errorMessage: body.error.message,
    });
    return json({ conflict }, 201, id);
  });
}
