import pg from "pg";
import { z } from "zod";

const config = z
  .object({
    MIGRATION_DATABASE_URL: z.string().url(),
    BUSINESS_NAME: z.string().trim().min(1).max(120).default("ItsMyToy"),
    WORKOS_USER_ID: z.string().trim().min(1),
    OWNER_DISPLAY_NAME: z.string().trim().min(1).max(120),
  })
  .parse(process.env);

const client = new pg.Client({ connectionString: config.MIGRATION_DATABASE_URL });

await client.connect();
try {
  await client.query("BEGIN");
  const business = await client.query(
    `INSERT INTO businesses (name)
     VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [config.BUSINESS_NAME],
  );
  await client.query(
    `INSERT INTO app_users
       (business_id, workos_user_id, display_name, role, status)
     VALUES ($1, $2, $3, 'BUSINESS_OWNER', 'ACTIVE')
     ON CONFLICT (workos_user_id) DO UPDATE SET
       business_id = EXCLUDED.business_id,
       display_name = EXCLUDED.display_name,
       role = 'BUSINESS_OWNER',
       status = 'ACTIVE',
       updated_at = now()`,
    [business.rows[0].id, config.WORKOS_USER_ID, config.OWNER_DISPLAY_NAME],
  );
  await client.query("COMMIT");
  console.info(JSON.stringify({ event: "staging_owner_provisioned" }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
