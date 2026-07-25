# ItsMyToy Store Operating System

## Framework, Identity and Hosting Evaluation

**ADR:** ADR-008  
**Version:** 1.0  
**Date:** 21 July 2026  
**Status:** Accepted and locked by the business owner on 21 July 2026  
**Companion documents:** `PHASE_1_PRODUCT_BLUEPRINT.md`, `BUSINESS_DECISIONS.md`, `ENGINEERING_FOUNDATION_SPEC.md`

---

## 1. Decision in one page

Use the following production foundation:

| Area | Selected technology |
|---|---|
| Application | One full-stack **Next.js application using TypeScript and the App Router** |
| User experience | Responsive web application installed as a **Progressive Web App (PWA)** on phones and MacBooks |
| Backend runtime | Current supported **Node.js Active LTS**, pinned by the repository |
| Backend application | Versioned HTTP/JSON API route handlers and server use cases in Next.js, organized as a modular monolith |
| Database | **PostgreSQL on Railway Pro** |
| Database access | Server-only access using `pg`; versioned SQL migrations; no browser-to-database connection |
| Identity | Managed **WorkOS AuthKit** hosted sign-in |
| Authentication protection | TOTP multi-factor authentication, secure server sessions, session revocation and recent-authentication checks for sensitive owner actions |
| Hosting | Existing **Railway Pro** workspace |
| Production region | Railway Southeast Asia Metal, Singapore, for both application and PostgreSQL |
| Object storage | Not introduced in the walking skeleton; select S3-compatible managed storage only when product photos enter scope |
| Background jobs | None initially; synchronous transactions plus a database outbox only when an actual integration requires delivery |
| Cache/Redis | None initially |
| Monitoring | Railway health checks, metrics, alerts and logs initially; add dedicated error monitoring only when production evidence justifies it |

This is a **modular monolith**, not a microservice system. The browser never receives database credentials and never decides permissions, stock truth or the final permitted price.

### Decision boundary

This ADR chooses the production technologies. Its acceptance authorizes only a small production-grade walking skeleton that proves deployment, identity, authorization, PostgreSQL transactions, migrations, tests, latency and restore operations before broader product work.

---

## 2. Business context understood by a new developer

ItsMyToy is a small children’s-toy retail and wholesale business operated by Anmol and Muskan. The current operating record is a Google Sheets workbook. The physical store may be operated by owners, family members or a shop employee, and internet connectivity in the basement may be intermittent.

The application must reduce accidental human mistakes and allow an authorized operator to:

- scan an internal SKU barcode;
- see stock, rack location and the price that person is allowed to offer;
- adjust a discount only within the signed-in role’s permitted floor;
- request an online owner approval for a deeper discount;
- complete a sale and capture optional or required customer information;
- receive and count stock through controlled workflows;
- continue a narrowly limited Guest sale during a short outage without silently overselling.

Later releases may add invoices, quotations, wholesale orders, purchasing and customer engagement. Those later possibilities must not force Phase 1 into microservices, generic workflow engines or other speculative infrastructure.

---

## 3. Non-negotiable constraints

The selected stack must preserve these rules:

1. One deployable application and one authoritative PostgreSQL database initially.
2. Inventory changes are append-only movements; users never edit an on-hand total directly.
3. Sale completion, price validation, payment recording and inventory deduction occur in one database transaction.
4. The server independently validates identity, role, price floor, stock and request idempotency.
5. Purchase cost, profit and owner-only floors are never returned to an operator client.
6. Offline commands use an IndexedDB outbox and server idempotency keys; they do not use last-write-wins stock updates.
7. Every person has an individual account; shared credentials are prohibited.
8. Owner-sensitive operations require recent online authentication.
9. Production needs encrypted connections, managed secrets, automated backups and point-in-time recovery.
10. The normal early-production infrastructure target is at or below ₹5,000 per month; an expected baseline above ₹10,000 requires explicit owner approval.
11. Development, staging and production are separated.
12. The system must remain portable: business tables use ordinary PostgreSQL, files use an S3-compatible boundary when introduced, and identity IDs are mapped through an internal user table.

---

## 4. Evaluation method

Each option was evaluated against:

