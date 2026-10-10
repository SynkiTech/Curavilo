# Curavilo Security Assessment

Date: 2026-10-10 (security hardening pass over the full application)
Scope: application code, database layer, AI plane, auth/authz, headers,
supply chain, documentation. Per the assessment vocabulary of the master
security prompt: **Verified / Partially verified / Not implemented /
Requires external assessment**.

## Executive summary

A full-repository audit (all API routes, domain modules, AI agent, auth core,
dependencies, config) identified 1 Critical, 4 High, 9 Medium and several Low
findings. All Critical and High findings were fixed at the root cause, plus 14
of the Medium/Low items; the remainder are documented exceptions with
compensating controls. After remediation, the adversarial regression suite
(**73 checks**) passes green, the production build with type-checking passes,
and a browser E2E confirms the new CSP does not break any flow.

**Release posture:** no known unresolved Critical issue exists. Deployment to
production additionally requires the external items listed at the end.

## Findings and remediation (root-cause grouped)

### Input trust (Critical)
- CSV import COMMIT spread raw client rows over tenant columns (cross-tenant
  patient write). Fixed: route-level Zod schema (strict field set) + module-level
  explicit field picking; tenant columns can never be overridden. Regression: T6.

### Privilege management (High)
- Role changes (incl. OWNER) reachable with `staff:manage`; broken imports made
  the legacy staff detail module crash at runtime. Fixed: dead legacy module and
  routes deleted (obsolete-API removal); live surfaces enforce `roles:manage`;
  OWNER is unassignable on every path; protected permissions already stripped.
  Regression: T5.

### Outbound request trust (High)
- Webhook deliveries fetched arbitrary admin-registered URLs (SSFR pivot), HMAC
  was keyed on the secret hash, inbound verification had no replay window. Fixed:
  `url-guard` (scheme allowlist, credential ban, DNS resolve + private/loopback/
  metadata IP ranges, `redirect: "error"`, per-attempt re-check), AES-256-GCM
  secret box keyed by `CURAVILO_SECRET_KEY`, 5-minute freshness window.
  Regression: T7.

### Resource consumption (High/Medium)
- Missing rate limits on register/exports/reports/FHIR/simulation/audit-prints;
  limiter relied on a spoofable header. Fixed: targeted limits on all of them;
  server-side DB lockouts for staff login AND the facility gate (IP-independent);
  documented proxy trust model. Regression: T8.

### Authorization completeness (Medium)
- Portal token list/revoke lacked `portals:manage`; pending-leave list lacked
  `hr:read`; certification-by-staffId accepted unscoped references; workflow
  definitions readable by any staff; FHIR bypassed the `mustChangePassword` gate.
  All fixed and regression-tested (T5).

### Tenant scope consistency (Medium)
- Patient registry/FHIR were org-scoped for everyone. Fixed: non-admin roles are
  now facility-scoped for patient reads/updates, follow-ups and FHIR resources;
  OWNER/ADMIN deliberately span the org. Regression: T4 (fixture facility).

### Information & log hygiene (Medium)
- Health endpoint leaked DB error text (fixed: state words only, details to
  server log); Prisma query logging echoed PHI in production (fixed: dev-only);
  comms adapter logged message bodies (fixed: recipient+type only); invite tokens
  persisted in message previews (fixed: redacted); dev credential echo tightened
  to explicit sandbox/development modes; staff-accounts audit queries got org
  filters; pre-auth body parsing removed from invoices/sales PATCH.

### Platform hardening (Medium)
- No security headers/CSP/CSRF assertions existed. Fixed: `src/middleware.ts` -
  per-request nonce CSP (`strict-dynamic`, no unsafe-eval in production),
  X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP,
  HSTS in production, `Cache-Control: no-store` for /api, and Origin/
  Sec-Fetch-Site 403s for cross-site state-changing calls. Runtime-verified in
  the browser (zero console/page errors; hydration clean after externalizing the
  one inline script).

### Crypto & secrets (Low/Medium)
- Portal codes bumped to 48 bits; portal cookie now uses the shared secure
  cookie policy; `.env.example` added; 6 unused dependencies removed;
  logo/photo/brand-color validation unified (raster-only MIME regex, hex color).

## Scorecard (§222 - no numeric score)

| Domain | Status | Critical | High | Medium | Low | Tests passed | Tests failed | Exceptions |
|---|---|---|---|---|---|---|---|---|
| Authentication | Verified (MFA missing) | 0 | 0 | 0 | 1 | T2/T8/T11 | 0 | E-1, E-5 |
| Authorization | Verified | 0 | 0 | 0 | 0 | T5 (10) | 0 | - |
| Tenant isolation | Verified | 0 | 0 | 0 | 0 | T3/T4 (10) | 0 | E-3 (RLS at migration) |
| API | Verified | 0 | 0 | 0 | 0 | T1/T9 (26) | 0 | - |
| Database | Verified (sandbox engine) | 0 | 0 | 1 | 0 | T3/T4/T6 | 0 | E-3 |
| AI | Verified | 0 | 0 | 0 | 0 | T10 (4) | 0 | - |
| Files/exports | Verified | 0 | 0 | 0 | 0 | T7 + code review | 0 | - |
| Payments/POS | Verified | 0 | 0 | 0 | 0 | existing suites | 0 | payment-provider webhooks not yet a feature |
| Workflow | Verified | 0 | 0 | 0 | 0 | permission gates | 0 | - |
| Sessions | Verified | 0 | 0 | 0 | 0 | T2 + code review | 0 | - |
| Secrets | Verified | 0 | 0 | 0 | 1 | secrets scan | 0 | E-4 |
| Headers/CSP/CSRF | Verified | 0 | 0 | 0 | 0 | T9 (8) | 0 | - |
| Rate limiting | Partially verified | 0 | 0 | 1 | 0 | T8 | 0 | E-2 (shared store) |
| Supply chain | Partially verified | 0 | 0 | 0 | 0 | prune + lockfile | 0 | hosted CI scanner |
| Monitoring/alerting | Partially verified | 0 | 0 | 1 | 0 | audit substrate | 0 | alert pipeline external |
| Privacy (NDPA support) | Partially verified | 0 | 0 | 0 | 0 | - | 0 | DPIA/legal external |
| Backup/DR | Partially verified | 0 | 0 | 0 | 0 | backup drill | 0 | prod schedule external |

Totals: 0 unresolved Critical, 0 unresolved High, 3 Medium (documented), 2 Low.

## Remaining risks and required external work

1. MFA (OWNER first) - roadmap feature.
2. Shared-store rate limiting + alerting pipeline for multi-instance production.
3. RLS on Postgres migration (second belt under the data-layer scoping).
4. External: penetration test, DAST on staging, formal DPIA/NDPA counsel,
   vendor reviews (AI/SMS/email), infrastructure review (TLS/HSTS edge, backup
   encryption), hosted CI with secret/SAST/dependency scanning.

## Verified by

- `bash scripts/security-verify.sh` -> PASS=73 FAIL=0
- `bunx tsc --noEmit` (src clean) · `bun run lint` clean · `bun run build`
  with `ignoreBuildErrors: false` -> success
- Browser E2E under the new CSP: landing, two-stage login, dashboard, patients,
  AI grounded answer - zero page errors, zero console errors.
