# ADR 0010 — Patient Portal Access Model

**Status:** Accepted · **Date:** 2026-10-01

## Decision
The patient portal is **code-gated and read-only**:

- Staff with `portals:manage` issue a display code (`cv-xxxxxxxxxx`) bound to one patient; only the SHA-256 hash is stored (`PortalToken.tokenHash`), default TTL 7 days, revocable, last-used tracked. The raw code is shown exactly once.
- Portal sessions use a **separate cookie** (`curavilo_portal`, httpOnly, 12 h) — never the staff session cookie. Login is rate-limited (10 attempts / 15 min per IP+MRN) and requires both MRN and code.
- Data surface is a fixed, patient-scoped projection: upcoming appointments, invoices + outstanding balances, **released** diagnostic results only, follow-ups, last 5 completed visits. No staff lists, no other patients, no write paths.
- Every portal login and session start is audited (`portal.token_created`, `portal.login`, `portal.token_revoked`).

## Staff portal
"My Day" composes the staff member's schedule, assigned/role tasks, notifications, certifications (expiry-tracked) and leave requests (owner/admin approval) from the existing domain models — no duplicate data model.
