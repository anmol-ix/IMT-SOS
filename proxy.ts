import { authkitProxy } from "@workos-inc/authkit-nextjs";
import type { NextFetchEvent, NextRequest } from "next/server";
import { getWorkOSRedirectUri } from "@/server/auth/workos-config";

let authkitHandler: ReturnType<typeof authkitProxy> | undefined;

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  authkitHandler ??= authkitProxy({
    redirectUri: getWorkOSRedirectUri(),
  });
  return authkitHandler(request, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icon.svg|icon-192.png|icon-512.png|apple-touch-icon.png|api/v1/health/live|api/v1/health/ready).*)",
  ],
};
