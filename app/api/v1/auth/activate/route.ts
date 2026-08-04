import { NextResponse } from "next/server";
import { z } from "zod";
import {
  activateAccount,
  InvalidSetupLinkError,
  sessionCookieOptions,
} from "@/server/auth/session";
import { MINIMUM_PASSWORD_LENGTH } from "@/server/auth/password";
import { SESSION_COOKIE_NAME } from "@/shared/auth";

const activationSchema = z.object({
  token: z.string().min(32).max(200),
  password: z.string().min(MINIMUM_PASSWORD_LENGTH).max(200),
  confirmPassword: z.string().max(200),
});

export async function POST(request: Request) {
  const form = await request.formData();
  const token = form.get("token")?.toString() ?? "";
  const parsed = activationSchema.safeParse(Object.fromEntries(form));

  if (!parsed.success) {
    return new NextResponse(null, {
      status: 303,
      headers: {
        location: `/activate?error=password&token=${encodeURIComponent(token)}`,
      },
    });
  }
  if (parsed.data.password !== parsed.data.confirmPassword) {
    return new NextResponse(null, {
      status: 303,
      headers: {
        location: `/activate?error=mismatch&token=${encodeURIComponent(token)}`,
      },
    });
  }

  try {
    const { token: sessionToken } = await activateAccount(
      parsed.data.token,
      parsed.data.password,
    );
    const response = new NextResponse(null, {
      status: 303,
      headers: { location: "/" },
    });
    response.cookies.set(
      SESSION_COOKIE_NAME,
      sessionToken,
      sessionCookieOptions,
    );
    return response;
  } catch (error) {
    if (!(error instanceof InvalidSetupLinkError)) throw error;
    return new NextResponse(null, {
      status: 303,
      headers: {
        location: `/activate?error=invalid&token=${encodeURIComponent(token)}`,
      },
    });
  }
}
