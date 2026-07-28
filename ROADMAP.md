# ItsMyToy Local Product Roadmap

Last verified: 27 July 2026

Status means implemented and locally verified, not only designed.

## M0 — Engineering foundation — Complete

- Authentication, MFA and individual roles
- PostgreSQL migrations and restricted runtime identity
- Versioned API, atomic transactions, idempotency and audit events
- Local lint, type, unit, production-build and authenticated acceptance checks

## M1 — Safe retail selling — Complete

Complete:

- SKU, barcode and name lookup
- Role-controlled prices and server-side stock/price validation
- Per-line quantity and pricing with one- or two-part exact payment capture
- Multi-item cart with add, edit, remove and one atomic checkout
- Per-line stock, costing and exceptional-price approval
- Operator lower-price request
- Owner approval inbox with accounting result and replacement-loss warning
- Exact operator/SKU/quantity/price approval, 30-minute expiry and one-time consumption
- Owner-direct below-floor sale with mandatory controlled reason
- Customer master with normalized-phone duplicate prevention and name/phone lookup
- Sale-linked customer snapshot and purchase history summary
- ₹5,000 customer-information prompt enforced by the server
- Customer-declined Guest flow with exact-cart owner approval, 30-minute expiry,
  one-time consumption and recorded refusal without invented customer data
- Split payment across two different controlled methods, with an auto-calculated
  remainder and server enforcement that payment parts equal the sale total
- Sale-complete operational receipt with immutable sale number, item and payment
  breakdown, native device sharing, copy fallback and New Sale
- Rear-camera barcode scanning with automatic exact-product lookup, camera cleanup
  and manual SKU, barcode or name fallback
- Role-safe sale and approval activity history with owner-wide visibility,
  operator self-only visibility, type filters and indexed recent-record queries

## M2 — Stock truth — Complete

Complete:

- Owner receipt for one existing SKU
- Trusted-operator existing-SKU draft receipt with zero stock effect, owner
  review/completion and idempotent completion
- Multi-line supplier receipt completed atomically across every included SKU
- Reusable supplier master with controlled add-and-select workflow
- Possible duplicate supplier bill warning with explicit checked acknowledgement
- Condition-separated sellable, open-box and damaged receipt balances and
  movements; ordinary sales consume sellable stock only
- Owner-only new-product setup with generated immutable SKU/internal barcode,
  normalized alternate supplier barcode, controlled rack and unit/pack details
- Recommended role price floors with safe owner overrides before product save
- Zero-stock product creation followed by atomic first-stock receipt
- Moving weighted-average accounting cost
- Latest landed cost and replacement margin
- Owner-only existing-product repricing that closes the active price version,
  preserves historical sale snapshots and starts a new version
- Controlled rack-location changes that do not create inventory movements or
  alter condition balances
- Mandatory controlled change reason, immutable before/after audit evidence and
  automatic expiry of pending approvals tied to the replaced price version
- Product-level movement history with sale, receipt and adjustment references
- Current-balance versus append-only-ledger reconciliation by stock condition
- Trusted-operator and owner physical counts captured against the exact recorded
  balance version, with no stock effect while approval is pending
- Owner-only approval that applies the difference atomically as one inventory
  movement and preserves moving weighted-average valuation
- Stale-count blocking when any intervening transaction changes the balance

## M3 — Owner control — Complete

Complete:

- Owner-only daily control dashboard with revenue, completed orders, units,
  payment-method reconciliation and sales by person
- Separate accounting gross product profit and sale-time replacement margin
- Action queue for pending price, Guest, stock-count and receipt decisions
- Per-SKU owner-controlled reorder point and restock target, with no hidden
  default threshold
- Replenishment queue with suggested order quantity, exact-product deep links
  and separate counts for configured, never-configured and deliberately
  disabled policies
- Reorder-policy changes with a mandatory reason/note, immutable before/after
  evidence, idempotent replay and zero stock or movement effect
- Server-side denial of reorder-policy changes for both operator roles
- Cross-product checks for ledger mismatches, missing racks, missing balances
  and missing active prices
- Server-side denial of the owner dashboard for both operator roles
- Owner-only daily closing with server-derived sale/payment expectations,
  opening float, cash paid in/out and physically counted drawer cash
- Independent UPI, Card and Bank Transfer verification, with mandatory
  explanations for cash movements or any variance
- Immutable, idempotent closing records and linked correction revisions
- Automatic `Needs reconciliation` status when sales complete after a closing

## M3.5 — Railway deployment readiness — Complete

- Environment-independent Railpack build
- Runtime-only database initialization with a strict readiness check
- Railway-assigned port and public interface binding
- Validated pre-deploy environment and automatic schema migrations
- Explicit, removable first-deployment database-role bootstrap
- GitHub-triggered staging deployment configuration and operator guide

## M4 — PWA and offline operation — In progress

- M4.1: installable PWA shell, platform icons, connectivity status and
  non-sensitive install-asset caching
- M4.2: role-safe IndexedDB catalogue snapshot with every recognised barcode,
  permitted prices, rack and last-known stock; offline SKU/barcode/name lookup
  remains read-only and clearly marks stale stock
- M4.3: database-enforced device enrollment, automatic owner-device approval,
  owner approval/revocation for operator devices, visible 12-hour validation
  state and a service-worker fallback that reliably reopens the saved read-only
  catalogue without caching authenticated application pages
- Next — M4.4: queued normal-price Guest sales on approved devices, limited to
  Cash/UPI, no customer PII, cached price floors and the one-unit stock reserve
- Later in M4: ordered idempotent sync, conflict handling, queued-command
  visibility and cached-stock warnings

## M5 — Workbook migration — Not started

- Import mapping, validation/quarantine and exception report
- Opening movements, customer import, reconciliation and rollback rehearsal

## M6 — Railway staging validation — Not started

The application can now be deployed safely with synthetic staging data. Private
database connectivity, WorkOS callback, owner access, latency, PITR restore and
seven-day cost evidence must still pass before real business data are considered.

## Later phase

GST/statutory invoices, deeper accounting, wholesale quotations/orders, purchasing, receivables, dispatch and WhatsApp automation remain outside the current local Phase 1 build.
