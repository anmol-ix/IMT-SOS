import "server-only";

import { Pool, type PoolClient } from "pg";
import { z } from "zod";

const databaseUrl = z.string().url().parse(process.env.DATABASE_URL);
const poolMax = z.coerce.number().int().min(1).max(30).default(10).parse(
  process.env.DATABASE_POOL_MAX,
);

const globalForDatabase = globalThis as typeof globalThis & {
  itsMyToyPool?: Pool;
};

export const database =
  globalForDatabase.itsMyToyPool ??
  new Pool({
    connectionString: databaseUrl,
    max: poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "itsmytoy-operations",
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.itsMyToyPool = database;
}

export async function inTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await database.connect();
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
