import "server-only";

import { Pool, type PoolClient } from "pg";
import { z } from "zod";

const globalForDatabase = globalThis as typeof globalThis & {
  itsMyToyPool?: Pool;
};

let databasePool = globalForDatabase.itsMyToyPool;

export function getDatabase(): Pool {
  if (databasePool) return databasePool;

  const databaseUrl = z.string().url().safeParse(process.env.DATABASE_URL);
  if (!databaseUrl.success) {
    throw new Error(
      "DATABASE_URL is required at runtime and must be a valid PostgreSQL connection URL.",
      { cause: databaseUrl.error },
    );
  }

  const poolMax = z.coerce.number().int().min(1).max(30).default(10).parse(
    process.env.DATABASE_POOL_MAX,
  );

  databasePool = new Pool({
    connectionString: databaseUrl.data,
    max: poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "itsmytoy-operations",
  });

  if (process.env.NODE_ENV !== "production") {
    globalForDatabase.itsMyToyPool = databasePool;
  }

  return databasePool;
}

export async function inTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getDatabase().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
