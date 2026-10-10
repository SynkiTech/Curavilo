# ADR 0011: Two-Stage Facility Access, Personnel Accounts and Granular RBAC

Date: 2026-10-01
Status: Accepted

## Context

Curavilo previously used a single-stage login: a personal email/password created a
session whose authorization came from an org-level `Membership.role`. Staff rosters
(`StaffMember`) were clinical directory records that did not participate in
authentication. The enhancement spec (§1-78) requires a two-stage access model,
individual personnel accounts, granular permissions, custom roles and role-aware
dashboards, while preserving existing users and not breaking working authentication
(§64-65, §78).

## Decision

### 1. Two-stage access, one identity system

We do NOT create a second authentication system. Both stages reuse the existing
scrypt + DB-backed opaque session machinery (ADR 0005):

```
Stage 1  Facility gate   -> FacilityAccess credential (hashed) -> FacilityContext cookie (short-lived)
Stage 2  Personnel gate  -> personal User credential + StaffMember/Membership check -> Session cookie (existing)
```

- `FacilityAccess` holds the facility workspace credential (unique email, scrypt
  hash, failure lockout). It authorizes NOTHING except reaching the personnel gate.
  It is never used to derive role or permissions (§2-4).
- `FacilityContext` is a server-verifiable, DB-backed context (token hash, org +
  facility, 4 h expiry). The browser only receives an opaque HttpOnly cookie; no
  facility secret lives in frontend state or localStorage (§48).
- Stage 2 resolves the person: `User` (password, lockout, `mustChangePassword`)
  plus a facility-scoped membership check (§49-50):
  - `Membership` role OWNER/ADMIN (org-scoped) may access every facility of the org
    (§27 owner clause).
  - everyone else must have a `StaffMember` row for the gated facility whose status
    is ACTIVE.
- Final authorization = facility context + user + membership/staff record + role +
  resolved permissions (§49). Every sensitive action keeps a real user identity.

### 2. Staff lifecycle

`StaffMember` becomes the personnel record (§6): name parts, work email, phone,
staff number, service line, employment status, photo, and a lifecycle status
(INVITED | ACTIVE | INACTIVE | SUSPENDED | LOCKED | TERMINATED). Staff are never
deleted; they are deactivated and historical references remain intact (§6, §28).

Account creation supports both spec options (§7): invitation via a hashed single-use
`PasswordResetToken` (kind INVITE, 7-day TTL, staff sets their own password), or an
owner-issued temporary password which forces a password change at first login
(`User.mustChangePassword`). The temporary password is shown once at creation for
in-person handover, never logged or stored in plaintext.

### 3. Permissions and roles

- The existing colon-notation permission catalogue is extended (reports:export,
  roles:manage, payments:void) rather than replaced, so every existing
  `requireAuth(...)` check keeps working.
- ADMIN no longer equals OWNER: role/permission management (`roles:manage`) and
  complete audit access (`audit:read`) are removed from ADMIN and become owner-only
  capabilities (§11, §44). Facility credential management additionally requires
  `Membership.role === "OWNER"` (an explicit role boundary, §44).
- Custom roles: `CustomRole` rows are org-scoped name -> permission-list mappings.
  `PROTECTED_PERMISSIONS = ["roles:manage", "audit:read"]` can never be granted to
  a custom role or via per-user overrides, so custom roles cannot escalate into
  platform-critical capabilities (§25, §76).
- `PermissionOverride` rows (GRANT/DENY per user+org+permission) let owners tune
  individual access. DENY always wins; overrides can never grant protected
  permissions.
- Built-in roles gain OPTOMETRIST, OPTICIAN and DENTIST so eye/dental service
  profiles get first-class role dashboards (§15-18).

### 4. Role-aware dashboards (configuration, not branches)

`getDashboardConfig(role, permissions, serviceProfileKey)` (lib/rbac.ts) is the
single central resolver (§51, §74) that maps role + permission set + service
profile to: default view, allowed nav modules (permission AND profile.module gate,
§52-53) and dashboard widgets. The client renders whatever the server returns; it
never decides authorization. `/api/dashboard` assembles widget payloads
server-side, each gated by its own permission check.

### 5. Shared computers and session flow (§31-33)

- Staff logout (existing `logout` action) destroys only the personal session and
  returns the browser to the personnel gate (facility context survives until its
  short TTL expires) - the next employee signs in with their own credentials and
  never inherits the previous one's permissions or client state.
- "Exit Facility" destroys BOTH the personal session and the facility context.
- There is no instant user switching: every switch goes through the personnel gate
  and re-authentication.
- Password reset uses hashed single-use tokens (30 min) surfaced through the
  simulated email channel (CommunicationMessage console provider) because this
  deployment has no live mail provider; the flow is provider-swappable (§30).

### 6. Forced password change enforcement

When `User.mustChangePassword` is set, `requireAuth()` rejects every permissioned
API call with `password_change_required` until the password is changed. This makes
the forced change a server-side boundary, not a UI hint (§29).

## Consequences

- Existing users keep working: the direct personal sign-in remains available
  (legacy entry) and `POST /api/auth {action:"login"}` is unchanged; onboarding now
  additionally provisions the facility credential; a migration script backfills
  `FacilityAccess` and ACTIVE staff records for pre-existing orgs.
- Owner dashboards remain the richest; staff dashboards are composed from the same
  reusable widget components (§23, §67).
- The AI layer already enforces permission-before-retrieval per tool (ADR 0003);
  ACT-mode actions now carry an explicit permission requirement, keeping
  `AI actions ⊆ normal permissions` (§72).
- Rate limiting/lockout (5 failures -> 15 min) applies to both gates; errors stay
  generic to prevent enumeration (§62).
