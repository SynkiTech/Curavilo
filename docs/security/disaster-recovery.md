# Disaster Recovery

## Objectives (honest, environment-dependent)

- RPO: bounded by backup frequency. Sandbox/dev: on-demand snapshots via the
  backup drill. Production: schedule backups (at minimum daily) -> RPO <= 24 h;
  with managed point-in-time recovery -> minutes. **Do not claim tighter RPO
  than the actually-scheduled backups.**
- RTO: single-host restore is minutes (file restore + restart); full region
  loss depends on the hosting provider.

## What must be backed up

1. Database (`db/custom.db` / managed DB) - contains all clinical, financial
   and audit state.
2. Environment/secrets: `DATABASE_URL`, `CURAVILO_SECRET_KEY` (without the key,
   webhook secrets cannot be decrypted), provider configs.
3. Deployment configuration (Caddyfile, next config).

## Restore procedure (drilled)

`scripts/backup-drill.ts` copies the SQLite database to
`download/backups/curavilo-<timestamp>.db` and verifies integrity with
`PRAGMA integrity_check`. Restore = stop app, replace DB file (or restore
managed snapshot), restart, run `/api/health`, spot-check a tenant.

Recorded drill results (date, recovery time, anomalies) belong in the ops
runbook of each deployment.

## Dependencies

- Hosting/provider outage: document the provider's SLA; the app is stateless
  apart from the DB and can be re-deployed to any host.
- Third-party failures (AI, SMS, webhooks) degrade features but never corrupt
  data: deliveries queue with retries and dead-lettering, AI fails safely.

## Protection of backups

Backups inherit the sensitivity of the data: store them with access control and
encryption at rest in production; restrict who can download them; audit
restores. Never place backups in a public bucket.
