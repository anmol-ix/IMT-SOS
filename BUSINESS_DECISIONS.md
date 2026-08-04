# ItsMyToy Store Operating System

## Approved Business Decisions

**Version:** 1.1  
**Date:** 22 July 2026  
**Status:** Accepted by the business owners on 22 July 2026  
**Companion documents:** `PHASE_1_PRODUCT_BLUEPRINT.md`, `ENGINEERING_FOUNDATION_SPEC.md`

---

## 1. Purpose

This document records the seventeen business-policy decisions approved for the first production release. The decisions are based on:

- the ItsMyToy retail and wholesale business context;
- the current **ItsMyToy - Inventory & Accounting** workbook;
- the requirement that employees or family members may operate the shop without repeatedly calling an owner;
- the requirement to reduce accidental pricing, inventory and sales-recording mistakes;
- the architecture, security and data-integrity rules in `ENGINEERING_FOUNDATION_SPEC.md`.

These decisions govern product behaviour and implementation. A later change must be recorded here and reflected in the product and engineering documents before release.

### Decision status

- **Accepted:** approved for implementation.
- **Changed:** approved with recorded modification.
- **Deferred:** not required for the first production release.

All decisions below have **Accepted** status.

---

## 2. Decision summary

| ID | Decision | Accepted rule |
|---|---|---|
| BD-01 | Roles and permissions | Individual accounts; owner, trusted operator and store operator roles |
| BD-02 | Discount floors | 5% operator, 10% trusted, owner floor at higher of cost or 80% of standard price |
| BD-03 | Trusted stock receiving | May prepare receipt; owner completes it |
| BD-04 | Below-cost sales | Online owner-only with mandatory reason |
| BD-05 | Split payment | Supported using separate payment entries, not “Mixed” |
| BD-06 | Required customer information | Guest permitted; name/phone requested at ₹5,000+, required for returns, credit and wholesale |
| BD-07 | Payment modes and channels | Use current workbook choices with controlled values |
| BD-08 | Offline Guest sales | Allowed above one-unit safety reserve; no customer PII |
| BD-09 | Offline authentication | Maximum 12 hours after last successful online authentication |
| BD-10 | Offline owner override | Not allowed |
| BD-11 | Returns and exchanges | Owner-approved, sale-linked and condition-recorded; seven-day normal window |
| BD-12 | Completed-sale cancellation | Owner-only; operators submit a request |
| BD-13 | Damaged/open-box goods | Same SKU with separate stock condition |
| BD-14 | Rack/location format | `L1-S1`, `C2-S4`, `R4-S6`; S1 bottom, S6 top |
| BD-15 | Barcode source | Internal label uses SKU; supplier barcode stored as alternate |
| BD-16 | Hosting, retention and operational responsibility | Managed services; no self-hosting; bounded budget and privacy-minimizing retention |
| BD-17 | Inventory costing and margin | Moving weighted-average for accounting; latest landed cost for replacement margin and price safety |

---

## 3. BD-01 — Roles, accounts and permissions

**Status:** Accepted

### Accepted decision

Every person operating the application receives an individual account. Accounts are never shared, even when two people use the same phone or MacBook.

Initial role assignment:

- **Business owner:** Anmol and Muskan.
- **Trusted store operator:** a family member or experienced employee only after an owner explicitly grants the role.
- **Store operator:** the default role for a shop employee or temporary family helper.

Relationship alone does not grant authority. For example, a parent may receive either Store Operator or Trusted Store Operator according to actual responsibility.

### Permission defaults

| Capability | Store operator | Trusted store operator | Business owner |
|---|---:|---:|---:|
| Scan/search products | Yes | Yes | Yes |
| View sellable stock and rack | Yes | Yes | Yes |
| View permitted retail price | Yes | Yes | Yes |
| View purchase cost or profit | No | No | Yes |
| Complete sale within role floor | Yes | Yes | Yes |
| Request extra discount | Yes | Yes | Not required |
| Approve discount | No | No | Yes |
| Prepare receipt for existing SKU | No | Yes | Yes |
| Complete stock receipt | No | No | Yes |
| Create SKU/barcode or change pricing | No | No | Yes |
| Request stock adjustment | No by default | Yes | Yes |
| Apply stock adjustment | No | No | Yes |
| Cancel completed sale | No | No | Yes |
| Export business/customer data | No | No | Yes |
| Manage users and devices | No | No | Yes |

