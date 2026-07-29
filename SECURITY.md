# Security Status

## Enforced in the walking skeleton

- WorkOS handles the hosted identity session; internal access still requires a
  verified email with an active user or pending application invitation.
- On an empty installation, the first verified WorkOS user becomes owner under
  a database lock. Once any application user or pending invitation exists,
  later access requires the owner-only Team & Access screen.
- The runtime database role cannot insert or update users directly. It receives
  execute permission only on narrow security-definer functions for claiming an
  invitation, inviting an operator, changing operator access and revoking an
  invitation.
- Owner self-demotion and self-disable are rejected in PostgreSQL, and every
  invitation, acceptance, role change, disable and revocation writes an
  append-only audit event.
- The three roles are `BUSINESS_OWNER`, `TRUSTED_OPERATOR` and `STORE_OPERATOR`.
- Owner policy is enforced in server code and has explicit negative tests for both operator roles.
- Product identity and initial pricing are owner-only; trusted and ordinary
  operators receive a server-side `403` and cannot create SKUs or barcodes.
- Product creation is idempotent, generated SKUs and normalized barcodes are
  database-unique, and rack codes are constrained to the accepted shop layout.
- Existing-product price and rack changes are owner-only, UUID-idempotent and
  require a controlled reason. Their audit evidence stores immutable previous
  and current values.
- Repricing closes the previous price version instead of overwriting it, expires
  pending approvals tied to that version and leaves historical sale-line price
  and costing snapshots unchanged.
- Rack changes update controlled product metadata without writing an inventory
  movement or changing sellable, open-box or damaged balances.
- Store operators cannot request or apply stock adjustments. Trusted operators
  may submit a physical count, while only a business owner may approve and
  atomically apply its exact difference.
- The daily control dashboard is an owner-only, read-only server projection.
  Both operator roles receive a server-side `403`; seller names and owner
  profit/cost summaries are never exposed through the operator route.
- The dashboard reports operational aggregates and product exceptions without
  customer names, phone numbers or other customer-identifying data.
- Reorder policies are owner-only. Both operator roles receive a server-side
  `403`; owners must provide a controlled reason and note, and the server
  requires the restock target to be greater than the reorder point.
- Reorder changes are UUID-idempotent and store immutable previous/current
  values. The runtime role may update only the policy columns on a variant and
  may not update or delete the append-only policy-change record.
- A reorder policy changes neither inventory balances nor inventory movements.
  Never-configured policies remain visible to the owner instead of silently
  receiving a default threshold.
- Daily closing is owner-only and the API denies both operator roles. Expected
  sales/payment totals are calculated server-side; the browser cannot submit
  replacement expectations.
- Closing commands are UUID-idempotent and request-bound. Closing rows and their
  digital-payment comparisons are append-only for the runtime database role.
  Corrections create linked revisions instead of updating prior evidence.
- Cash movements and variances require controlled explanations. Audit events
  store amounts, variance results, revision links and owner identity without
  copying unrestricted notes.
- Count requests bind the recorded quantity and balance version. Any intervening
  sale, receipt or adjustment makes the request stale instead of applying an
  outdated correction.
- Adjustment requests and decisions use UUID idempotency keys, controlled
  reasons, notes, requester/approver identities and immutable audit evidence.
- The runtime database role may select and insert append-only inventory
  movements, but still has no update or delete privilege on the movement ledger.
- Browser code never receives PostgreSQL credentials.
- Runtime and migration database credentials are separate; runtime grants are tested.
- Idempotency keys are UUIDs and are bound to both the actor and request content.
- Logs redact keys that look like credentials, cookies, authorization values, secrets or tokens.
- Responses use no-store caching and baseline browser security headers.
- WorkOS staging now requires MFA for non-SSO users and does not allow public self-sign-up.
- Live staging checks passed for Google sign-in, MFA, session revocation, owner authorization and store-operator denial.
- Workbook validation is owner-only, hash-bound and append-only for the runtime
  role. It stores source coordinates, normalized rows and exceptions without
  granting any live product, customer, sale or stock import capability.
- Child name, birthday and age are redacted before staging and are not included
  in Phase 1 normalized customer data.
- Production workbook uploads remain disabled unless
  `WORKBOOK_VALIDATION_ENABLED=1`; enable it only after the backup/restore gate
  is approved.

## Open external proofs before business-feature work

- WorkOS provider-outage and failed-provider behavior still require a controlled staging exercise.
- Railway staging deployment, Singapore colocation, private networking, PITR restore and seven-day cost evidence require a valid Railway login and project access.
- High and critical production advisories fail CI. Until the latest stable
  Next.js package repins its transitive PostCSS and Sharp dependencies, the
  application explicitly overrides them to the current patched releases. The
  complete audit, build and browser checks must pass whenever those overrides
  change, and they should be removed once Next.js carries equivalent versions.

Do not place real workbook or customer data in development, CI or staging.