- mobile PWA support and camera-based scanning compatibility;
- one-codebase simplicity for an AI coding agent and future human maintainer;
- explicit PostgreSQL transactions, constraints and row locks;
- managed authentication with MFA, session revocation and step-up authentication;
- managed PostgreSQL backup and point-in-time recovery;
- predictable monthly cost;
- operational effort for a small business without an infrastructure team;
- testability with real PostgreSQL;
- vendor exit and migration difficulty;
- likelihood of accidental security or data-integrity shortcuts.

Prices and plan features are time-sensitive. Figures in this ADR were checked against official vendor pages on 21 July 2026 and must be rechecked immediately before purchase.

---

## 5. Framework evaluation

### Option F1 — Next.js full-stack modular monolith — selected

One Next.js TypeScript repository provides the responsive user interface, installable PWA shell, server endpoints, authorization boundary and database access.

Why it fits:

- one language and one repository cover phone, MacBook and server work;
- Next.js has an official App Router PWA guide covering the web manifest, service worker, installation, notifications and security headers;
- server code can hold PostgreSQL transactions and omit sensitive fields before a response is created;
- WorkOS provides an official Next.js SDK with secure session handling and recent-authentication checks;
- the app can run as an always-on Node.js service on Railway, avoiding production cold starts and keeping PostgreSQL pooling conventional;
- PWA installation avoids maintaining separate iOS, Android and macOS applications in Phase 1.

Limits accepted:

- browser camera support and installation behaviour vary by device and must be tested on the actual shop phones;
- offline mutation logic remains custom business logic; a PWA framework does not solve stock conflicts automatically;
- the team must keep server-only modules out of client bundles and test that boundary.

### Option F2 — Django server with a JavaScript PWA client — rejected for Phase 1

Django offers mature server-side patterns, migrations, an administration interface and strong transaction support. It remains a valid fallback if the future maintainer is primarily a Python team.

It was not selected because the mobile offline experience would still require substantial JavaScript, IndexedDB and service-worker code. A separate or semi-separate browser client plus Python server creates two application stacks for a very small team without providing a business benefit in Phase 1.

### Option F3 — React single-page application plus a separate API service — rejected for Phase 1

This can create a strict frontend/backend separation, but it introduces two build/deploy units, duplicate request contracts, cross-origin/security configuration and more release coordination. That complexity is not justified for one shop and a small number of users.

### Framework decision

Select F1. Use framework boundaries, not independent services, to separate catalogue, pricing, sales, inventory, customers, purchasing, audit and identity modules.

Do not add GraphQL, a message broker, Redis, Kubernetes, a generic workflow engine or a second backend language in Phase 1.

### Backend decision

The backend is not omitted. It is the server-side half of the same Next.js application and runs on Node.js:

- browser/client TypeScript renders the PWA and maintains the permitted device cache;
- server TypeScript exposes authenticated `/api/v1` commands and queries through Next.js route handlers;
- server use cases enforce roles, price floors, approvals and validation;
- the Node.js process owns PostgreSQL connections and transactions;
- PostgreSQL owns persistent business truth and hard data constraints.

The versioned API is deliberate: the PWA, offline sync engine and any later native client need a stable server contract. Next.js Server Actions may be used for web-only convenience, but they are not the sole contract for sales, inventory, approvals or synchronization.

Java is not selected. A separate Java service would introduce a second language, build system, deployment, authorization boundary and network hop without solving a current capacity problem. Java may be reconsidered only if measured workload or a future team constraint demonstrates a concrete need that Node.js cannot meet.

---

## 6. Identity-provider evaluation

Custom password storage was excluded before scoring. Authentication is a security-sensitive commodity and BD-16 requires a managed identity service.

| Provider | Relevant strengths | Relevant limitations | Cost considered | Outcome |
|---|---|---|---:|---|
| **WorkOS AuthKit** | Hosted sign-in; TOTP MFA; passkeys; active-session details and revocation; `auth_time`/`max_age` step-up authentication; official Next.js SDK; separate staging and production environments | MFA is simplest when required broadly; a custom AuthKit domain is a separately priced add-on; passkeys are domain-bound | AuthKit is listed as free for up to 1 million active users; custom domain excluded | **Selected** |
| **Clerk Pro** | Polished components; MFA; passkeys; custom session lifetime; device/session controls; official Next.js integration | Production MFA is a Pro feature and adds recurring cost | $25 monthly or $20/month billed annually at review time | Good fallback |
| **Auth0 Essentials** | Mature hosted identity; passwordless options; Pro MFA; production-oriented controls | Higher baseline price and more configuration than this internal application needs | $35/month for the reviewed Essentials tier | Rejected on cost/fit |

