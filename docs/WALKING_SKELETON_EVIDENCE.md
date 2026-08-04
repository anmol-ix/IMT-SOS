# Walking-Skeleton Evidence

Evidence date: 30 July 2026

## Passed locally

- Node.js 22.17 and PostgreSQL 16 were used.
- Lint and strict TypeScript checks passed.
- The optimized Next.js production build passed.
- Fifty-nine unit tests passed, including password authentication, role denial,
  exceptional-price policy and controlled-reason validation.
- The initial migration succeeded on an empty real PostgreSQL database.
- Twenty-one real-PostgreSQL integration tests passed in the isolated
  `itsmytoy_test` database.
- Ten concurrent executions with one idempotency key produced one stored command and one identical result.
- Reuse of that key with changed request content returned an idempotency conflict.
- The restricted runtime role could read approved user mappings and insert proof commands, but could not change users, commands, inventory movements or audit events.
- The optimized production build passed with all internal-authentication routes.
- A production-style Playwright flow used an isolated test owner to complete a
  one-time setup link, receive a database session, open the authenticated sale
  workspace, sign out and sign back in with email/password.
- The browser proof found and verified a fix that keeps authentication redirects
  on the exact incoming browser origin, preserving host-scoped session cookies.
- The readiness endpoint returned HTTP 200 against the disposable test database.
- Three synthetic products were seeded for local testing without importing or changing the business workbook.
- A temporary `STORE_OPERATOR` built and completed a two-product cart at role-permitted prices.
- Both sale lines, the combined payment, both stock movements, costing and audit details committed in one database transaction.
- A cart containing one insufficient-stock line returned `INSUFFICIENT_STOCK` without changing the valid line's stock.
- A duplicate-SKU cart returned `INVALID_REQUEST` before the sale transaction.
- Repeating the identical multi-item checkout returned the original sale and line results instead of creating a second sale.
- The operator requested a genuinely below-cost price without receiving purchase-cost or margin data.
- The same below-floor sale was blocked with `PRICE_APPROVAL_REQUIRED` before owner approval.
- The owner approval inbox displayed accounting result, replacement loss per unit and total replacement loss.
- The owner approved the exact operator, SKU, quantity and price using a controlled reason.
- The approved cart completed once with the approval attached only to its matching sale line, and the approval changed from `APPROVED` to `CONSUMED` atomically.
- An owner-direct sale below the owner floor was blocked without a controlled reason and completed with `CLEARANCE` recorded.
- Approved operator exceptions expire after 30 minutes and become invalid when their price-version or cost snapshot changes.
- The repeatable proof restored the product stock and removed its temporary sale, payment, stock movement, audit event and operator.
- A store operator received HTTP 403 when attempting to complete a stock receipt and did not receive purchase-cost data in the catalog response.
- An owner completed a two-unit existing-SKU receipt after the proof sales.
- Repeating the identical receipt returned the first result without increasing stock again.
- Cleanup removed the synthetic receipt and user and restored the dummy SKU to 8 units.
- A final database check returned zero synthetic users and zero synthetic sales.
- Authenticated visual checks passed for the mobile multi-item cart, mobile operator lower-price form and desktop owner approval inbox.
- Existing local movement history was replayed into moving weighted-average inventory values without changing recorded quantities.
- The accepted 3-at-₹400 plus 10-at-₹500 scenario produces ₹1,907.69 sale COGS, ₹507.69 gross loss, ₹600 replacement loss and ₹4,292.31 closing inventory value.

## Not yet passed

- Railway staging deployment and measured Singapore-to-shop latency.
- Railway private-database connection proof.
- Railway PITR configuration and sibling-restore rehearsal.
- Seven-day Railway resource and cost measurement.

These are external deployment gates, not blockers for local product development. They must pass before the app is hosted for operational use or trusted with real business data.

The repeatable local operations check is `npm run test:local-operations`. It
runs the PostgreSQL integration suite only when explicit `TEST_DATABASE_URL`
and `TEST_MIGRATION_DATABASE_URL` values are supplied. Those values must point
to a disposable test database, never the imported review or production
database. The `test:local-sale` alias runs the same suite for compatibility.
