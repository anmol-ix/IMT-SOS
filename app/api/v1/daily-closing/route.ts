import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import {
  DAILY_CLOSING_CORRECTION_REASONS,
  getDailyClosingView,
  recordDailyClosing,
} from "@/server/daily-closing";
import { api, json } from "@/server/http";

const money = z.number().int().min(0).max(1_000_000_000);
const optionalNote = z.string().trim().min(3).max(500).optional();
const closingSchema = z.object({
  openingCashPaise: money,
  cashPaidInPaise: money,
  cashPaidOutPaise: money,
  countedCashPaise: money,
  verifiedDigitalPayments: z.object({
    UPI: money,
    CARD: money,
    BANK_TRANSFER: money,
  }),
  cashMovementNote: optionalNote,
  varianceNote: optionalNote,
  closingNote: optionalNote,
  replacesClosingId: z.string().uuid().optional(),
  correctionReason: z.enum(DAILY_CLOSING_CORRECTION_REASONS).optional(),
  correctionNote: optionalNote,
});

export async function GET(request: Request) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    return json(
      { closing: await getDailyClosingView(user) },
      200,
      requestId,
    );
  });
}

export async function POST(request: Request) {
  return api(request, async (requestId) => {
    const user = await requireCurrentUser(["BUSINESS_OWNER"]);
    const commandId = z.string().uuid().parse(
      request.headers.get("idempotency-key"),
    );
    const closing = await recordDailyClosing(
      user,
      commandId,
      closingSchema.parse(await request.json()),
    );
    return json(
      { closing },
      closing.replayed ? 200 : 201,
      requestId,
    );
  });
}