### Identity decision

Select WorkOS AuthKit with the following rules:

1. Use hosted AuthKit UI rather than building a custom sign-in screen.
2. Create separate WorkOS staging and production environments from the start.
3. Disable unrestricted application access. A WorkOS identity becomes an application user only after an owner invitation or approved internal-user record exists.
4. Map the external WorkOS user ID to the application’s internal `app_user` row.
5. Keep `BUSINESS_OWNER`, `TRUSTED_OPERATOR` and `STORE_OPERATOR` authority in the application database. Identity-provider roles may mirror them for convenience but are not the sole authorization source.
6. Require TOTP MFA for production accounts initially. This is stronger and simpler than creating a custom owner-only MFA flow for a team of only a few internal users.
7. Use secure, HttpOnly session cookies through the official server SDK.
8. Record provider session ID/device metadata needed for audit and revocation, without copying authentication secrets.
9. Require authentication within the previous five minutes for user/role changes, completed-sale cancellation, below-cost approval, data export and destructive security actions.
10. Allow owners to revoke sessions/devices.
11. Do not enable production passkeys until the permanent authentication domain is decided. Passkeys are bound to their domain; enabling them and later changing domain creates avoidable re-enrolment.
12. Never use the identity provider’s availability as permission to complete an offline owner override. Accepted BD-10 still prohibits offline owner override.

### Identity acceptance test before feature work

The walking skeleton must prove all of the following against WorkOS staging:

- invited user sign-in;
- MFA enrolment and challenge;
- valid session refresh;
- invalid or revoked session rejection;
- internal-role lookup;
- operator denial from an owner-only endpoint;
- recent-authentication enforcement for a sensitive action;
- session revocation from an owner flow;
- provider outage/failure returns a safe error and does not bypass authorization.

If any mandatory item cannot be proven with the supported WorkOS plan or SDK, stop and switch ADR-008 to Clerk Pro rather than writing custom authentication.

---

## 7. Hosting and managed-database evaluation

### Option H1 — Railway Pro application + PostgreSQL — selected

The business already owns Railway Pro. Railway can run the full Next.js/Node.js backend and PostgreSQL in one project and environment. Railway provides Singapore deployment, encrypted private networking, scheduled volume backups and PostgreSQL point-in-time recovery using pgBackRest/WAL archiving.

Why it fits:

- an existing paid production-oriented workspace;
- Singapore deployment for both application and database;
- encrypted private networking between application and database;
- health checks, metrics, logs, alerts, deploys and rollbacks;
- point-in-time recovery that creates a separate restored database without modifying the source;
- a long-running Node process keeps PostgreSQL pooling and transaction behaviour conventional;
- ordinary PostgreSQL preserves a straightforward exit path.

### Option H2 — Vercel application + Supabase Pro — not selected

This option has excellent Next.js deployment ergonomics and combines database, authentication and storage on Supabase. It was not selected because it divides operations across two primary platforms, introduces serverless usage and connection considerations, and the reviewed Supabase Pro backup offering does not meet the existing 15-minute recovery-point target without its much more expensive point-in-time-recovery add-on.

It remains a reasonable alternative only if the owners later prioritize the Supabase integrated platform over the current recovery and cost requirements.

### Option H3 — Hostinger India VPS — rejected for the operational core

Hostinger Web and Cloud hosting do not support PostgreSQL; PostgreSQL requires a Hostinger VPS. Although an India VPS may reduce geographic network latency, it is self-managed. ItsMyToy would become responsible for operating-system and PostgreSQL patching, firewall configuration, deployment, WAL archiving/PITR, monitoring, backup validation and incident response. That conflicts with accepted BD-16. Hostinger may still be used for domain registration, email or an independent public marketing website.

### Hosting decision

Select H1.

Initial topology:

```text
Phone/Mac PWA
      |
      | HTTPS
      v
Railway Node.js/Next.js service
      |
      | Railway private DATABASE_URL
      v
Railway PostgreSQL

Authentication redirects/session verification -> WorkOS AuthKit
```

Deployment environments:

