import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revokeCurrentSession } from "@/server/auth/session";
import { SESSION_COOKIE_NAME } from "@/shared/auth";

export async function POST() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  await revokeCurrentSession(token);
  const response = new NextResponse(null, {
    status: 303,
    headers: { location: "/sign-in" },
  });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
