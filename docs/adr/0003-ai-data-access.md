# ADR 0003 — AI Data Access

**Status:** Accepted · **Date:** 2026-10-01

## Context
The AI data agent is a defining feature. The spec forbids raw LLM database access, requires permission-before-retrieval, grounded answers, provenance, audit and rate limits.

## Decision
Two-phase agent over plain chat completions (no native function-calling dependency):
1. **Plan** — LLM must emit strict JSON `{ tool, params }` or `{ clarification }` from a tool catalogue embedded in the system prompt. Parsed and zod-validated server-side; invalid plans fall back to a safe "cannot determine" reply.
2. **Execute + Compose** — the selected tool runs deterministically inside tenant scope; only the validated result JSON is given back to the LLM to compose the final answer.

- Each tool declares: required permission, zod params, row limits, provenance metadata. Permission is checked before execution; denial is reported to the user as a permission limitation.
- Period parameters are date-normalized server-side (max 400-day window) — the model cannot inject SQL or unbounded ranges.
- Provenance (source, period, filters, count) is persisted with the AIMessage and rendered in the UI; every AI query writes an AuditEvent.

## Alternatives rejected
- Direct SQL generation (spec-forbidden, unsafe). · Embedding-only retrieval for numeric facts (non-deterministic; violates "no hallucinated numbers"). · Native tool-calling API (SDK support unverified; two-phase JSON keeps the same guarantees with zero extra dependencies).

## Consequences
- One tool call per question in this milestone; multi-step chaining is Phase 7.
- New analytics = adding a registry entry; enforcement is centralized.