### Reason

- Individual accounts provide accountability and device revocation.
- Role-based access prevents purchase cost and profit from leaking to shop operators.
- A safe default avoids granting family members unrestricted authority merely because they are trusted personally.

### Operational follow-up

- Identify each current person who needs access.
- Review receipt authority later only if owner review becomes a demonstrated bottleneck.

---

## 4. BD-02 — Retail discount floors

**Status:** Accepted

### Accepted decision

Every SKU has explicit money values for MRP, standard selling price and three role floors. The application generates recommended floors when a product is created or repriced, and an owner may change them before saving.

Recommended defaults, calculated in this order:

1. **Owner floor:** the higher of purchase cost or 80% of standard selling price, rounded upward to the nearest ₹5.
2. **Trusted-operator floor:** the higher of the owner floor or 90% of standard selling price, rounded upward to the nearest ₹5.
3. **Store-operator floor:** the higher of the trusted-operator floor or 95% of standard selling price, rounded upward to the nearest ₹5.

Example:

| Field | Amount |
|---|---:|
| Purchase cost | ₹400 |
| MRP | ₹1,000 |
| Standard selling price | ₹800 |
| Store-operator floor | ₹760 |
| Trusted-operator floor | ₹720 |
| Default owner floor | ₹640 |

The Store Operator can therefore give up to ₹40 additional discount from the normal ₹800 selling price. The customer-facing saving shown by the app is calculated from the ₹1,000 MRP.

### Rules

- If purchase cost, MRP or standard price is missing/zero, the product cannot be sold until an owner fixes pricing.
- If purchase cost is greater than standard selling price, or any generated floor would exceed standard selling price, the product is marked **Pricing Conflict** and cannot be sold until an owner explicitly corrects or approves its prices.
- The final unit price, not a discount percentage, is the authoritative sale value.
- Preset discount buttons and the slider must stop at the signed-in user’s floor.
- A requested price below the user’s floor requires an online owner approval.
- Product-specific floors override the generated defaults.
- Historical sales retain the prices and costs that applied when completed.

### Reason

- Operators receive useful authority without unlimited pricing control.
- Trusted operators can handle ordinary negotiation.
- Explicit per-SKU floors are easier to audit than a hidden formula evaluated differently on every sale.

### Future change triggers

- Review the default percentages after sufficient sales history exists.
- Configure fixed product-specific floors when the normal percentages are commercially unsuitable.

---

## 5. BD-03 — Trusted operator receiving stock

**Status:** Accepted

### Accepted decision

A Trusted Store Operator may physically count and prepare a Draft stock receipt for existing SKUs. The operator records:

- supplier;
- supplier bill/invoice reference;
- SKU and quantities;
- sellable versus damaged quantities;
- invoice purchase cost;
- observed MRP/price changes;
- rack location;
- notes or discrepancy.

Only a Business Owner may complete the receipt. Stock does not increase until completion.

A Trusted Store Operator cannot:

- create a new SKU;
- link a new barcode;
- activate a price change;
- resolve a supplier quantity/value discrepancy;
- complete the receipt.

### Reason

- Someone at the shop can record incoming goods immediately.
- Owner review prevents incorrect quantities or purchase prices becoming operational truth.
- This can be relaxed later after the receiving process proves reliable.

### Operational effect

The owner’s dashboard contains **Receipts awaiting review**. The owner can compare the receipt against the supplier document and complete or return it for correction remotely.

---

## 6. BD-04 — Below-cost sales

**Status:** Accepted

### Accepted decision

A sale below the purchase-cost snapshot is permitted only when:

- the application is online;
- a Business Owner performs or approves it;
- the application displays the expected loss per unit and total expected loss;
- the owner selects a controlled reason;
- the owner adds a note when the selected reason requires explanation.

Allowed reasons:

- clearance;
- damaged packaging/open box;
- customer-service recovery;
- pricing correction;
- other, with mandatory note.

Free samples, gifts and personal use are not recorded as zero-price sales. They use a separate inventory movement so revenue and margins are not distorted.

### Reason

- Owners retain commercial flexibility.
- Below-cost actions are deliberate and auditable.
- Samples/gifts remain operational stock movements rather than fake customer sales.

### Not permitted

- Store or trusted operators approving below-cost prices.
- Offline below-cost approval.
- A zero final selling price in an ordinary sale.

---

## 7. BD-05 — Split payment

