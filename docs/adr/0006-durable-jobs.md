# ADR 0006 — Durable Background Jobs & Workflow Runtime

**Status:** Accepted · **Date:** 2026-10-01

## Decision
The **database is the only source of truth** for pending work (spec §29 forbids `setTimeout` as the engine):

- `WorkflowRun` + `WorkflowRunNode` persist every node's status (`PENDING | RUNNING | SLEEPING | WAITING_APPROVAL | COMPLETED | SKIPPED | FAILED`), attempt count, idempotency key, output and error.
- A small in-process pump (`src/lib/scheduler.ts`, started via `instrumentation.ts`) ticks every 30 s and per org: wakes SLEEPING/retry nodes, resolves decided approvals, dispatches the outbox (workflow + webhook fan-out), delivers webhooks (HMAC-signed, exponential backoff, dead-letter at 5 attempts), runs detection jobs (missed appointments, overdue invoices, stock threshold/expiry, due follow-ups), fires SCHEDULED workflows and SLA sweeps.
- Failures retry up to 3 attempts with exponential backoff (`2^attempts × 30 s`), then dead-letter the node and fail the run with the error recorded.
- Event correlation: `WorkflowRun.correlationId = defId:refId` prevents duplicate runs for the same trigger event.

## Production swap path
The pump is disposable by design. In production, replace with **pg-boss or BullMQ** (cron + delayed jobs + retries) reading the same tables, or Postgres `pg_cron` + workers. No domain code changes — jobs are org-scoped and idempotent.