| Environment | Application | Database | Identity | Data rule |
|---|---|---|---|---|
| Development | Local Node process | Local PostgreSQL | WorkOS staging | Synthetic or sanitized data only |
| Staging | Separate Railway environment/service | Separate non-production PostgreSQL | WorkOS staging | Synthetic migration rehearsal data |
| Production | Railway Pro, Singapore, always on | Railway PostgreSQL, Singapore | WorkOS production | Real business data |

Staging and production must not share database credentials, cookie secrets, identity secrets or callback URLs.

---

## 8. Cost decision

### Selected production cost model

| Item | Reviewed price |
|---|---:|
| Railway Pro minimum usage | $20/month, including $20 monthly usage credits |
| Node.js application | Metered CPU and memory usage |
| PostgreSQL | Metered CPU, memory and volume usage |
| PITR archive bucket | Metered stored data; restore egress is free |
| WorkOS AuthKit | $0 at ItsMyToy’s expected user count |
| **Fixed minimum already owned** | **$20/month before taxes** |

Using a budgeting rate of ₹90 per US dollar, not a currency quote, the Railway Pro minimum is approximately **₹1,800/month before taxes**. Actual resource usage above the included credits is variable and must not be guessed before a measured deployment.

During the walking skeleton, run production-shaped staging for at least seven representative days, record application, database, volume, egress and PITR-bucket usage, and extrapolate a monthly operating range. Staging may be active only for release candidates and migration rehearsals during early development, but it must remain isolated from production and must never reuse production data or secrets.

Set Railway email/soft alerts before production. Do not configure a low automatic hard limit that can shut down the shop application. Review costs at approximately $40 and again near the accepted ₹5,000 monthly target; expected spend above ₹10,000 still requires explicit owner approval.

Production serverless sleeping is disabled. Cost savings must not introduce cold-start latency during shop operations.

Excluded from the baseline:

- annual domain registration;
- optional custom WorkOS authentication domain;
- product-image storage and delivery;
- WhatsApp/SMS messaging;
- payment processing;
- accounting/tax integrations;
- Railway usage above included Pro credits;
- development labour.

Review the Railway project usage and invoice monthly. No paid add-on or material resource increase may be enabled without recording its purpose and expected recurring amount.

---

## 9. Database implementation decision

PostgreSQL remains the authoritative business store.

Implementation rules:

- use the `pg` driver from server-only modules;
- use a bounded connection pool appropriate to the measured Railway PostgreSQL capacity;
- use versioned, forward-only SQL migrations through a small established migration tool;
- express critical invariants as PostgreSQL constraints and indexes, not only TypeScript checks;
- use explicit transactions and row locks for sale completion, stock receipt, return, cancellation and inventory adjustment;
- keep money as integer paise and timestamps as UTC `timestamptz`;
- use UUID command IDs/idempotency keys at external mutation boundaries;
- use append-only inventory movements plus a transactionally maintained balance projection;
- prohibit direct production database access by routine shop users;
- use a restricted runtime database role; migration credentials are separate and available only during controlled deployment;
- never expose a general SQL endpoint or database service key to the PWA.

An ORM is not part of the architecture. If later introduced, it must not hide transaction boundaries, weaken constraints or prevent use of PostgreSQL row locking. The first walking skeleton should prefer explicit SQL because the critical stock and pricing invariants are already defined relationally.

---

## 10. PWA and offline implementation decision

The first deploy proves an installable application shell, but offline sale completion is not implemented until the online sale transaction is correct and tested.

Sequence:

1. responsive online application;
2. valid manifest and installability on actual Android/iPhone/Mac devices;
3. cached read-only shell and last-synchronized catalogue;
4. IndexedDB Draft cart;
5. versioned outbox and idempotent server command endpoint;
6. accepted one-unit safety-reserve offline Guest sale;
7. conflict-resolution UI and operational tests.

Use browser-native manifest, service-worker and IndexedDB APIs first. Add a service-worker library only if real cache/versioning requirements make the native implementation unsafe or materially harder to maintain.

Never cache purchase cost, profit, owner-only floors, authentication secrets or unnecessary customer PII on operator devices.

---

## 11. Test and release toolchain

Keep the toolchain small:

