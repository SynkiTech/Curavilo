# Secrets Management

## Inventory (what exists, where it lives, how it dies)

| Secret | Generated | Stored | Shown | Revocation |
|---|---|---|---|---|
| Staff password | user | scrypt hash (`User.passwordHash`) | never | password change/reset |
| Facility gate credential | owner | scrypt hash (`FacilityCredential.passwordHash`) | never | owner credential change |
| Session token | 256-bit random | SHA-256 (`Session.tokenHash`) | httpOnly cookie | logout, deactivation, role change, reset |
| Gate token | 256-bit random | SHA-256 (`GateSession.tokenHash`) | httpOnly cookie | 30-min TTL, exit-facility |
| Portal token | 48-bit display code | SHA-256 (`PortalToken.tokenHash`) | once, to staff | revoke, 7-day TTL |
| Invite/reset token | 192-bit random | SHA-256 (`PasswordToken.tokenHash`) | once, one-time link | used/expired; sessions die on reset |
| Webhook signing secret | 192-bit random | SHA-256 hash + **AES-256-GCM encrypted copy** (`secretEnc`) | once at creation | endpoint delete |
| DB URL | ops | `.env` (gitignored) | never | rotation |
| AI provider keys | vendor | server-side SDK env | never client-side | vendor console |

## Rules enforced

- No secrets in source, repo, client bundles, or URLs (beyond the documented
  one-time link flows).
- `.env*` is gitignored; `.env.example` documents every variable with
  placeholders only.
- Encryption: AES-256-GCM via Node's standard library (`src/lib/secret-box.ts`);
  key = `CURAVILO_SECRET_KEY` (32-byte hex, REQUIRED in production - documented
  in `.env.example`). Without it, a deterministic dev-only fallback key is
  derived from `DATABASE_URL` (see `security-exceptions.md`).
- Console/log hygiene: adapters log recipient + type, never message bodies;
  Prisma query logging is dev-only; reset/invite link echo is dev/sandbox-only.
- Plaintext one-time tokens are never persisted in message previews
  (invitation `bodyPreview` is redacted text).

## Scanning

Add Gitleaks or GitHub secret scanning in CI when the repository is hosted
(outside sandbox scope; listed in `secure-development.md`).
