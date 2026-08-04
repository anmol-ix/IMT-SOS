import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/shared/auth";

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic =
    pathname === "/sign-in"
    || pathname === "/activate"
    || pathname.startsWith("/api/v1/auth/")
    || pathname.startsWith("/api/v1/health/");
  const isPage = !pathname.startsWith("/api/");

  if (isPage && !isPublic && !request.cookies.has(SESSION_COOKIE_NAME)) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/sign-in";
    signIn.search = "";
    signIn.searchParams.set("returnTo", `${pathname}${search}`);
    return NextResponse.redirect(signIn);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|offline.html|manifest.webmanifest|icon.svg|icon-192.png|icon-512.png|apple-touch-icon.png|api/v1/health/live|api/v1/health/ready).*)",
  ],
};
