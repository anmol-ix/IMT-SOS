# ItsMyToy Walking-Skeleton Operations

## Non-production deployment gate

Use a separate Railway staging environment and PostgreSQL service. Use only synthetic data.

Use [the Railway staging deployment guide](./docs/RAILWAY_DEPLOYMENT.md) for
the exact service variables and first-deployment sequence.

1. In Railway, place the application and PostgreSQL service in Singapore. Use the PostgreSQL private-network URL between services.
2. Generate different strong passwords for `itsmytoy_migrator` and `itsmytoy_runtime`.
3. Supply the PostgreSQL service’s administrative URL only to a controlled one-off role-setup job. Run `npm run db:roles`.
4. Construct `MIGRATION_DATABASE_URL` for the migration role and run `npm run db:migrate` as a deployment job.
5. Supply only the restricted `DATABASE_URL` and `DATABASE_POOL_MAX=10` to the running application service.
6. Create the owner’s one-time password link with `npm run auth:create-setup-link -- owner@example.com`.
7. Deploy and verify `/api/v1/health/live` and `/api/v1/health/ready` return HTTP 200 with an `x-request-id` header.
8. Confirm an unknown email cannot sign in and the intended owner returns the internal `BUSINESS_OWNER` role.
9. Confirm a store operator receives 403 from `/api/v1/owner/proof` while the owner receives 200.
10. Send the same valid `POST /api/v1/proofs` request repeatedly with one UUID `Idempotency-Key`; confirm every response is identical and the database contains one command row.

For the local staging access check, run
`npm run security:prove-operator-denial` with explicit test database URLs. It
proves one-time activation, runtime-role restrictions, operator controls,
session revocation on disable and owner-account protection.

Do not import the workbook or real customer details during this gate.

## PITR restore rehearsal

Railway point-in-time recovery must be enabled before any real business data are imported. A configured backup is not accepted until a restore has succeeded.

1. Enable PITR on the staging PostgreSQL service and record its retention setting.
2. Insert a synthetic marker through a controlled database session and record the UTC timestamp.
3. Change or remove the marker, then restore to a point immediately after its original insertion.
4. Railway creates a sibling PostgreSQL service. Do not point the application at it yet.
5. Connect to the restored sibling with an isolated validation credential. Confirm the migration version, marker, row counts and constraints.
6. Run the integration suite against the restored database.
7. Record restore start/end times, recovery point, validation results and the exact connection cutover/rollback steps.
8. Delete the synthetic restored service only after the evidence has been retained and no application points to it.

For a real incident, preserve the original database, stop writes if consistency requires it, restore into a sibling, validate, then explicitly change the application connection. Never overwrite the original service blindly.

## Performance and cost evidence

For at least seven representative staging days, record:

- liveness and readiness latency from the shop’s Wi-Fi, Airtel and Jio connections;
- application CPU/memory, PostgreSQL CPU/memory/storage and connection count;
- egress, volume and PITR archive usage;
- Railway’s projected monthly total.

The accepted targets are under 300 ms for an ordinary online query, under 700 ms for a sale command, under 2 seconds for a dashboard and under 1.5 seconds for repeat launch. The walking skeleton can measure infrastructure overhead, but it cannot claim sale or offline-sync performance before those features exist.

## Incident minimums

- Treat readiness failures, authentication bypass, repeated idempotency conflicts and database exhaustion as actionable alerts.
- Logs must remain structured and must not contain passwords, cookies, tokens, authorization headers or customer details.
- Roll back application code only when it remains compatible with the migrated schema. Use forward fixes for incompatible schema changes.
- Do not grant the runtime role schema creation, user administration, or update/delete rights on append-only stock and audit records.