- TypeScript strict mode;
- ESLint and the framework’s supported build checks;
- Vitest for fast unit and application-service tests;
- real PostgreSQL for integration tests;
- Playwright for critical browser journeys on representative mobile and desktop viewports;
- dependency lockfile committed to source control;
- automated checks on every proposed merge.

The release pipeline must run:

1. formatting/lint checks;
2. TypeScript checks;
3. unit tests;
4. PostgreSQL migration from an empty database;
5. PostgreSQL integration tests;
6. production build;
7. critical browser smoke tests against staging;
8. controlled production migration;
9. deploy health check.

Do not mock PostgreSQL transaction behaviour in tests that claim to prove stock safety. Do not use production customer data in CI.

---

## 12. Security and secret management

- Store secrets only in local ignored environment files or Railway/WorkOS secret settings.
- Never commit secrets, database URLs, provider keys or real customer exports.
- Use HTTPS only and secure cookie settings.
- Apply authorization inside server use cases and again at sensitive data-query boundaries.
- Validate every mutation payload at runtime; TypeScript alone is not input validation.
- Apply CSRF protection to cookie-authenticated mutations according to the selected SDK/framework pattern.
- Rate-limit login-adjacent and sensitive mutation endpoints without adding Redis initially; use application/provider controls suitable for the small deployment.
- Record owner approvals, denials, role changes, price changes, exports, cancellations, stock adjustments and authentication-security events in an append-only audit trail.
- Redact phone numbers, tokens, cookies, customer bodies and database credentials from logs.
- Run dependency and secret scanning in CI.
- Use dependency update PRs and apply supported runtime/security updates regularly.

OWASP ASVS Level 2 remains the release-security baseline defined in the engineering specification.

---

## 13. Backup, restore and disaster recovery

Production PostgreSQL on Railway must have point-in-time recovery enabled before business data are imported. Railway archives WAL to a project bucket and restores into a new sibling PostgreSQL service, so the operational runbook must include validation and connection cutover. Configure and document the approved retention window, and monitor that WAL/base-backup archiving remains healthy.

Before launch:

1. document the restore procedure;
2. restore a backup into an isolated non-production database;
3. verify schema version and record counts;
4. reconcile sample inventory balances against movements;
5. verify sample completed sales and payments;
6. record actual restore time;
7. repeat the exercise at least quarterly.

PITR protects database state but does not replace application-level safeguards, migration rehearsal or export portability. A backup is not considered operational until a restore has succeeded.

---

## 14. Portability and exit plan

Vendor exit must remain practical:

- PostgreSQL schema and migrations stay in the repository;
- use standard SQL and documented PostgreSQL features;
- take periodic logical exports in addition to provider recovery;
- map WorkOS IDs through internal users so identity providers can be replaced without rewriting sale/audit ownership;
- do not place pricing or stock truth in provider-specific identity metadata;
- keep file storage behind an application interface when introduced;
- keep the application deployable as a conventional Node service or container;
- document all provider settings that are not represented in source control.

Expected exits:

- Railway PostgreSQL -> another managed PostgreSQL service via dump/restore or replication plan;
- Railway Node.js service -> another conventional Node/container host;
- WorkOS -> Clerk/Auth0/another OIDC provider by remapping internal users and replacing the session adapter.

---

## 15. Explicitly deferred choices

These are not required for the walking skeleton and must not be introduced speculatively:

- product-photo object-storage vendor;
- barcode camera library;
- push-notification provider;
- WhatsApp provider;
- payment gateway;
- invoice/PDF engine;
- background job platform;
- Redis/cache;
- analytics warehouse;
- native mobile application;
- microservices;
- multi-location deployment;
- full wholesale/accounting module.

Each deferred choice receives its own short decision only when a committed feature needs it.

---

## 16. Risks and controls

