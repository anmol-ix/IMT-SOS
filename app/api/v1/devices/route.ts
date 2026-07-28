import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { enrollDevice, listDevices } from "@/server/devices";
import { api, json } from "@/server/http";

const enrollmentSchema = z.object({
  devicePublicId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(120),
});

export async function GET(request: Request) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    return json({ devices: await listDevices(user) }, 200, requestId);
  });
}

export async function POST(request: Request) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser();
    const device = await enrollDevice(
      user,
      enrollmentSchema.parse(await request.json()),
    );
    return json({ device }, 200, requestId);
  });
}
