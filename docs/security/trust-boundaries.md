# Curavilo Trust Boundaries

Every arrow marks a point where **untrusted data crosses into a higher-trust
zone** and must be validated/authorized at the crossing.

```
┌───────────────────────────────────────────────────────────────────────┐
│ Zone 0: Browser (untrusted)                                           │
│  - React SPA, no tokens in JS-readable storage                        │
│  - All client input is hostile: bodies, query params, URLs, headers   │
└──────────────┬────────────────────────────────────────────────────────┘
               │ HTTPS (HSTS in prod) · CSP with nonce · SameSite cookies
               │ ── middleware: origin/Sec-Fetch-Site check (state-changing)
               ▼
┌───────────────────────────────────────────────────────────────────────┐
│ Zone 1: Next.js route handlers (semi-trusted)                         │
│  - parseBody/parseQuery (Zod) at the crossing                         │
│  - requireAuth(permission): session -> AuthContext (fail closed)      │
│  - mustChangePassword gate; protected permissions un-grantable        │
└──────────────┬────────────────────────────────────────────────────────┘
               │ server-side context only (orgId/facilityId/role/permissions)
               ▼
┌───────────────────────────────────────────────────────────────────────┐
│ Zone 2: Domain modules (trusted business logic)                       │
│  - patients, billing, sales, inventory, staff, hr, accounting, ...    │
│  - every query scoped by ctx.orgId (+ facility for non-admins)        │
│  - financial totals recomputed server-side; idempotency keys          │
└──────────────┬────────────────────────────────────────────────────────┘
               │ Prisma parameterized queries only (no raw SQL except
               │ `SELECT 1` healthcheck)
               ▼
┌───────────────────────────────────────────────────────────────────────┐
│ Zone 3: SQLite database                                               │
│  - secrets stored hashed; money as integer minor units                │
│  - append-only AuditEvent                                             │
└───────────────────────────────────────────────────────────────────────┘

AI plane:
Browser -> /api/ai (requireAuth ai:ask + per-user rate limit)
        -> AI orchestrator (planner prompt; instructions = untrusted)
        -> Tool registry (each tool: permission + .strict() param schema
           + org/facility scope + bounded result)  [BOUNDARY]
        -> Domain modules (Zone 2) -> DB (Zone 3)
Model output = untrusted: rendered as plain text; action plans schema-validated
and executed only after explicit human confirmation (human-in-the-loop).

Outbound integrations:
Application -> Webhook endpoints (user-registered URLs)   [SSRF boundary]
             - URL validated: https-only (prod), scheme + host/IP deny-list
               (loopback, RFC1918, link-local, cloud metadata), no redirects
             - HMAC-SHA256 signed with endpoint secret; 10 s timeout
Application -> AI provider (web_search / chat)            [vendor boundary]
             - minimized data; no credentials/PHI-bulk; vendor review required
Application -> SMS/Email providers (adapter interface)    [vendor boundary]
             - console simulation in dev; production adapters implement
               same interface; minimum-necessary notification content

Unauthenticated surfaces (hardened, rate-limited):
- POST /api/auth (register / facility-login / staff-login / forgot / reset /
  invite-accept): Zod + IP+identity rate limits + DB lockout + safe messages
- POST /api/portal?scope=login: code+MRN gate, rate limited, read-only data
- GET /api/health: no internals leaked
```

## Crossing rules (enforced in code)

1. Client-provided IDs (patientId, staffId, invoiceId, ...) never imply
   authorization; every lookup re-derives scope from the server session.
2. Client-provided tenant fields (orgId, facilityId, role, permissions,
   paymentStatus, totals, prices) are never trusted; import rows are
   field-picked, mass assignment impossible.
3. AI output and tool results are data, never instructions; no tool exists
   that executes SQL/shell/templates.
4. Anything leaving the tenant boundary (CSV export, FHIR bundle, webhook
   payload, comms message) must be permission-checked, minimized and audited.
