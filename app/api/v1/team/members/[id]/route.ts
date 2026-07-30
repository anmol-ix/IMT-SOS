import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { api, json } from "@/server/http";
import {
  changeTeamMemberAccess,
  createMemberPasswordSetup,
} from "@/server/team-access";

const accessSchema = z.object({
  role: z.string(),
  status: z.string(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    const { id } = await context.params;
    const member = await changeTeamMemberAccess(
      user,
      id,
      accessSchema.parse(await request.json()),
    );
    return json({ member }, 200, requestId);
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    const { id } = await context.params;
    return json(
      await createMemberPasswordSetup(user, id),
      200,
      requestId,
    );
  });
}
