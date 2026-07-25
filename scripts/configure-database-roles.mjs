import pg from "pg";
import { z } from "zod";

const config = z
  .object({
    DATABASE_ADMIN_URL: z.string().url(),
    RUNTIME_DATABASE_ROLE: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/).default("itsmytoy_runtime"),
    RUNTIME_DATABASE_PASSWORD: z.string().min(24),
    MIGRATION_DATABASE_ROLE: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/).default("itsmytoy_migrator"),
    MIGRATION_DATABASE_PASSWORD: z.string().min(24),
  })
  .parse(process.env);

const client = new pg.Client({ connectionString: config.DATABASE_ADMIN_URL });

async function ensureLoginRole(role, password) {
  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
  const verb = exists.rowCount ? "ALTER" : "CREATE";
  const statement = await client.query(
    `SELECT format('${verb} ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS sql`,
    [role, password],
  );
  await client.query(statement.rows[0].sql);
}

try {
  await client.connect();
  await ensureLoginRole(config.RUNTIME_DATABASE_ROLE, config.RUNTIME_DATABASE_PASSWORD);
  await ensureLoginRole(config.MIGRATION_DATABASE_ROLE, config.MIGRATION_DATABASE_PASSWORD);

  const databaseName = (await client.query("SELECT current_database() AS name")).rows[0].name;
  for (const role of [config.RUNTIME_DATABASE_ROLE, config.MIGRATION_DATABASE_ROLE]) {
    const grant = await client.query(
      "SELECT format('GRANT CONNECT ON DATABASE %I TO %I', $1::text, $2::text) AS sql",
      [databaseName, role],
    );
    await client.query(grant.rows[0].sql);
  }
  const schemaGrant = await client.query(
    "SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', $1::text) AS sql",
    [config.MIGRATION_DATABASE_ROLE],
  );
  await client.query(schemaGrant.rows[0].sql);
  console.info(JSON.stringify({ event: "database_roles_configured" }));
} finally {
  await client.end();
}
