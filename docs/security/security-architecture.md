# Curavilo Security Architecture

## Layers (defense in depth)

```
Edge (Caddy)      TLS termination, XFF overwrite, port isolation
Middleware        CSP(nonce) + security headers + CSRF origin assertions + no-store for /api
Route handlers    requireAuth(permission) -> Zod parse -> domain call -> generic errors
Domain modules    tenant scoping (org always; facility for non-admins), server-side
                  financial math, idempotency, per-org write locks, audit events
Data layer        Prisma parameterized only; secrets hashed; money integer minor units
```

## Core decisions

| Decision | Rationale / where |
|---|---|
| Opaque DB-backed sessions (256-bit random, SHA-256 at rest) | Revocable server-side instantly (deactivation, password change, role change) |
| Two-stage access (gate -> personnel) | Workspace credential never confers identity; every action attributable to a person (ADR 0011) |
| Fail-closed `requireAuth` | Missing/stale/ambiguous context -> 401/403; `mustChangePassword` blocks all APIs |
| Protected permissions (`org:manage`, `roles:manage`) | Never grantable via custom roles or overrides; OWNER is unassignable |
| Facility PHI isolation | Non-admin roles see only their active facility's patient registry/FHIR/exports; OWNER/ADMIN span the org |
| AI as untrusted component | Registry-only tools, permission-gated, strict param schemas, bounded results, plain-text rendering, human-confirmed actions |
| Append-only audit | `AuditEvent` has no user-facing edit/delete path; actor derived from session |
| Integer money + server-side totals | Client prices/totals never trusted; idempotency keys on payments |
| AES-256-GCM secret box | Webhook signing secrets recoverable for HMAC without plaintext storage |
| SSRF URL guard | All outbound fetches of user-registered URLs validated (scheme, credentials, DNS, IP ranges), `redirect: "error"`, 10 s timeout |

## Trust the architecture does NOT grant

- The browser: all authorization server-side.
- The model: instructions in prompts/records are data.
- The edge limiter: login/gate brute force also has DB lockouts.
- UUIDs: every lookup re-verifies tenant scope.
