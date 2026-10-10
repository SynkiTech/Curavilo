# Database Security

## Engine & access

- SQLite in dev/sandbox (`DATABASE_URL`, gitignored); production targets a
  managed database with TLS and a least-privilege application account
  (ADR 0001 deviation documented).
- Single Prisma client; **no raw SQL anywhere except `SELECT 1` healthcheck**
  (safe tagged-template form). No `$queryRawUnsafe`/`$executeRawUnsafe`, no
  string-built SQL, no dynamic identifiers.

## Isolation

RLS is a Postgres/Supabase feature and does not exist in the SQLite sandbox.
The equivalent guarantee is enforced in the data layer: every tenant-owned
query includes `orgId` (and `facilityId` for non-admins) from the server
session - proven by the cross-tenant/cross-facility regression suite.
Migrating to Postgres later must add RLS as a second belt (documented in
`security-exceptions.md`).

## Integrity

| Invariant | Mechanism |
|---|---|
| Money consistency | Integer minor units; totals recomputed server-side; invoice/payment updates in transactions |
| Stock consistency | Per-org advisory write lock (`tx-lock.ts`), P2002 retry, movement ledger, no silent negative stock |
| Document numbering | Unique `(orgId, number)` + counters inside the same transaction |
| Audit immutability | `AuditEvent` has no user-facing write path except print logging (actor server-derived, rate-limited); no delete API |
| Referential safety | Foreign keys with explicit cascade rules; soft-delete states (ACTIVE/ARCHIVED/VOIDED/...) |
| Token confidentiality | All tokens/secrets hashed at rest (`tokenHash`, `secretHash`) or AES-GCM encrypted (`secretEnc`) |
| Backup | `scripts/backup-drill.ts` drills file backup + restore; production backup policy is infra responsibility |

## Logging hygiene

Prisma query logging (which echoes bound values) is **development-only**;
production logs errors only. See `logging-monitoring.md`.
