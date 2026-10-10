# Authentication Security

## Model

Two stages (ADR 0011): facility gate (workspace credential, permissionless,
30-min sliding) then personal staff login (session = 7-day absolute,
12-hour idle timeout, sliding). All state is server-side (`Session`,
`GateSession`); cookies are opaque 256-bit tokens, `httpOnly`, `SameSite=Lax`,
`Secure` in production, `path=/`.

## Controls

| Control | Implementation | Status |
|---|---|---|
| Password storage | scrypt (N=16384,r=8,p=1, 64-byte key, per-user salt), `timingSafeEqual` compare | Verified |
| Password policy | 8-100 chars, letter + digit; forced change on temp passwords (`mustChangePassword` gates ALL APIs) | Verified |
| Brute force: staff login | 30/5min IP+email limiter AND DB lockout: 5 failures -> 15-min lock + `staff.locked` audit | Verified |
| Brute force: facility gate | 30/5min limiter AND DB lockout: 8 failures -> 15-min org lock + `facility.gate_locked` audit | Verified |
| Brute force: registration | 5/hour per IP | Verified |
| Brute force: portal login | 10/15min per IP+MRN, generic error message | Verified |
| Enumeration | Login/portal/reset responses never distinguish account existence | Verified |
| Reset/invite tokens | 192-bit random, SHA-256 at rest, single-use, expiring (30 min reset / 7-day invite), all sessions die on reset | Verified |
| Password change | Kills all other sessions of the user | Verified |
| Deactivation/suspension | Status re-checked every request; sessions revoked server-side | Verified |
| Idle timeout | 12 h unused -> session deleted; sliding window throttled to 1 write/min | Verified |
| Housekeeping | Expired sessions/gates pruned opportunistically on gate login | Verified |
| Logout | Deletes server session row + cookie; "Exit facility" also clears gate (shared-computer safe) | Verified |
| MFA | Not implemented | Not implemented (roadmap; recommended for OWNER first) |
| Shared workstations | Gate TTL 30 min; session idle 12 h; exit-facility full clear; no PHI in browser storage | Verified |

## Sandbox/dev-only exceptions

- `SANDBOX=1` or `NODE_ENV=development` echoes the reset link / invite link /
  temp password in the API response (no SMTP in sandbox). Staging/production
  (`NODE_ENV=production`) never receives them. See `security-exceptions.md`.
