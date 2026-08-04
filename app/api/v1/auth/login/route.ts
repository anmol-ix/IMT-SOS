import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticateWithPassword,
  InvalidCredentialsError,
  safeReturnPath,
  sessionCookieOptions,
} from "@/server/auth/session";
import { SESSION_COOKIE_NAME } from "@/shared/auth";

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
  returnTo: z.string().optional(),
});

export async function POST(request: Request) {
  const form = await request.formData();
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  const returnTo = safeReturnPath(
    parsed.success ? parsed.data.returnTo : form.get("returnTo")?.toString(),
  );

  if (!parsed.success) {
    return new NextResponse(null, {
      status: 303,
      headers: {
        location: `/sign-in?error=invalid&returnTo=${encodeURIComponent(returnTo)}`,
      },
    });
  }

  try {
    const { token } = await authenticateWithPassword(
      parsed.data.email,
      parsed.data.password,
    );
    const response = new NextResponse(null, {
      status: 303,
      headers: { location: returnTo },
    });
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
    return response;
  } catch (error) {
    if (!(error instanceof InvalidCredentialsError)) throw error;
    return new NextResponse(null, {
      status: 303,
      headers: {
        location: `/sign-in?error=invalid&returnTo=${encodeURIComponent(returnTo)}`,
      },
    });
  }
}
