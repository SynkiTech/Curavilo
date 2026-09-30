# ADR 0002 — Multitenancy & Data Isolation

**Status:** Accepted · **Date:** 2026-10-01

## Context
All healthcare records are tenant-scoped. The spec requires org/facility isolation, server-side derivation of scope, and defense in depth (application layer + database RLS).

## Decision
- Every tenant-owned table carries `orgId` (and `facilityId` where row scope is facility-level), with indexes on the scoping columns.
- Tenant scope is **always derived server-side** from the Session → Membership chain. Client-supplied `orgId`/`facilityId` is ignored for authorization.
- **Deviation (sandbox):** the dev database is SQLite via Prisma, which has no RLS. Isolation is enforced exclusively in the application data layer during development.
- **Deployment target:** Supabase PostgreSQL with RLS policies mirroring the application rules as defense in depth; the Prisma client connects with a non-bypassing role. Cross-tenant regression tests (spec §99) are planned against that configuration.

## Consequences
- App-layer scoping is the single source of isolation today; code review must treat "missing `orgId` filter" as a security defect.
- Migration to Postgres is a datasource + migration change; the query patterns (always scoped) already match RLS semantics.
