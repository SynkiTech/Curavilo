# Production Hardening — Status & Runbook Notes (spec §142)

**Status:** Accepted · **Date:** 2026-10-01
Sandbox-verified items are marked ✅; production-only items are listed as pending gates.

## Security
- ✅ Authentication: opaque 32-byte session tokens (SHA-256-hashed at rest), scrypt passwords, httpOnly cookies.
- ✅ Authorization: deny-by-default RBAC (23 permissions × 9 roles) enforced server-side on every route via `requireAuth(permission)`.
- ✅ Tenant isolation: every query scoped by `orgId` (+`facilityId` where applicable); cross-tenant probes return 404 (see `scripts/security-probe.ts`).
- ✅ AI controls: permission-before-retrieval, tool allowlist, injection-hardened plan prompt, LOW-risk-only ACT registry with human confirmation, 20 req/h rate limit. Eval suite: `bun tests/ai-eval.ts [--live]`.
- ⬜ Penetration test & third-party security review — production gate.
- ⬜ AI red-team by external reviewers (internal suite: `tests/ai-eval.ts --live`).

## Data & recovery
- ✅ SQLite (dev) → Postgres migration path documented (ADR 0001/0005); append-only audit; immutable financial records (void-not-delete).
- ✅ Backup/restore drill script: `bun scripts/backup-drill.ts` (back up, restore to scratch, verify row counts + integrity).
- ⬜ Scheduled backups + off-site copy, documented RPO/RTO — production gate.

## Performance
- ✅ Indexes on all tenant-scoped hot paths (org/facility/status/date per §72); queries reviewed with synthetic data volumes.
- ✅ Row caps on list endpoints (≤ 2000) and AI tool outputs; FHIR export capped at 200.
- ⬜ Load test with production-shaped volumes.

## Compatibility & accessibility
- ✅ Print profiles: A4/Letter/58 mm/80 mm via central DocumentRenderer + @page + print CSS (ADR 0004).
- ✅ Accessibility: semantic landmarks, labelled controls, aria-live regions, visible focus, reduced-motion support for animated backgrounds.
- ⬜ Browser matrix pass (Chromium/Firefox/Safari + mobile) — production gate.

## Operations
- ✅ `/api/health` — DB ping, latency, outbox/webhook backlog depth (for uptime probes).
- ✅ Structured error handling: typed `AppError` codes; ZodError → 400 with field paths; never swallow.
- ✅ Runbooks: see below.
- ⬜ External uptime monitoring, alerting onboarding, incident response drills, DPIA pack.

## Runbook: dev server down
1. `curl localhost:3000/api/health` → 503/000 means down.
2. Restart via the platform (gateway auto-starts `bun run dev`) or manually: `cd /home/z/my-project && bun run dev`.
3. Verify `/api/health` returns `{"status":"ok"}`; check `dev.log` for compile errors.

## Runbook: scheduler/webhook backlog growing
1. `/api/health` shows `pendingOutbox` / `pendingWebhooks`.
2. Inspect `OutboxEvent.lastError` / `WebhookDelivery.lastError`; webhook endpoints auto-dead-letter after 5 attempts (resume by re-creating or re-queuing).
3. All scheduler jobs are idempotent — a restart of the server resumes cleanly.

## Runbook: backup restore drill
`bun scripts/backup-drill.ts` — asserts a fresh restore matches live row counts for core tables before completing.
