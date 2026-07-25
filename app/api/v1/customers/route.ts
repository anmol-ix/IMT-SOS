import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { createCustomer, normalizePhone, searchCustomers } from "@/server/customers";
import { api, json } from "@/server/http";

const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .pipe(z.string().regex(/^[0-9]{10,15}$/, "Enter a valid phone number."));

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: phoneSchema,
  locality: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(254).optional(),
});

export async function GET(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser();
    const query = z.string().trim().max(120).parse(new URL(request.url).searchParams.get("q") ?? "");
    return json({ customers: await searchCustomers(user, query) }, 200, id);
  });
}

export async function POST(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser();
    const body = createSchema.parse(await request.json());
    return json({ customer: await createCustomer(user, body) }, 201, id);
  });
}
