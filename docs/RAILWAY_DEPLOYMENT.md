# Railway Staging Deployment

This guide deploys the ItsMyToy Operations application from GitHub to an
isolated Railway staging environment. Use synthetic data only. Do not import
the business workbook or real customer information during this stage.

## What the repository handles

- Railpack installs dependencies and runs `npm run build`.
- The build does not connect to PostgreSQL or require deployment secrets.
- Before the application starts, Railway runs `npm run deploy:prepare`.
- The pre-deploy command validates every required variable, optionally creates
  the restricted database roles on the first deployment, and applies migrations.
- The server binds to `0.0.0.0` and Railway's assigned `PORT`.
- Railway sends traffic only after `/api/v1/health/ready` confirms that the
  restricted runtime role can reach PostgreSQL.

## 1. Create the staging services

1. Keep the GitHub-connected `IMT-SOS` application service.
2. Add a Railway PostgreSQL service in the same project and environment.
3. Use Railway's Singapore region for both services.
4. Generate a public domain for the application service.
5. Keep the database on Railway's private network. The application should use
   the PostgreSQL service's private host variables, not its public TCP proxy.

The examples below assume the database service is named `Postgres`. If Railway
shows a different service name, replace `Postgres` in every reference.

## 2. Prepare WorkOS staging

In the WorkOS staging application, add:

```text
https://<your-railway-domain>/auth/callback
```

Set the same application origin as the WorkOS default logout URI. Keep public
self-sign-up disabled and keep MFA required.

## 3. Generate database-role passwords

Generate two different hexadecimal secrets locally:

```text
openssl rand -hex 32
openssl rand -hex 32
```

Use one for `itsmytoy_runtime` and the other for `itsmytoy_migrator`.
Hexadecimal values are used so the passwords can be embedded in PostgreSQL URLs
without URL-encoding mistakes.

## 4. Add first-deployment variables

Add these variables to the Railway application service. Railway reference
variables keep the database hostname and database name synchronized with the
PostgreSQL service.

```text
DATABASE_URL=postgresql://itsmytoy_runtime:<runtime-password>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
MIGRATION_DATABASE_URL=postgresql://itsmytoy_migrator:<migration-password>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
DATABASE_POOL_MAX=10

WORKOS_API_KEY=<WorkOS-staging-API-key>
WORKOS_CLIENT_ID=<WorkOS-staging-client-ID>
WORKOS_COOKIE_PASSWORD=<at-least-32-random-characters>
WORKOS_REDIRECT_URI=https://<your-railway-domain>/auth/callback

DEPLOY_BOOTSTRAP_DATABASE_ROLES=1
DATABASE_ADMIN_URL=${{Postgres.DATABASE_URL}}
RUNTIME_DATABASE_ROLE=itsmytoy_runtime
RUNTIME_DATABASE_PASSWORD=<runtime-password>
MIGRATION_DATABASE_ROLE=itsmytoy_migrator
MIGRATION_DATABASE_PASSWORD=<migration-password>
```

Do not commit any of these values to GitHub.

## 5. Run the first deployment

Deploy the latest GitHub `main` branch. The expected sequence is:

1. `npm ci`
2. `npm run build`
3. deployment-variable validation
4. restricted database-role bootstrap
5. schema migrations
6. application start
7. readiness check

The deployment is accepted only when the readiness endpoint returns HTTP 200.

## 6. Remove administrative access

Immediately after the first successful deployment:

1. Set `DEPLOY_BOOTSTRAP_DATABASE_ROLES=0`.
2. Remove `DATABASE_ADMIN_URL`.
3. Remove `RUNTIME_DATABASE_PASSWORD`.
4. Remove `MIGRATION_DATABASE_PASSWORD`.
5. Redeploy and confirm the deployment still succeeds.

Keep `MIGRATION_DATABASE_URL` because the isolated pre-deploy container needs it
for future schema migrations. The running application uses only `DATABASE_URL`.

## 7. Verify the staging service

Confirm:

```text
GET https://<your-railway-domain>/api/v1/health/live
GET https://<your-railway-domain>/api/v1/health/ready
```

Both must return HTTP 200 and include an `x-request-id` response header.

Then:

1. Complete WorkOS staging sign-in and MFA.
2. Confirm an unprovisioned identity receives application access denied.
3. Provision the intended staging owner using the controlled migration
   credential.
4. Confirm the owner dashboard loads.
5. Confirm a store operator cannot access owner-only endpoints.

Do not treat a green deployment as permission to import real data. PITR restore,
private-network evidence, latency measurement, owner/operator acceptance and the
workbook migration rehearsal remain separate gates.

## Failure meanings

- Build-time Zod error: the deployed commit predates the runtime-only database
  initialization fix.
- Pre-deploy configuration error: one or more Railway variables are missing or
  malformed.
- Role bootstrap error: the temporary administrative URL or role passwords are
  incorrect.
- Migration error: the migration URL cannot reach PostgreSQL or lacks migration
  privileges.
- Readiness HTTP 503: the application started, but its restricted runtime
  database URL is missing, invalid or unreachable.
- WorkOS redirect error: the Railway callback URL does not exactly match both
  the Railway variable and the WorkOS staging redirect entry.
