import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { changeDeviceStatus } from "@/server/devices";
import { api, json } from "@/server/http";

const actionSchema = z.object({
  action: z.enum(["APPROVE", "REVOKE"]),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    const { id } = await context.params;
    const deviceId = z.string().uuid().parse(id);
    const { action } = actionSchema.parse(await request.json());
    const device = await changeDeviceStatus(user, deviceId, action);
    return json({ device }, 200, requestId);
  });
}
