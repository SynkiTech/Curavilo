# Authorization Security

## Chain

```
cookie -> Session (DB) -> User (status ACTIVE) -> Membership (org, active)
       -> role | custom role | +GRANT/DENY overrides (protected stripped)
       -> AuthContext { orgId, facilityId, role, permissions[] }
       -> requireAuth(permission?) throws 401/403 BEFORE handler logic
       -> domain query re-scopes by orgId (+ facilityId for non-admins)
```

## Properties (all server-side, deny by default)

- 16 built-in roles + custom roles; role JSON filtered against the permission
  registry; protected permissions (`org:manage`, `roles:manage`) can never be
  granted through custom roles, overrides, or the roles API.
- **OWNER un-assignable**: registration creates the only OWNER; every
  administrative path (`staff-accounts` POST/PATCH SET_ROLE, `createStaff`,
  `updateStaff`) refuses OWNER.
- **Role changes require `roles:manage`** (OWNER-only) and revoke the target's
  sessions so stale permissions cannot ride an old session.
- **Facility isolation**: patient registry reads/updates/360, FHIR exports,
  follow-ups and portal-token creation are scoped to the active facility for
  non-OWNER/ADMIN; admins span the org deliberately.
- **No client-derived context**: role/permissions/orgId/facilityId in request
  bodies are ignored everywhere; the CSV import picks fields explicitly so
  tenant columns cannot be injected.
- Every state-changing action writes an append-only audit event with the
  server-derived actor.

## Verified by

`scripts/security-verify.sh` T3-T5: cross-tenant IDOR, cross-facility PHI
isolation, role self-escalation, module boundaries (accountant vs HR),
portal/permission-surface denials. All green.
