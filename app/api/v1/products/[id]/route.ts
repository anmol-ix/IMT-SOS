import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { api, json } from "@/server/http";
import { updateProduct } from "@/server/update-product";
import {
  PRODUCT_CHANGE_REASONS,
  productChangeNoteConflict,
} from "@/shared/product-change-policy";
import { isRackCode } from "@/shared/product-setup-policy";

const bodySchema = z.object({
  rackLocation: z.string().refine(isRackCode, "Choose a valid rack and shelf."),
  mrpPaise: z.number().int().positive().max(100_000_000),
  standardPricePaise: z.number().int().positive().max(100_000_000),
  wholesalePricePaise: z.number().int().positive().max(100_000_000),
  ownerFloorPaise: z.number().int().positive().max(100_000_000),
  trustedOperatorFloorPaise: z.number().int().positive().max(100_000_000),
  storeOperatorFloorPaise: z.number().int().positive().max(100_000_000),
  reason: z.enum(PRODUCT_CHANGE_REASONS),
  note: z.string().trim().min(1).max(500).optional(),
}).refine(
  (value) => !productChangeNoteConflict(value.reason, value.note),
  {
    message: "Add a note when the change reason is Other.",
    path: ["note"],
  },
);

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return api(request, async (id) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    const variantId = z.string().uuid().parse((await context.params).id);
    const commandId = z.string().uuid().parse(
      request.headers.get("idempotency-key"),
    );
    const body = bodySchema.parse(await request.json());
    const change = await updateProduct(user, variantId, commandId, body);
    return json({ change }, change.replayed ? 200 : 201, id);
  });
}
