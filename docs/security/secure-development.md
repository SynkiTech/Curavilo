# Secure Development Lifecycle

## Gates (a feature is NOT done if any fails)

1. `bunx tsc --noEmit` - zero errors in src/ (build also enforces:
   `ignoreBuildErrors: false`).
2. `bun run lint` - clean.
3. `bash scripts/security-verify.sh` - all adversarial checks green.
4. Authorization + tenant scoping present for every new route (reviewed against
   `.claude/rules/security.md`).
5. New vulnerability classes get a permanent regression test in the suite.

## Pre-commit (developer-local)

- typecheck + lint + targeted tests (fast set).
- No `.env` values, no real patient data, no secrets in fixtures.

## CI (when the repository is hosted)

- On PR: typecheck, lint, security regression suite, dependency scan
  (npm audit/OSV), secret scan (Gitleaks / GitHub secret scanning), SAST
  (Semgrep / CodeQL where available).
- On staging deploy: build, migration validation, passive DAST (OWASP ZAP
  baseline), smoke tests.
- Branch protection: reviews required, security checks required, no direct
  pushes to production.

## Review agents / skills

- `.claude/rules/security.md` - durable security rules loaded for every task.
- `.claude/skills/security-audit` - how to run and interpret the security suite.

## Development rules (summary)

- Secure by default, deny by default, fail closed.
- Never implement authorization in the UI only.
- Never spread untrusted objects into database writes.
- Never log secrets or PHI; never return stack traces.
- All security tests must pass before release; do not suppress findings without
  a documented exception (`security-exceptions.md`).
