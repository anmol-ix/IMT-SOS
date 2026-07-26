import "server-only";

import { z } from "zod";

const redirectUriSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:"
      || url.hostname === "localhost"
      || url.hostname === "127.0.0.1"
    );
  }, "WORKOS_REDIRECT_URI must use HTTPS outside local development")
  .refine(
    (value) => new URL(value).pathname === "/auth/callback",
    "WORKOS_REDIRECT_URI must end with /auth/callback",
  );

export function getWorkOSRedirectUri(): string {
  const redirectUri =
    process.env.WORKOS_REDIRECT_URI
    ?? process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI;

  const parsed = redirectUriSchema.safeParse(redirectUri);
  if (!parsed.success) {
    throw new Error(
      "WORKOS_REDIRECT_URI is required at runtime and must match the "
      + "configured WorkOS callback URL.",
      { cause: parsed.error },
    );
  }

  return parsed.data;
}