**Status:** Accepted

### Accepted decision

Split payment is supported in the first production release because the workbook already includes a planned `Mixed` payment option. The new application will not store `Mixed` as a payment mode.

Instead, a sale may contain separate payment entries, for example:

- Cash: ₹500
- UPI: ₹750
- Sale total: ₹1,250

Initial UI rules:

- default to one payment;
- allow **Add another payment**;
- allow a maximum of two payment entries initially;
- require payment sum to equal the sale total exactly;
- require an optional reference only when useful for UPI, card or bank transfer;
- store no card number or payment credential.

### Reason

- Exact payment entries support cash/UPI reconciliation.
- A generic `Mixed` value hides the amount paid through each mode.
- The database already supports multiple payment rows without complicating ordinary one-mode checkout.

---

## 8. BD-06 — Customer information requirements

**Status:** Accepted

### Accepted decision

Ordinary retail sales may be completed as Guest sales. The system does not create a shared “Anonymous” customer record.

Customer name and phone are requested when:

- retail sale total is ₹5,000 or more;
- the customer requests a digital receipt;
- a return/exchange is recorded;
- a credit sale is permitted later;
- the customer is a wholesale/business customer.

For a retail sale of ₹5,000 or more, the operator asks for name and phone. If the customer declines, a Business Owner may approve completion as Guest. The refusal is recorded without inventing customer data.

### Minimum customer record

- customer name;
- normalized phone number;
- WhatsApp consent recorded separately when messages are requested;
- locality and email optional.

Child name, birthday and age are excluded from Phase 1.

### Reason

- Mandatory data on every small sale slows checkout and encourages fake entries.
- High-value and return-linked sales benefit from reliable customer identification.
- Marketing consent must not be assumed merely because a phone number exists.

### Future change trigger

Review the ₹5,000 threshold after the store has enough high-value-sale history to judge checkout friction and return traceability.

---

## 9. BD-07 — Payment modes and sales channels

**Status:** Accepted

### Accepted payment modes

Based on the current workbook configuration:

- Cash
- UPI
- Card
- Bank Transfer

`Mixed` is removed as a mode and represented through split-payment entries under BD-05.

### Accepted sales channels

Based on the current workbook configuration:

- Store Walk-in
- WhatsApp
- Instagram
- Phone Order
- Other

Add **Wholesale/Trade** as a distinct channel when a wholesale transaction is recorded or imported, even before the complete wholesale-ordering module exists.

### Rules

- Payment mode and channel are required to complete an online sale.
- Offline Guest sales may use Cash or UPI only in the first release.
- Selecting Other requires a short note.
- Channel describes where the order originated, not how it was paid.
- The owner may deactivate unused controlled values but cannot rename historical values in completed sales.

### Reason

- These choices match the workbook rather than introducing new terminology.
- Separating channel and payment eliminates current missing/ambiguous records.

---

## 10. BD-08 — Offline Guest sales and safety reserve

**Status:** Accepted

### Accepted decision

An enrolled device may complete an offline Guest sale only when all conditions are true:

- the signed-in user remains within the offline authentication grace period;
- the SKU and price version exist in the last successful catalogue sync;
- final price is at or above the user’s cached role floor;
- sale uses Cash or UPI;
- no customer personal information is collected offline;
- last-known sellable stock, minus unsynced quantities on that device, remains above a one-unit safety reserve.

Formula:

`offline quantity available = max(0, last-known stock - locally queued quantity - 1)`

Example:

- Last-known stock: 4
- Already queued offline on this device: 1
- Safety reserve: 1
- Additional quantity permitted offline: 2

The queued sale remains visibly **Unsynced** until the server accepts or rejects it.

### Reason

- The shop can continue ordinary sales during short outages.
- The final known unit is protected from multi-device overselling.
- Avoiding customer PII reduces lost-device exposure.

### Future change trigger

If offline conflicts become frequent, revert offline completion to Draft-only until the stock-reservation policy is redesigned.

---

## 11. BD-09 — Offline authentication grace period

**Status:** Accepted

### Accepted decision

An enrolled device may perform permitted offline actions for up to **12 hours** after the user’s last successful online authentication.

Rules:

- The user must have completed an online login on that device.
- A device-local quick unlock may be used during the grace period.
- The grace period ends immediately when the server confirms the user/device is disabled or revoked.
- After 12 hours without online validation, the application becomes read-only for cached catalogue lookup until connectivity and authentication return.
- Owner-only operations never rely solely on offline grace.

