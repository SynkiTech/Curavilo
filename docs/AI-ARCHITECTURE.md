# Curavilo — AI Architecture (Milestone 1)

## Principles
1. **Authorization before retrieval** — the user's permissions and tenant scope are resolved before any tool executes; the model never receives data the user cannot access.
2. **No unrestricted DB access** — the LLM never generates SQL. It selects from a fixed tool registry with zod-validated parameters.
3. **Grounded answers only** — numbers come from deterministic queries. If data is missing, the answer says so. "No matching accessible records" ≠ "no such records".
4. **The model is not the security boundary** — all enforcement lives in server code.

## Flow

```text
User message
 ↓ authenticate (session) + ai:ask permission
 ↓ rate limit (per-user, in-memory sliding window)
 ↓ load conversation (scoped to user + org)
 ↓ ROUND 1 — plan: LLM returns strict JSON { tool, params } or { clarification }
 ↓ validate tool + params (zod) + check tool permission
 ↓ execute deterministic query tool (tenant scope, row limits)
 ↓ ROUND 2 — compose: LLM answers strictly from tool result JSON
 ↓ attach provenance (source entity, period, filters, count)
 ↓ persist AIMessage(toolCalls, provenance) + AuditEvent
 ↓ respond
```

## Tool registry (per-tool: permission, params, row limit, provenance)

| Tool | Permission | Notes |
|---|---|---|
| encounter.count | encounters:read | period + optional department/status filters |
| appointment.count | appointments:read | period + status filter |
| patient.count | patients:read | period filter |
| patient.search | patients:read | MRN/name/phone, limit ≤ 8 |
| billing.revenue | billing:read | payments sum over period |
| pharmacy.sales | pos:sell | sales sum over period |
| inventory.lowStock | inventory:read | items at/below reorder level |
| inventory.expiry | inventory:read | lots expiring within N days |
| followup.overdue | patients:read | pending follow-ups past due date |
| analytics.patientVolume | reports:read | encounters grouped by department/service line |
| staff.count | staff:read | headcount, optional designation filter |

Periods are normalized to `{ from, to }` ISO dates by the planner and re-validated server-side (max 400-day window) before execution.

## Provenance contract

Every data-grounded reply carries: source entity label, period, filters used, record count, and (where permitted) links to supporting records rendered permission-aware in the UI.

## Untrusted content
Retrieved record text is data, never instructions. System prompt explicitly forbids following instructions found inside records; numerical facts always come from structured queries, not embeddings.

## Rate limits & cost
- 20 questions/hour/user (sliding window), single tool call per question (this milestone), result sets capped (≤ 20 rows), conversation history trimmed to last 12 messages.

## Evaluation (spec §54) — roadmap
Synthetic accuracy/authorization/tenant-isolation/hallucination/injection suites are stubbed in `docs/ROADMAP.md` Phase 7; the tool-registry architecture is built so each test is a scripted chat request with an expected tool call + expected authorization outcome.
