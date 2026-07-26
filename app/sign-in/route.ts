import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { getWorkOSRedirectUri } from "@/server/auth/workos-config";

export async function GET(): Promise<NextResponse> {
  return NextResponse.redirect(
    await getSignInUrl({ redirectUri: getWorkOSRedirectUri() }),
  );
}
