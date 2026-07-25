import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { createProduct } from "@/server/create-product";
import { api, json } from "@/server/http";
import {
  isRackCode,
  PRODUCT_UNITS,
} from "@/shared/product-setup-policy";

const optionalText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).optional();

const skuCode = (maximum: number) =>
  z.string()
    .trim()
    .toUpperCase()
    .regex(
      new RegExp(`^[A-Z0-9]{2,${maximum}}$`),
      `Use 2–${maximum} letters or numbers.`,
    );

const bodySchema = z.object({
  productName: z.string().trim().min(2).max(180),
  category: z.string().trim().min(2).max(80),
  categoryCode: skuCode(3),
  subcategory: z.string().trim().min(2).max(80),
  subcategoryCode: skuCode(3),
  brand: optionalText(80),
  variantName: optionalText(80),
  variantCode: skuCode(4).optional(),
  supplierBarcode: optionalText(120),
  unitOfMeasure: z.enum(PRODUCT_UNITS),
  packSize: z.number().int().min(1).max(100_000),
  rackLocation: z.string().refine(isRackCode, "Choose a valid rack and shelf."),
  purchaseCostPaise: z.number().int().positive().max(100_000_000),
  standardPricePaise: z.number().int().positive().max(100_000_000),
  mrpPaise: z.number().int().positive().max(100_000_000),
  ownerFloorPaise: z.number().int().positive().max(100_000_000).optional(),
  trustedOperatorFloorPaise:
    z.number().int().positive().max(100_000_000).optional(),
  storeOperatorFloorPaise:
    z.number().int().positive().max(100_000_000).optional(),
}).refine(
  (value) => !value.variantCode || Boolean(value.variantName),
  {
    message: "Add a variant name when a variant code is used.",
    path: ["variantName"],
  },
);

export async function POST(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    const commandId = z.string().uuid().parse(
      request.headers.get("idempotency-key"),
    );
    const body = bodySchema.parse(await request.json());
    const product = await createProduct(user, commandId, body);
    return json({ product }, product.replayed ? 200 : 201, id);
  });
}
