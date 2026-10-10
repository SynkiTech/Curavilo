# Incident Response Plan

## Lifecycle

```
Detect (alerts/audit/user report)
  -> Contain (revoke sessions, lock accounts, disable endpoint, rotate secrets)
  -> Investigate (AuditEvent timeline, session rows, delivery logs, backups)
  -> Eradicate (fix root cause, patch, regression-test)
  -> Recover (restore from backup if needed, verify integrity)
  -> Notify (affected facility owner, NDPC/individuals if personal-data breach
     thresholds are met - legal counsel decides; see privacy.md)
  -> Learn (post-incident review, new security tests, threat-model update)
```

## Platform capabilities that support IR

| Need | Capability |
|---|---|
| Revoke one staff session | logout / session delete |
| Revoke every session of a user | deactivation, suspension, password reset (`destroyUserSessions`) |
| Lock an account instantly | `LOCKED` status (login refused, sessions revoked) |
| Lock the facility gate | DB lockout after 8 failures; owner can rotate the gate credential |
| Kill all tokens | password reset invalidates sessions; portal tokens revocable; webhook endpoints deletable |
| Forensic timeline | append-only AuditEvent with actor identity |
| Recover data | backup drill script; production backups per disaster-recovery.md |

## Scenario playbooks (abridged)

- **Stolen staff credentials**: deactivate or LOCK the user (sessions die
  server-side), rotate password, review AuditEvent for the user, re-activate
  with a fresh invite.
- **Cross-tenant data exposure**: identify scope from audit + AI queries,
  contain (patch + deploy), notify both facility owners and counsel, add a
  regression test (suite already covers the known classes).
- **Ransomware/DB compromise**: isolate host, restore from backup into a clean
  environment, rotate `CURAVILO_SECRET_KEY`, `DATABASE_URL`, all webhook
  secrets; force password resets (kills sessions + tokens are hashed anyway).
- **AI data leak**: disable the AI route (feature-flag/env), review conversation
  store, patch tool scoping, rotate provider keys if implicated.

## Ownership

Incident commander = platform operator (deployment owner). Facility owners are
responsible for their staff accounts. Contact chains live with the deployment,
not in the codebase.
