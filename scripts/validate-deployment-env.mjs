import { z } from "zod";

const postgresUrl = z
  .string()
  .url()
  .refine(
    (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
    "must be a PostgreSQL connection URL",
  );

const deploymentSchema = z
  .object({
    DATABASE_URL: postgresUrl,
    MIGRATION_DATABASE_URL: postgresUrl,
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(30).default(10),
    DEPLOY_BOOTSTRAP_DATABASE_ROLES: z.enum(["0", "1"]).default("0"),
    DATABASE_ADMIN_URL: postgresUrl.optional(),
    RUNTIME_DATABASE_ROLE: z
      .string()
      .regex(/^[a-z_][a-z0-9_]{0,62}$/)
      .default("itsmytoy_runtime"),
    RUNTIME_DATABASE_PASSWORD: z.string().min(24).optional(),
    MIGRATION_DATABASE_ROLE: z
      .string()
      .regex(/^[a-z_][a-z0-9_]{0,62}$/)
      .default("itsmytoy_migrator"),
    MIGRATION_DATABASE_PASSWORD: z.string().min(24).optional(),
  })
  .superRefine((value, context) => {
    if (value.DEPLOY_BOOTSTRAP_DATABASE_ROLES !== "1") return;

    for (const key of [
      "DATABASE_ADMIN_URL",
      "RUNTIME_DATABASE_PASSWORD",
      "MIGRATION_DATABASE_PASSWORD",
    ]) {
      if (!value[key]) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "is required while database-role bootstrap is enabled",
        });
      }
    }
  });

const parsed = deploymentSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Railway deployment configuration is incomplete:");
  for (const issue of parsed.error.issues) {
    console.error(`- ${issue.path.join(".") || "environment"}: ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  const runtimeRole = new URL(parsed.data.DATABASE_URL).username;
  const migrationRole = new URL(parsed.data.MIGRATION_DATABASE_URL).username;

  if (!runtimeRole || !migrationRole || runtimeRole === migrationRole) {
    console.error(
      "Railway deployment configuration is unsafe: DATABASE_URL and "
      + "MIGRATION_DATABASE_URL must use different database roles.",
    );
    process.exitCode = 1;
  } else {
    console.log("Railway deployment environment is valid.");
  }
}
