import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { inTransaction } from "@/server/database";

export type ProofResult = {
  commandId: string;
  note: string;
  acceptedAt: string;
};

export class IdempotencyConflictError extends Error {
  readonly status = 409;
  readonly code = "IDEMPOTENCY_CONFLICT";

  constructor() {
    super("This idempotency key was already used for a different request.");
    this.name = "IdempotencyConflictError";
  }
}

function hashRequest(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export async function recordProofCommand(
  actorUserId: string,
  commandId: string,
  input: { note: string },
  transaction: <T>(work: (client: PoolClient) => Promise<T>) => Promise<T> = inTransaction,
): Promise<ProofResult> {
  const requestHash = hashRequest(input);

  return transaction(async (client) => {
    const inserted = await client.query<{ result_json: ProofResult }>(
      `INSERT INTO walking_skeleton_commands
         (command_id, actor_user_id, request_hash, result_json)
       VALUES (
         $1::uuid,
         $2::uuid,
         $3::text,
         jsonb_build_object(
           'commandId', $1::text,
           'note', $4::text,
           'acceptedAt', transaction_timestamp()::text
         )
       )
       ON CONFLICT (command_id) DO NOTHING
       RETURNING result_json`,
      [commandId, actorUserId, requestHash, input.note],
    );

    if (inserted.rows[0]) return inserted.rows[0].result_json;

    const existing = await client.query<{
      actor_user_id: string;
      request_hash: string;
      result_json: ProofResult;
    }>(
      `SELECT actor_user_id, request_hash, result_json
         FROM walking_skeleton_commands
        WHERE command_id = $1`,
      [commandId],
    );
    const prior = existing.rows[0];
    if (
      !prior ||
      prior.actor_user_id !== actorUserId ||
      prior.request_hash !== requestHash
    ) {
      throw new IdempotencyConflictError();
    }
    return prior.result_json;
  });
}
