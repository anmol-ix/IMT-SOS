import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { api, json } from "@/server/http";
import { resolveOfflineSaleConflict } from "@/server/offline-sale-conflicts";

const decisionSchema = z.object({
  action: z.enum(["CONFIRM_SALE", "NOT_SOLD"]),
  note: z.string().trim().min(3).max(500),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return api(request, async (requestId) => {
    const owner = await requireCurrentUser(["BUSINESS_OWNER"]);
    const { id } = await context.params;
    const conflictId = z.string().uuid().parse(id);
    const body = decisionSchema.parse(await request.json());
    const result = await resolveOfflineSaleConflict(owner, conflictId, body);
    return json(result, 200, requestId);
  });
}
