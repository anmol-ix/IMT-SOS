import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { api, json } from "@/server/http";
import {
  listPriceApprovals,
  requestPriceApproval,
} from "@/server/price-approvals";

const requestSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  requestedUnitPricePaise: z.number().int().positive().max(100_000_000),
});

export async function GET(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    return json({ approvals: await listPriceApprovals(user) }, 200, id);
  });
}

export async function POST(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser();
    const body = requestSchema.parse(await request.json());
    const approval = await requestPriceApproval(user, body);
    return json({ approval }, 201, id);
  });
}
