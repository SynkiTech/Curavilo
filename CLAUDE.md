# CLAUDE.md — Curavilo

Configurable, multi-tenant, AI-powered healthcare operating platform. Master spec: `docs/` + project brief. Non-negotiables:

## Architecture
- Modular monolith. Boundary: `UI → Route Handler → authenticate → authorize → validate(zod) → src/modules domain service → Prisma → audit`.
- Business logic lives in `src/modules/*` — never in route handlers or React components.
- UI is a state-based SPA served from `src/app/page.tsx`; backend is `src/app/api/*`.

## Security (see .claude/rules/security.md)
- Tenant scope (`orgId`/`facilityId`) is ALWAYS derived server-side from session/membership. Never trust client IDs.
- Every mutation: authenticate → authorize (RBAC in `lib/rbac.ts`) → zod validate → transact → audit.
- The AI is never a permission bypass; tools check permission BEFORE retrieval (ADR 0003).

## Data integrity
- Money = integer minor units + currency code. No floats, ever.
- Financial/audit rows are append-only; reversal via void flags, not deletion.
- Stock changes only through `StockMovement` ledger inside transactions.
- Document numbers from `NumberSequence` (atomic, per org/type/period). Never timestamps alone.

## AI (see .claude/rules/ai.md)
- `z-ai-web-dev-sdk`, backend only. Two-phase agent: plan (strict JSON tool call) → validate → deterministic tool → compose grounded answer + provenance + audit.
- No SQL generation, no embeddings for numeric facts, row limits on every tool.

## Frontend
- shadcn/ui + Tailwind 4. Calm healthcare palette (teal/stone); no indigo/blue unless asked. Loading/empty/error/permission states on every major view. Print profiles via print CSS (A4 / thermal 80mm).

## Discipline
- Coherent commits (`feat(billing): …`). No `any`, no swallowed errors, no commented-out code shipped. Evidence before "done": lint, dev.log, browser verification.
