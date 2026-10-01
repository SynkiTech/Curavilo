# ADR 0011 - Multi-Level Facility Access, Personnel Identity and Granular RBAC

Date: 2026-10-02
Status: Accepted
Context: Enhancement spec "Multi-Level Facility Access, Personnel Accounts, Role-Based Dashboards and Permissions".

## Decision

### 1. Two-stage access is implemented as two distinct server-verified sessions

- **Stage 1 - Facility Access Gate**: `FacilityCredential` (one per organization; email + scrypt hash). A successful gate login creates a `GateSession` row (SHA-256 token hash in an HttpOnly cookie, `curavilo_gate`). The gate session means exactly "this browser passed the facility gate for org X" and confers **zero permissions**. TTL is 30 minutes with **sliding renewal** on use, so a shared reception machine keeps the personnel screen available through a shift but never holds an indefinitely valid facility context. "Exit Facility" destroys both gate and staff sessions and clears client state.
- **Stage 2 - Personnel Gate**: `staff-login` requires a valid gate session AND resolves an individual `User` with an active `Membership` in that org, `status = ACTIVE`, not locked. The existing scrypt+opaque-token `Session` model remains the only application session. No dashboard is reachable without a personnel identity.

Rationale: the codebase already owns a clean custom auth system (ADR 0005); bolting a second identity provider would violate the spec's "no duplicate identity models" rule. The facility credential is a *workspace access abstraction*, stored hashed, never used for authorization, never exposed after creation.

### 2. Migration strategy (backward compatibility)

`scripts/migrate-facility-access.ts` creates a `FacilityCredential` for every existing organization by **copying the OWNER user's password hash**, so the email+password owners already use continues to open the facility gate, then the same personal account authenticates at stage 2. Owners can change either credential independently afterwards (Settings, `org:manage`). All existing users become `ACTIVE` with facility memberships seeded.

### 3. Permissions: role defaults + custom roles + overrides, with a protected platform boundary

- `AuthContext.permissions` is resolved server-side on every request:
  `role defaults` (rbac) or `CustomRole.permissions` (when membership.customRoleId set), then `+ GRANT overrides - DENY overrides`.
- `PROTECTED_PERMISSIONS = ["org:manage", "roles:manage"]` are OWNER-only by construction: custom roles cannot contain them, overrides cannot grant them, the APIs strip them. ADMIN is **no longer** `ALL`: it loses exactly these two, per spec §11/§44.
- New built-in roles: OPHTHALMOLOGIST, OPTOMETRIST, OPTICIAN, DENTIST, INVENTORY (eye/dental service-profile roles stay configuration-driven; role only decides modules/widgets).

### 4. Facility-level assignment

New `FacilityMembership` (userId, facilityId) limits which facilities a user may open. OWNER (and ADMIN) implicitly span all facilities of the org; everyone else only assigned ones. `switch-facility` and `getAuth` enforce this server-side.

### 5. Staff lifecycle

`User.status`: INVITED / ACTIVE / INACTIVE / SUSPENDED / LOCKED / TERMINATED. Only ACTIVE authenticates. Deactivation/suspension/termination destroys all sessions immediately. Invitations and password resets use single-use hashed `PasswordToken` rows (30 min TTL). Owner-created temporary passwords set `mustChangePassword`, enforced server-side (`403 must_change_password` on every API until changed). Failed logins rate-limit in-memory (10/5min per email+IP) and lock the account for 15 minutes after 5 consecutive failures.

### 6. Email delivery simulation

The sandbox has no SMTP. Invitation / reset links are returned once in the API response in non-production (SANDBOX=1) so the owner can hand them over; responses are generic otherwise to prevent enumeration. Documented as the swap point for a mail provider (same pattern as comms adapters).

### 7. Dashboards are configuration, not code branches

`src/lib/dashboard-config.ts` resolves role + custom role + service profile into an ordered widget list and quick actions. The overview renders the same shell with role-configured widgets; personalization (visibility/order) is stored per-browser (localStorage) and can only ever hide or reorder widgets the resolver already allowed - it cannot create access. Server APIs independently gate every dataset.

## Consequences

- Every action still carries a real user identity; the facility credential can never act.
- AI inherits the resolved permission set automatically (tools check `ctx.permissions`); department/service line added to the AI context.
- SQLite note: Postgres RLS (spec §43) remains a deployment-time defense-in-depth step; application-level tenancy scoping stays the primary boundary in this sandbox.
