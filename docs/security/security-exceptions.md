# Security Exceptions Register

No unresolved Critical issues exist. Every exception below documents issue,
impact, compensating controls, owner and status (spec §180, §224).

## E-1: Dev-only credential echo (Low, accepted)
- Issue: with `SANDBOX=1` or `NODE_ENV=development`, the API returns one-time
  reset/invite links and temp passwords in responses (no SMTP in sandbox).
- Impact: account takeover only on a machine with dev access to these modes.
- Compensating controls: strictly gated to sandbox/development; staging and
  production (`NODE_ENV=production`) never echo; admin-only surfaces still
  require `staff:manage`; links are single-use + expiring.
- Owner: platform. Deadline: none (documented dev affordance).

## E-2: In-memory rate limiting (Medium, roadmap)
- Issue: limiter is per-instance, resets on restart; `clientIp` trusts the edge
  (Caddy overwrites XFF in this deployment; direct exposure makes it spoofable).
- Impact: brute force/DoS limits can be sidestepped by restarting or
  horizontally scaling - except login/gate/portal, which ALSO have DB lockouts
  (staff account lock, org gate lock) that do not depend on IP at all.
- Compensating controls: DB lockouts for auth surfaces; deployment behind
  Caddy; production must introduce a shared-store limiter (Redis) with the same
  interface and set a real `CURAVILO_SECRET_KEY`/deployment topology.
- Owner: platform. Deadline: before multi-instance production deployment.

## E-3: No RLS in SQLite sandbox (Medium, by architecture)
- Issue: SQLite has no row-level security; tenant isolation is enforced solely
  in the data layer (orgId/facilityId in every query).
- Compensating controls: parameterized Prisma only; isolation regression suite
  (cross-tenant + cross-facility) green; Postgres migration must enable RLS as
  defense in depth.
- Owner: platform. Deadline: Postgres migration.

## E-4: Dev fallback key for webhook secret encryption (Low, accepted)
- Issue: without `CURAVILO_SECRET_KEY`, the AES key is derived from
  `DATABASE_URL` (deterministic dev fallback).
- Impact: a full DB + env compromise unlocks webhook secrets - but that
  compromise level already exposes session-token hashes' verification only via
  the DB anyway; production sets a dedicated key.
- Compensating controls: `.env.example` requires the key in production;
  secrets remain hashed for verification; key rotation procedure documented.
- Owner: platform. Deadline: production deployment.

## E-5: MFA not implemented (Medium, roadmap)
- Issue: no second factor yet; spec §23/§88 strongly recommends it for OWNER.
- Compensating controls: DB lockouts, 12 h idle timeout, session revocation on
  role/status change, audit + lockout alerting substrate.
- Owner: product. Deadline: roadmap (OWNER first, then admins).

## E-6: External assessments pending (Requires external assessment)
- Penetration test, DAST on a hosted staging target, formal DPIA/NDPA legal
  review, vendor security review for AI/SMS/email providers, infrastructure
  review (TLS/HSTS at the real edge, backup encryption, alerting pipeline).
