# Security Testing

## Test suites

| Suite | Location | Scope |
|---|---|---|
| Security regression suite | `scripts/security-verify.sh` | 73 adversarial checks: unauthenticated access, cross-tenant IDOR, cross-facility PHI isolation, privilege escalation, mass assignment, SSRF, gate lockout, headers/CSP, CSRF origin, AI red team, portal enumeration |
| Fixture helper | `scripts/security-fixture.ts` | Creates/removes cross-facility PHI fixture + probe orgs |
| E2E functional | `scripts/verify-task*.sh`, `scripts/e2e-*.sh` | Feature flows stay intact after security changes |
| Static gates | `bunx tsc --noEmit`, `bun run lint`, `bun run build` | Zero type errors (build-enforced), lint clean, production build passes |
| Browser E2E | agent-browser sessions | CSP runtime behavior, hydration cleanliness, core flows |

## Method

- Tests run against local development only with synthetic data (no third-party
  or production systems, no destructive payloads).
- Every discovered vulnerability becomes a permanent case in the suite; the
  suite must stay green.
- The test matrix (`security-test-matrix.md`) maps each threat to the check
  that proves it, with current results.

## Gaps (documented, not silently missing)

- DAST/passive scanning (OWASP ZAP) requires a hosted staging target - external.
- Load/performance testing is not part of the suite.
- MFA flows, SSO, and payment-provider webhooks are unimplemented features;
  their security tests arrive with the features.
