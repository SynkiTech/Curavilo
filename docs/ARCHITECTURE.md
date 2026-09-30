# Curavilo — Architecture

## 1. Overview

Curavilo is a configurable, multi-tenant, AI-powered healthcare operating platform. This milestone implements the foundation (Phase 0–3 of the master spec) as a working vertical slice: onboarding → service profiles → patient operations → billing/documents → inventory/POS → workflow v0 → AI data agent.

## 2. Application shape

Modular monolith on Next.js 16 (App Router), TypeScript strict, deployed as one application.

```text
src/
├── app/
│   ├── page.tsx            # Single visible route: Curavilo SPA shell (sandbox preview constraint)
│   ├── layout.tsx
│   └── api/                # Backend boundary (Route Handlers) — auth, domain resources, ai
├── modules/                # Domain services (business logic, no HTTP/UI concerns)
│   ├── auth/  org/  patients/  scheduling/  clinical/
│   ├── billing/  inventory/  sales/  ai/  workflows/  audit/
├── lib/                    # Cross-cutting: db, auth/session, rbac, money, numbering, audit, service-profiles
├── components/
│   ├── ui/                 # shadcn/ui
│   └── curavilo/           # App shell + views (SPA, state-based navigation)
└── types/
```

## 3. Request boundary (non-negotiable order)

```text
UI (SPA) → Route Handler → authenticate → authorize (RBAC + tenant scope) → validate (zod)
        → domain service (src/modules) → data access (Prisma, transactional where needed) → audit
```

- Tenant scope (`orgId`, `facilityId`) is ALWAYS derived from the server-side session and membership, never from client payloads.
- Business logic lives in `src/modules`, never in route handlers or UI components.
- Client components never touch the database.

## 4. Multi-tenancy

`Organization → Facilities → Departments/Staff/Patients/Workflows/Inventory/Transactions`.

Every tenant-owned row carries `orgId` (+ `facilityId` where relevant). All queries filter by the session-derived scope. Deviation (ADR 0002/0005): dev database is SQLite (no RLS); application-layer scoping is the enforced boundary; Postgres + RLS is the deployment target and is documented, not yet wired.

## 5. Deterministic core, probabilistic AI

- Deterministic: billing math, stock ledger, payment records, document numbering, permissions, audit, workflow state.
- AI never becomes the source of truth. AI answers go through the tool registry: authorize → plan → validate → deterministic query → grounded answer + provenance + audit (ADR 0003).

## 6. Money

All monetary values are integers in minor units (kobo for NGN) with an explicit `currency` code. No floats anywhere (ADR 0005).

## 7. Documents & printing

Central document engine: document type + data snapshot + facility branding + print profile (A4 / A5 / Letter / Thermal 58/80 mm) → renderer → browser print CSS. Reprints keep the original transaction; `REPRINT` marker rendered per configuration (ADR 0004).

## 8. Auditability

`AuditEvent` is append-only: actor, action, entity, org/facility, timestamp, summary, metadata. Printing/AI queries/financial mutations all write audit events. Never log sensitive payloads.

## 9. Workflow engine (v0)

Versioned workflow definitions (JSON nodes/edges, no executable code), draft/published/archived lifecycle, durable runs with state persisted in `WorkflowRun`. Triggers fire transactionally via `OutboxEvent`. Full timer/SLA/retry machinery is Phase 5 (see ROADMAP).

## 10. AI agent

See docs/AI-ARCHITECTURE.md. Tool registry with per-tool permission, zod-validated params, row limits, tenant scope, provenance and audit. Rate limited per user.
