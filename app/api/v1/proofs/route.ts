import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { api, json } from "@/server/http";
import { recordProofCommand } from "@/server/proof-command";

const bodySchema = z.object({
  note: z.string().trim().min(1).max(120),
});
const commandIdSchema = z.string().uuid();

export async function POST(request: Request) {
  return api(request, async (id) => {
    const user = await requireCurrentUser();
    const commandId = commandIdSchema.parse(request.headers.get("idempotency-key"));
    const input = bodySchema.parse(await request.json());
    const result = await recordProofCommand(user.id, commandId, input);
    return json({ proof: result }, 200, id);
  });
}
