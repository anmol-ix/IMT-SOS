import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  return NextResponse.redirect(await getSignInUrl());
}
