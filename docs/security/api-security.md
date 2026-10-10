# API Security (OWASP API Security Top 10 mapping)

Full route inventory with auth/permission/tenant/validation/rate-limit verdicts
lives in `scripts/security-verify.sh` (executable inventory) and the security
assessment. Summary of how each API Top 10 risk is addressed:

| Risk | Defense |
|---|---|
| BOLA (object-level authz) | Every ID-bearing query re-derives `orgId`(+`facilityId`) from the session; cross-tenant/cross-facility access returns 404. Regression-tested (T3/T4). |
| Broken authentication | Opaque hashed sessions, lockouts, safe messages, `mustChangePassword` gate, fail-closed `getAuth`. |
| Broken object property-level authz | DTO-style selects (password hashes never serialized; staff lists expose profile fields only); role/permission fields stripped from client input everywhere. |
| Unrestricted resource consumption | Rate limits: AI 30/h+user, FHIR 30/10min, reports 30/10min, simulation 10/10min, exports 10/10min, audit prints 60/min, register 5/h, logins 30/5min + DB lockouts; list endpoints capped (`take` <= 200/2000); CSV <= 400 KB; AI message <= 1000 chars, <= 3 tool steps. |
| Broken function-level authz | Every privileged action has an explicit permission; `mustChangePassword` blocks everything; regression suite probes the sensitive surfaces per role. |
| Sensitive business flow abuse | POS/payments: per-org write locks, idempotency keys, server-side totals; registration rate limited. |
| SSRF | `src/lib/url-guard.ts` on webhook destinations (scheme allowlist, credential ban, DNS resolution + private/loopback/metadata IP ranges, `redirect: "error"`, 10 s timeout, re-check per delivery attempt). |
| Security misconfiguration | Security headers + CSP(nonce) via middleware; `Cache-Control: no-store` on all API responses; production build type-checks; generic error surfaces. |
| Improper inventory | Dead/legacy routes removed (legacy staff detail API, facility-access route, dashboard module). Every route is action-dispatched and schema-validated. |
| Unsafe consumption of APIs | Outbound webhook responses never executed/trusted; third-party data (AI search results) rendered as text with clickable metadata only. |

## CSRF

`SameSite=Lax` on all auth cookies is the primary control. Middleware adds
defense in depth: `POST/PUT/PATCH/DELETE /api/*` with `Sec-Fetch-Site:
cross-site` or a mismatching `Origin` header are rejected 403. Non-browser
clients (no headers) pass - API contracts stay scriptable.

## Error surfaces

`fail()` returns generic 500s ("Something went wrong..."), maps Prisma
`P2002`->409 duplicate and lock-timeouts->503 server_busy, never returns stack
traces, SQL, or internal paths. Correlation is server-side via `console.error`.