### Reason

- Twelve hours covers one normal shop day.
- Daily online validation limits risk from a lost or retained device.
- The policy is understandable to non-technical users.

---

## 12. BD-10 — Offline owner PIN override

**Status:** Accepted

### Accepted decision

Do not permit an offline owner PIN to bypass:

- discount floors;
- below-cost protection;
- last-unit protection;
- approval expiry;
- user/device revocation;
- unknown-product restrictions.

An owner PIN entered into an offline browser cannot be verified reliably against current permissions and could be shared or observed.

### Alternative during outage

- Save the cart as Draft.
- Record the customer’s intended items and contact manually only when the customer agrees.
- Complete the transaction after connectivity returns.

### Reason

The rare convenience does not justify creating a universal security bypass.

---

## 13. BD-11 — Returns and exchanges

**Status:** Accepted

### Accepted decision

Phase 1 supports an owner-approved, sale-linked return or exchange. It does not allow a store operator to alter or delete the original sale.

Accepted normal shop policy:

- request made within seven calendar days of purchase;
- original sale/receipt or identifiable customer sale available;
- product and packaging unused and resalable;
- defective products handled case-by-case by an owner;
- wholesale returns follow a separate later policy.

The application records:

- original sale and line;
- quantity returned;
- reason;
- item condition;
- refund or exchange outcome;
- refund payment mode where applicable;
- approving owner;
- compensating inventory movement.

Returned stock condition determines destination:

- sellable: returns to sellable stock;
- open-box/damaged packaging: returns to separate open-box stock;
- defective/unusable: returns to damaged or supplier-return stock.

### Reason

- Inventory cannot be restored merely because a refund was recorded.
- Condition inspection determines whether the item can be sold again.
- Linking the original sale prevents price and quantity ambiguity.

### Required external review

The owners must confirm their displayed return policy and obtain appropriate local legal advice before the application presents it as a customer entitlement.

---

## 14. BD-12 — Cancelling a completed sale

**Status:** Accepted

### Accepted decision

Only a Business Owner may cancel a completed sale.

A Store Operator or Trusted Store Operator may submit a cancellation request containing:

- sale number;
- reason;
- whether payment was collected;
- whether goods physically left the shop;
- optional note.

The owner chooses the correct action:

- cancel duplicate/mistaken sale and reverse stock/payment records;
- record a customer return if goods left the shop;
- reject the request.

### Rules

- Completed sale data is not edited.
- Cancellation creates compensating stock records.
- Refund status is recorded separately from stock reversal.
- Cancellation reason and owner identity are audited.

### Reason

Cancellation has financial and inventory consequences and should not be a routine operator permission.

---

## 15. BD-13 — Damaged packaging and open-box stock

**Status:** Accepted

### Accepted decision

Use the same SKU when the physical toy is the same product, but separate quantity by stock condition:

- **Sellable:** normal unopened condition.
- **Open Box:** product is functional but packaging is opened/damaged; may be sold with owner-approved price.
- **Damaged:** not currently sellable.
- **Return to Supplier:** held for supplier return.

A separate SKU is created only when the product itself is commercially different, such as a permanent bundle, different included accessories or a distinct variant.

### Rules

- Open-box quantity is never included in ordinary sellable availability.
- Selling Open Box requires explicit item selection, owner-approved price and condition disclosure note.
- Moving an item between conditions creates inventory movements; users never edit condition balances directly.

### Reason

- Duplicate SKUs for damaged packaging fragment product history.
- Treating open-box items as normal sellable stock hides condition and pricing risk.

### Engineering effect

Add `OPEN_BOX` to the permitted inventory stock states and include condition in the sale-line stock allocation.

---

## 16. BD-14 — Rack/location coding

**Status:** Accepted

### Accepted decision

Use the physical rack layout already defined for the shop:

- left columns: `L1` to `L6`;
- centre columns: `C1` to `C3`;
- right columns: `R1` to `R4`;
- shelf levels: `S1` to `S6`.

Full location format:

`<rack column>-<shelf>`

Examples:

- `L1-S1`
- `C2-S4`
- `R4-S6`

Accepted orientation:

- `S1` is the bottom shelf;
- `S6` is the top shelf, commonly used for extra stock.

### Rules

