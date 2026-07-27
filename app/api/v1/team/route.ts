import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { api, json } from "@/server/http";
import { inviteTeamMember, listTeamAccess } from "@/server/team-access";

const invitationSchema = z.object({
  email: z.string(),
  displayName: z.string().optional(),
  role: z.string(),
});

export async function GET(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    return json({ team: await listTeamAccess(user) }, 200, id);
  });
}

export async function POST(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    const invitation = await inviteTeamMember(
      user,
      invitationSchema.parse(await request.json()),
    );
    return json({ invitation }, 201, id);
  });
}
