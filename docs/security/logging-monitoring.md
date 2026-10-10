# Security Logging & Monitoring

## What is logged (AuditEvent, append-only)

Authentication lifecycle (login, logout, lock, gate pass/lock, reset requested/
completed, invitation accepted), authorization-relevant changes (role assigned/
changed, permission overrides, staff status transitions, custom role CRUD),
financial actions (payments, voids, refunds, expenses approval/pay), inventory
adjustments, data exports/imports, FHIR exports, AI queries, portal token
creation/revocation/login, print events, workflow publishes/runs.

Every event carries: orgId, facilityId, actorUserId + actorLabel (server-derived,
never client-supplied), action, entityType/Id, bounded summary, optional
non-sensitive metadata, timestamp.

## Do-not-log rules (implemented)

- No passwords, tokens, or hashes of tokens in logs or messages.
- No full patient records or clinical notes in audit summaries (bounded 300-char
  action summaries only).
- Comms adapters log recipient + type, never bodies.
- Prisma query logging (echoes bound values) is development-only.
- Reset/invite links are never persisted in message previews.

## Integrity

The audit trail has no user-facing update/delete path; the only client-facing
write (`document.printed`) derives its actor from the session, validates shape
via Zod, and is rate limited. Backup drill (`scripts/backup-drill.ts`) covers
audit data. Tamper-evident external log shipping is a production ops task.

## Alerting (production roadmap)

Wired-in-app today: lockout events + audit trail as the detection substrate.
Production should alert on: repeated login failures, gate lockouts, mass
exports, unusual AI volume, repeated permission failures, cross-tenant probe
patterns. (See `security-exceptions.md` - requires external infra.)
