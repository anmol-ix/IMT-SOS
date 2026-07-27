import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { api, json } from "@/server/http";
import {
  resendTeamInvitation,
  revokeTeamInvitation,
} from "@/server/team-access";

const actionSchema = z.object({
  action: z.enum(["RESEND", "REVOKE"]),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    const { id } = await context.params;
    const { action } = actionSchema.parse(await request.json());
    if (action === "RESEND") {
      const invitation = await resendTeamInvitation(user, id);
      return json({ invitation }, 200, requestId);
    }
    await revokeTeamInvitation(user, id);
    return json({ revoked: true }, 200, requestId);
  });
}
