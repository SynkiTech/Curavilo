# ADR 0001 — Initial Architecture

**Status:** Accepted · **Date:** 2026-10-01

## Context
Curavilo must be a serious multi-tenant SaaS but cannot start as microservices; the spec mandates "modular monolith first" and a phased roadmap.

## Decision
- Next.js 16 App Router + TypeScript strict as the single application.
- Domain modules in `src/modules/*` with an explicit request boundary: authenticate → authorize → validate → domain service → data access → audit.
- Route Handlers are the API boundary; UI is a state-based SPA served from `/` (sandbox preview constraint documented; a multi-route shell is a mechanical later split).
- Cross-cutting primitives live in `src/lib`: db (Prisma), rbac, money, numbering, audit, service-profiles, session auth.

## Consequences
- Fast iteration, one deployable, clear seams for later extraction.
- Discipline required: no business logic in route handlers or components (enforced by review).
- The single-route SPA is a deliberate sandbox accommodation, not an architectural statement; views map 1:1 to future routes.
