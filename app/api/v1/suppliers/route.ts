import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { createSupplier, listSuppliers } from "@/server/suppliers";
import { api, json } from "@/server/http";

const phoneSchema = z
  .string()
  .transform((value) => value.replace(/\D/g, ""))
  .pipe(z.string().regex(/^[0-9]{10,15}$/, "Enter a valid phone number."));

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: phoneSchema.optional(),
  notes: z.string().trim().min(1).max(500).optional(),
});

export async function GET(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER", "TRUSTED_OPERATOR"]);
    return json({ suppliers: await listSuppliers(user) }, 200, id);
  });
}

export async function POST(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER", "TRUSTED_OPERATOR"]);
    const supplier = await createSupplier(user, createSchema.parse(await request.json()));
    return json({ supplier }, 201, id);
  });
}
