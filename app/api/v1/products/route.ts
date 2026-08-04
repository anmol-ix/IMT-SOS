import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { createProduct, createProductFamily } from "@/server/create-product";
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

const variantSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: skuCode(4),
});

const bodySchema = z.object({
  productName: z.string().trim().min(2).max(180),
  category: z.string().trim().min(2).max(80),
  categoryCode: skuCode(3),
  subcategory: z.string().trim().min(2).max(80),
  subcategoryCode: skuCode(3),
  brand: optionalText(80),
  variantName: optionalText(80),
  variantCode: skuCode(4).optional(),
  variants: z.array(variantSchema).min(1).max(50).optional(),
  supplierBarcode: optionalText(120),
  unitOfMeasure: z.enum(PRODUCT_UNITS),
  packSize: z.number().int().min(1).max(100_000),
  rackLocation: z
    .string()
    .refine(isRackCode, "Choose a valid rack and shelf.")
    .nullable()
    .optional()
    .default(null),
  purchaseCostPaise: z.number().int().positive().max(100_000_000),
  standardPricePaise: z.number().int().positive().max(100_000_000),
  wholesalePricePaise: z.number().int().positive().max(100_000_000).optional(),
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
).refine(
  (value) => !value.variants || (!value.variantName && !value.variantCode),
  {
    message: "Use either one optional variant or the variants list, not both.",
    path: ["variants"],
  },
);

export async function POST(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    const commandId = z.string().uuid().parse(
      request.headers.get("idempotency-key"),
    );
    const body = bodySchema.parse(await request.json());
    if (body.variants) {
      const products = await createProductFamily(user, commandId, {
        ...body,
        variants: body.variants,
      });
      return json(
        { product: products[0], products },
        products.every((product) => product.replayed) ? 200 : 201,
        id,
      );
    }
    const product = await createProduct(user, commandId, body);
    return json({ product, products: [product] }, product.replayed ? 200 : 201, id);
  });
}
