import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import {
  listGuestSaleApprovals,
  requestGuestSaleApproval,
} from "@/server/guest-sale-approvals";
import { api, json } from "@/server/http";

const lineSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  unitPricePaise: z.number().int().positive().max(100_000_000),
});

const bodySchema = z.object({
  saleCommandId: z.string().uuid(),
  lines: z.array(lineSchema).min(1).max(20).superRefine((lines, context) => {
    if (new Set(lines.map((line) => line.variantId)).size !== lines.length) {
      context.addIssue({ code: "custom", message: "Each product may appear only once." });
    }
  }),
});

export async function GET(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    return json({ approvals: await listGuestSaleApprovals(user) }, 200, id);
  });
}

export async function POST(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser(["TRUSTED_OPERATOR", "STORE_OPERATOR"]);
    const body = bodySchema.parse(await request.json());
    return json({ approval: await requestGuestSaleApproval(user, body) }, 201, id);
  });
}
