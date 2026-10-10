# Dependency Security

## Current posture (hardening pass)

- Pruned unused supply-chain surface: removed `next-auth` (unused; custom auth
  is used), `react-markdown`, `react-syntax-highlighter` (ReDoS history,
  unused), `@mdxeditor/editor`, `next-intl`, `uuid`. `next-themes` kept (used
  by the toast layer).
- Remaining stack is current-major and actively maintained: next 16, react 19,
  prisma 6, zod 4, tailwind 4, framer-motion 12, recharts 2, sharp 0.34,
  lucide, radix set.
- `z-ai-web-dev-sdk` is pre-1.0 and closed-source: pin the version, review
  updates before upgrading, treat as a vendor boundary (it terminates AI
  credentials).
- Lockfile (`bun.lock`) is committed; installs are reproducible.

## Process

1. Before adding a dependency: justify it, check maintenance status, license,
   and known advisories; prefer package-managed/self-hosted assets over CDNs.
2. Regularly run `bun pm ls` + an advisory scanner (npm audit / OSV-Scanner /
   Dependabot once hosted). Triage findings; never blanket-ignore.
3. Upgrades of security-sensitive libraries (next, prisma, sharp) are reviewed
   for breaking changes and run through the full security suite
   (`scripts/security-verify.sh`) + build gate before merge.
4. CI (when hosted) runs typecheck, lint, security tests, dependency scan and
   secret scan on every pull request (see secure-development.md).
