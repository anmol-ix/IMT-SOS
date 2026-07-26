import { handleAuth } from "@workos-inc/authkit-nextjs";
import type { NextRequest } from "next/server";
import { getWorkOSRedirectUri } from "@/server/auth/workos-config";

export async function GET(request: NextRequest) {
  const baseURL = new URL(getWorkOSRedirectUri()).origin;
  return handleAuth({ returnPathname: "/", baseURL })(request);
}
