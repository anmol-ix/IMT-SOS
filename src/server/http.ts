import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

type KnownError = Error & { status?: number; code?: string };

const SENSITIVE_KEYS = /authorization|cookie|password|secret|token/i;

function redact(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redact(item),
    ]),
  );
}

export function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && /^[A-Za-z0-9._-]{8,100}$/.test(supplied)
    ? supplied
    : randomUUID();
}

export function log(
  level: "info" | "error",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const entry = JSON.stringify(
    redact({ timestamp: new Date().toISOString(), level, event, ...fields }),
  );
  if (level === "error") console.error(entry);
  else console.info(entry);
}

export function json(
  body: unknown,
  status: number,
  currentRequestId: string,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-request-id": currentRequestId,
    },
  });
}

export async function api(
  request: Request,
  handler: (currentRequestId: string) => Promise<NextResponse>,
): Promise<NextResponse> {
  const id = requestId(request);
  const started = performance.now();
  try {
    const response = await handler(id);
    log("info", "http_request", {
      requestId: id,
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
    });
    return response;
  } catch (error) {
    const known = error as KnownError;
    const status = error instanceof ZodError ? 400 : (known.status ?? 500);
    const code =
      error instanceof ZodError ? "INVALID_REQUEST" : (known.code ?? "INTERNAL_ERROR");
    log("error", "http_request_failed", {
      requestId: id,
      method: request.method,
      path: new URL(request.url).pathname,
      status,
      code,
      errorName: known.name,
      durationMs: Math.round(performance.now() - started),
    });
    return json(
      {
        error: {
          code,
          message: status === 500 ? "The request could not be completed." : known.message,
        },
      },
      status,
      id,
    );
  }
}
