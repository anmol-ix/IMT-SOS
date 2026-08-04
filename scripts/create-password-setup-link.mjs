import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { z } from "zod";

const config = z.object({
  DATABASE_ADMIN_URL: z.string().url().optional(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  APP_BASE_URL: z.string().url().default("http://127.0.0.1:4173"),
  BUSINESS_NAME: z.string().trim().min(1).max(120).default("ItsMyToy"),
  OWNER_DISPLAY_NAME: z.string().trim().min(1).max(120).optional(),
}).refine(
  (value) => value.DATABASE_ADMIN_URL || value.MIGRATION_DATABASE_URL,
  "DATABASE_ADMIN_URL or MIGRATION_DATABASE_URL is required",
).parse(process.env);

const requestedEmail = process.argv[2]?.trim().toLowerCase();
const client = new pg.Client({
  connectionString: config.DATABASE_ADMIN_URL ?? config.MIGRATION_DATABASE_URL,
});

try {
  await client.connect();
  await client.query("BEGIN");
  let user = await client.query(
    requestedEmail
      ? `SELECT id, email, display_name
           FROM app_users
          WHERE lower(email) = $1
          LIMIT 1
          FOR UPDATE`
      : `SELECT id, email, display_name
           FROM app_users
          WHERE role = 'BUSINESS_OWNER' AND status = 'ACTIVE'
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE`,
    requestedEmail ? [requestedEmail] : [],
  );
  if (!user.rows[0] && requestedEmail) {
    const count = await client.query("SELECT count(*)::int AS count FROM app_users");
    if (count.rows[0].count !== 0) {
      throw new Error("No matching app user was found.");
    }
    const business = await client.query(
      `INSERT INTO businesses (name)
       VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [config.BUSINESS_NAME],
    );
    user = await client.query(
      `INSERT INTO app_users (
         business_id, email, display_name, role, status
       )
       VALUES ($1, $2, $3, 'BUSINESS_OWNER', 'ACTIVE')
       RETURNING id, email, display_name`,
      [
        business.rows[0].id,
        requestedEmail,
        config.OWNER_DISPLAY_NAME ?? requestedEmail.split("@")[0],
      ],
    );
  }
  if (!user.rows[0]) throw new Error("No matching app user was found.");
  if (!user.rows[0].email) {
    throw new Error("The selected app user does not have an email address.");
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await client.query(
    `UPDATE auth_setup_tokens
        SET used_at = now()
      WHERE user_id = $1 AND used_at IS NULL`,
    [user.rows[0].id],
  );
  await client.query(
    `INSERT INTO auth_setup_tokens (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + interval '1 day')`,
    [tokenHash, user.rows[0].id],
  );
  await client.query("COMMIT");

  const link = new URL("/activate", config.APP_BASE_URL);
  link.searchParams.set("token", token);
  console.log(JSON.stringify({
    user: user.rows[0].display_name,
    email: user.rows[0].email,
    expiresIn: "24 hours",
    setupLink: link.toString(),
  }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
