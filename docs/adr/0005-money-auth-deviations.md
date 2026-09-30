# ADR 0005 — Money, Auth & Environment Deviations

**Status:** Accepted · **Date:** 2026-10-01

## Money
All amounts are **integers in minor units** (kobo) with explicit `currency` codes on org/invoice/payment/sale. No floats; totals computed with integer arithmetic; display via Intl currency formatting. This exceeds the safety of `Decimal` for JSON round-trips and is portable across SQLite/Postgres.

## Authentication
- **Decision:** server-side sessions (opaque 32-byte token in an httpOnly cookie; SHA-256 hash stored in `Session`; scrypt password hashing via node:crypto).
- **Deviation from spec:** the spec names Supabase Auth. The sandbox has no Supabase; custom sessions keep email/password, secure session storage and privileged-role controls without new infra. Swap path: session issuance/verification is isolated in `src/lib/auth.ts`; Supabase Auth can replace it behind the same interface.

## Environment
- Dev DB: SQLite (`prisma/db/custom.db`). Production target: Supabase PostgreSQL (ADR 0002).
- AI provider: `z-ai-web-dev-sdk` server-side only, abstracted behind `src/modules/ai` so the model layer is replaceable.

## Consequences
- Financial math and session handling are dependency-free and deterministic.
- The Supabase/Postgres migration is concentrated in two files (datasource + auth), both documented here.