| Risk | Control |
|---|---|
| WorkOS pricing/features change | Recheck before launch; internal-user mapping and standards-based sessions preserve a Clerk fallback |
| Hosted authentication outage | Fail closed for privileged actions; existing offline policy permits no offline owner override |
| MFA is inconvenient for operators | Long-enough secure sessions plus 12-hour enrolled-device offline grace; measure real sign-in friction before weakening security |
| Passkeys tied to temporary provider domain | Defer production passkey enrolment until permanent authentication-domain decision |
| Railway usage cost grows unexpectedly | Soft alerts, monthly review and measured resource limits; never use a low hard limit that can stop production |
| Singapore network path is slow from the shop | Local-first catalogue, delta sync and latency tests on shop Wi-Fi/Airtel/Jio before cutover |
| Railway PITR restoration requires manual cutover | Tested restore runbook, isolated validation and rehearsed connection swap |
| Next.js client/server boundary leaks sensitive fields | Server-only data modules, role-specific DTOs, bundle checks and negative authorization tests |
| Offline replay duplicates sales | UUID command IDs, unique idempotency constraints and transactional server handling |
| One service becomes disorganized | Enforce module boundaries and use-case interfaces inside the monolith; do not split deployment prematurely |
| Vendor dashboard configuration drifts | Maintain a deployment runbook and release checklist; keep source-controlled configuration where supported |

---

## 17. Walking-skeleton implementation gate

The first implementation increment is production-shaped but deliberately small. It must contain only:

1. repository/tooling and environment validation;
2. one deployable Next.js application;
3. health endpoint and structured redacted logging;
4. PostgreSQL connection, migration command and separate runtime/migration roles;
5. WorkOS staging authentication;
6. internal user mapping and three accepted roles;
7. one owner-only endpoint plus a proven operator denial;
8. one trivial transactional table write with an idempotency key;
9. unit, real-PostgreSQL integration and Playwright smoke tests;
10. staging deployment;
11. backup/restore rehearsal notes;
12. no real workbook import and no production customer data.

The walking skeleton is complete only when these proofs pass. It is not a visual prototype and it must not pretend that product scan, sale completion or offline stock logic exists.

After that gate, implementation proceeds through narrow vertical slices, beginning with read-only product/SKU lookup and then the online sale transaction.

---

## 18. Accepted decision record

ADR-008 was accepted and locked by Anmol on 21 July 2026. The approved bundle is:

- Next.js + TypeScript modular monolith;
- Node.js Active LTS backend runtime;
- PWA delivery rather than separate native apps in Phase 1;
- WorkOS AuthKit with TOTP MFA and recent-auth checks;
- existing Railway Pro workspace with the Node.js application and PostgreSQL colocated in Singapore;
- Railway private networking, scheduled backups and PostgreSQL PITR;
- explicit SQL/transactional PostgreSQL foundation;
- $20/month Railway Pro minimum including usage credits, with actual resource usage measured and governed under Section 8;
- walking skeleton before business-feature implementation.

Any change to one component should state which constraint is improved and which cost, security or maintenance trade-off is accepted.

---

## 19. Official sources reviewed

- Next.js PWA guide: <https://nextjs.org/docs/app/guides/progressive-web-apps>
- WorkOS pricing: <https://workos.com/pricing>
- WorkOS AuthKit MFA: <https://workos.com/docs/authkit/mfa>
- WorkOS AuthKit passkeys: <https://workos.com/docs/authkit/passkeys>
- WorkOS reauthentication: <https://workos.com/docs/authkit/reauthentication>
- WorkOS session API: <https://workos.com/docs/reference/authkit/session>
- WorkOS Next.js SDK: <https://workos.com/docs/sdks/authkit-nextjs>
- WorkOS environments: <https://workos.com/docs/authkit/environments>
- Clerk pricing: <https://clerk.com/pricing>
- Auth0 pricing: <https://auth0.com/pricing>
- Railway pricing: <https://railway.com/pricing>
- Railway regions: <https://docs.railway.com/deployments/regions>
- Railway private networking: <https://docs.railway.com/private-networking>
- Railway PostgreSQL PITR: <https://docs.railway.com/volumes/point-in-time-recovery>
- Railway scheduled backups: <https://docs.railway.com/volumes/backups>
- Railway edge networking: <https://docs.railway.com/networking/edge-networking>
- Hostinger PostgreSQL support: <https://support.hostinger.com/en/articles/1583659-is-postgresql-supported-at-hostinger>
- Hostinger VPS: <https://www.hostinger.com/vps-hosting>
- Vercel pricing: <https://vercel.com/docs/pricing>
- Supabase pricing: <https://supabase.com/pricing>
- Supabase backups: <https://supabase.com/docs/guides/platform/backups>
- PostgreSQL explicit locking: <https://www.postgresql.org/docs/current/explicit-locking.html>
- OWASP ASVS: <https://owasp.org/www-project-application-security-verification-standard/>
