import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import {
  decideGuestSaleApproval,
  getGuestSaleApproval,
} from "@/server/guest-sale-approvals";
import { api, json } from "@/server/http";

const decisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().min(1).max(500).optional(),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser();
    const approvalId = z.string().uuid().parse((await context.params).id);
    return json({ approval: await getGuestSaleApproval(user, approvalId) }, 200, requestId);
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    const approvalId = z.string().uuid().parse((await context.params).id);
    const body = decisionSchema.parse(await request.json());
    return json(
      { approval: await decideGuestSaleApproval(user, approvalId, body) },
      200,
      requestId,
    );
  });
}