- Primary rack location is required before a product becomes active.
- The application uses a controlled selector, not free text.
- An owner may define one optional overflow location.
- Receiving confirms or changes the rack location.
- Rack-wise stock counts use these same codes.

### Migration check

Physically verify the accepted S1-bottom/S6-top direction before location data are migrated or rack labels are printed.

---

## 17. BD-15 — Barcode source and mapping

**Status:** Accepted

### Accepted decision

The ItsMyToy-printed label barcode contains the internal SKU value. This remains the stable business-controlled scan identifier.

When a product already has a usable supplier/manufacturer barcode:

- store it as an alternate barcode for the same SKU;
- allow either barcode to find the product;
- never assign one barcode to multiple active SKUs;
- do not replace the internal SKU with a supplier code.

### Rules

- A variant may have multiple barcodes.
- Every barcode is unique after normalization.
- An owner must resolve an unknown or conflicting barcode.
- Changing/removing an alternate barcode does not change historical sales.
- Manual SKU search remains available when a label is damaged.

### Reason

- ItsMyToy controls the SKU even when supplier packaging changes.
- Supplier barcodes reduce relabelling/scanning friction.
- One-to-one barcode resolution prevents the wrong variant being sold.

---

## 18. BD-16 — Hosting, operational responsibility and data retention

**Status:** Accepted

### Hosting and operations

Use managed services for:

- application hosting;
- PostgreSQL database;
- automated backup/point-in-time recovery;
- object storage when product images are enabled;
- logs/error monitoring.

Do not self-host a server or database in the shop or on a personal MacBook.
Identity is application-managed because this is a private internal tool: there
is no public registration, every person has an individual account, and owners
issue single-use setup links.

Accepted budget guardrails:

- target pilot and early-production infrastructure at or below ₹5,000 per month;
- any expected baseline above ₹10,000 per month requires explicit owner approval;
- messaging, payment-processing and one-time development costs are tracked separately;
- operational simplicity and recoverability take priority over the cheapest possible hosting.

The framework/provider evaluation will compare no more than three options against security, managed PostgreSQL/PITR, PWA compatibility, monitoring, cost and exit/migration capability. Stronger authentication such as passkeys or MFA remains a later hardening decision if access expands beyond the small internal team.

### Operational responsibility

- Business owners manage users, roles, product policies and business exceptions.
- The application maintainer manages deployments, schema migrations, monitoring and incident response.
- Hosting providers manage only the infrastructure responsibilities included in their service agreement.
- Backup restore tests and security updates remain the application owner/maintainer’s responsibility even when hosting is managed.

### Data retention

Accepted Phase 1 defaults:

- sales, sale lines, payments, receipts, inventory movements, price history and business audit events are retained while the business operates, subject to later legal/accounting retention review;
- child name, age and birthday are not migrated or collected;
- customer contact data is retained for 24 months after the last purchase unless the customer remains active, has an unresolved transaction or has explicitly consented to continued engagement;
- after the customer-contact period, personally identifying contact fields are anonymized while operational sale totals remain;
- security/application logs are retained for 90 days unless an incident requires longer preservation;
- backups follow the provider’s approved retention and restore policy;
- customer exports and anonymization actions are owner-only and audited.

### Reason

- Managed services reduce operational risk for a small business without an infrastructure team.
- Budget guardrails prevent accidental recurring cost growth.
- Retention separates long-lived business records from customer personal information.

### Required external review

Before production migration, a qualified local adviser should confirm applicable tax, accounting, privacy and consumer-record retention requirements. The confirmed legal requirement overrides this operational retention period where necessary.

---

## 19. BD-17 — Inventory costing and margin

**Status:** Accepted

### Accepted decision

- The business uses one moving weighted-average cost policy for interchangeable toy inventory.
- A completed receipt adds its actual landed value to the current inventory value and recalculates the weighted-average unit cost.
- A completed sale freezes its allocated accounting COGS; later receipts never rewrite historical sale profit.
- The latest landed cost is retained separately for price safety and replacement-margin reporting.
- Owner reporting distinguishes accounting gross product profit, replacement margin and net business profit.
- Paise rounding is applied to the complete sale allocation. Any residual value remains in inventory and the final units consume the complete remaining value.
- Returns and reversals reuse the original completed transaction’s cost snapshots rather than today’s cost.

### Reason

One editable purchase-price field cannot correctly value stock bought at different costs. Separating accounting cost from replacement cost prevents historical P&L from changing while still warning owners when a selling price cannot fund replenishment.

