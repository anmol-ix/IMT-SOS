# ItsMyToy Operations

This repository contains the production-shaped foundation and first local selling slice for the ItsMyToy shop-operations application. It is deliberately not a finished inventory or accounting product yet.

The current increment proves:

- one responsive Next.js/TypeScript application and versioned `/api/v1` boundary;
- hosted WorkOS sign-in with application-controlled roles;
- a restricted PostgreSQL runtime identity separate from schema migration access;
- versioned relational schema for users, products, variants, barcodes, prices, sales and stock;
- an idempotent transaction that remains single-write under concurrent retries;
- owner-only server authorization with negative operator tests;
- request IDs, structured redacted logs, health checks and security headers;
- unit, real-PostgreSQL integration and mobile Playwright tests;
- mobile-friendly SKU or barcode search with stock and rack visibility;
- rear-camera barcode scanning with exact-product lookup and manual-search fallback;
- role-safe recent sale and approval history for owners and store operators;
- role-controlled pricing, multi-item sale completion and atomic stock reduction;
- exact one- or two-part payment capture;
- customer lookup, high-value Guest controls and exact-cart owner approvals;
- sale-complete operational receipt with native device sharing and copy fallback;
- owner-direct receipt of an existing SKU with supplier evidence, invoice cost and atomic stock increase;
- trusted-operator draft receipt with zero stock effect until owner review and completion;
- multi-line receipts that complete every included SKU atomically;
- reusable supplier master and checked acknowledgement for possible duplicate supplier bills;
- condition-separated receipt quantities and inventory movements for sellable, open-box and damaged stock, while ordinary sales consume sellable stock only;
- owner-only new-product setup with a server-generated SKU/internal barcode, alternate supplier barcode, controlled rack, recommended or owner-adjusted role price floors, and zero stock until the first receipt completes;
- moving weighted-average inventory valuation with immutable accounting COGS and latest-cost replacement margin;
- owner-only existing-product repricing with historical price versions, stale-approval expiry and before/after audit evidence;
- controlled rack changes that leave stock quantities and inventory movements untouched;
- product-level movement history that reconciles the append-only ledger with current sellable, open-box and damaged balances;
- trusted-operator and owner physical counts with owner-only approval, stale-count blocking and one idempotent adjustment movement;
- owner-only daily control dashboard with revenue, orders, units, payment reconciliation, sales by person, separate accounting and replacement margins, pending-decision counts, stock exceptions and data-quality checks;
- owner-configured per-SKU reorder points and restock targets, with suggested order quantities, exact inventory deep links and a visible queue for policies still needing setup;
- immutable, idempotent reorder-policy changes with mandatory decision evidence and zero stock or ledger effect;
- owner-only daily closing that separates cash sales from physical drawer cash, independently verifies digital payments, requires explanations for movements or variances, and preserves corrections as linked immutable revisions;
- Railway deployment configuration.

It does **not** yet implement purchase-order creation, open-box selling, stock-condition transfers, offline sync, statutory billing, wholesale workflows or workbook import.

## Local verification

Use Node.js 22 and PostgreSQL 16. Copy `.env.example` to an ignored `.env.local`, replace every placeholder, then run:

```text
npm install
npm run db:roles
npm run db:migrate
npm run db:seed-demo
npm run verify
npm run test:e2e
npm run test:local-operations
```

`db:seed-demo` creates three clearly synthetic products for local use. `test:local-operations` creates a temporary dummy user, supplier and product; proves camera barcode lookup, role-safe activity history, controlled sale, customer, payment, receipt-sharing, condition-separated multi-line receipt drafting, owner-only generated-SKU product setup, alternate-barcode lookup, duplicate-bill protection, owner completion, versioned existing-product repricing, stale-approval expiry, rack changes without stock movement, trusted physical counting, stale-count blocking, owner adjustment approval, ledger reconciliation, per-SKU reorder configuration, operator denial, invalid-target rejection, unchanged stock/ledger, payment and seller summaries, replenishment deep-linking, first daily close, identical retry, post-closing sale detection and an immutable reconciliation revision; then removes all synthetic records and restores the unused SKU sequence.

Integration tests require `TEST_DATABASE_URL` for the restricted runtime role and `TEST_MIGRATION_DATABASE_URL` for test fixture setup. They are skipped when those explicit test URLs are absent; CI supplies both and uses real PostgreSQL 16.

## Safe initial access

Creating a WorkOS identity alone does not grant application access. After the first intended owner signs in to WorkOS staging, provision that exact WorkOS user ID through the controlled migration credential:

```text
WORKOS_USER_ID=user_... OWNER_DISPLAY_NAME=Anmol npm run db:provision-owner
```

Never expose `MIGRATION_DATABASE_URL` or `DATABASE_ADMIN_URL` to the running application or browser.

Open `http://127.0.0.1:4173` after `npm run dev`. Business owners land on the local control dashboard; operators land on the selling screen. See [OPERATIONS.md](./OPERATIONS.md) only when hosted deployment becomes relevant.