### Required external review

The accounting policy will be confirmed with the business’s chartered accountant before real accounting migration or statutory reporting.

---

## 20. BD-18 — Daily closing and payment reconciliation

**Status:** Accepted

### Accepted decision

- Daily closing is owner-only and uses the active shop location’s configured
  timezone and business date.
- The system snapshots completed-sale count, unit count, revenue and expected
  payment totals directly from completed sales. A user cannot edit those
  expected figures.
- Cash sales are not treated as drawer cash. Expected drawer cash equals:
  opening cash float + cash sales + cash paid in − cash paid out.
- The owner enters the physically counted drawer cash and independently enters
  verified UPI, Card and Bank Transfer totals after checking their providers.
- Any cash paid in or out requires an explanation. Any cash or digital-payment
  variance requires an explanation before the closing can be recorded.
- A closing never changes a sale, payment or stock record.
- Daily closings are immutable and idempotent. A correction creates a linked
  revision with a controlled reason and note; it never overwrites the earlier
  record.
- Sales completed after a closing automatically change the day to
  `Needs reconciliation` until the owner records a new revision.
- Closing records, payment comparisons and owner identity are retained as
  business audit evidence.

### Reason

Payment totals in the application prove what operators recorded, but they do not
prove what cash is physically present or what a payment provider received.
Separating system expectations, independent verification and immutable
corrections makes daily closing useful without pretending to be full accounting.

---

## 21. BD-19 — Product replenishment policy

**Status:** Accepted

### Accepted decision

- Each active SKU may have an owner-configured reorder point and restock target.
- An alert appears when sellable stock is less than or equal to the SKU’s
  reorder point.
- Suggested order quantity equals `restock target − current sellable stock`,
  never less than zero.
- The restock target must be greater than the reorder point. Both values are
  whole units.
- The system never substitutes a hidden business-wide threshold. A SKU is
  explicitly configured, deliberately disabled or visible as never configured.
- Only a business owner may configure or disable a policy. Every change requires
  a controlled reason and explanatory note and preserves immutable previous and
  current values.
- Changing a replenishment policy never changes stock, creates an inventory
  movement or creates a purchase order.
- A suggested quantity is decision support, not proof of supplier availability,
  pack size, budget or demand. Purchase-order automation remains a later phase.

### Reason

Different toys sell at different rates, use different storage space and have
different supplier lead times. One universal low-stock number would create
false urgency for some products and late ordering for others. Explicit
per-SKU settings keep the operating rule visible and owner-controlled.

---

## 22. Resulting first-release policy

The first production release behaves as follows:

1. Every operator signs in individually.
2. Ordinary retail selling starts at the standard selling price.
3. Store operators may discount up to 5%; trusted operators up to 10%.
4. Deeper discounts require an online owner approval.
5. Only owners see cost/profit, create products, change prices, complete receipts, adjust stock or cancel completed sales.
6. Trusted operators may prepare incoming-stock receipts for owner review.
7. Guest sales are permitted; customer data is requested for ₹5,000+ sales and required for returns/wholesale.
8. Cash, UPI, Card and Bank Transfer are explicit payments; split payments contain separate amounts.
9. Store Walk-in, WhatsApp, Instagram, Phone Order, Wholesale/Trade and Other are explicit channels.
10. Limited offline Guest sales are permitted with one unit reserved and no customer PII.
11. Offline security protections cannot be bypassed with a PIN.
12. Returns, cancellations, below-cost sales and open-box sales require owner involvement.
13. Rack and shelf codes are controlled values.
14. Internal SKU is the printed barcode; supplier barcode is an alternate.
15. Production uses managed hosting and managed database/authentication.
16. Inventory uses moving weighted-average accounting cost while the latest landed cost drives replacement-margin visibility and price safety.
17. Owners close each shop day by reconciling physical drawer cash and independently verified digital payments against immutable system expectations.
18. Owners set each SKU’s reorder point and restock target; missing policies remain visible and no hidden fallback is used.

---

## 23. Decision change control

To change an approved rule:

1. identify the decision ID;
2. record the replacement rule and business reason;
3. assess effects on permissions, data, migration, tests and operator training;
4. update the product blueprint and engineering specification;
5. release the change only after its acceptance tests pass.

Acceptance of these decisions completes the business-policy gate. The next gate is the framework, identity-provider and hosting evaluation required by ADR-008 in the engineering specification.
