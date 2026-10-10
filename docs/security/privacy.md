# Privacy (Nigeria Data Protection Act 2023 alignment)

Position: Curavilo implements **technical and organizational controls that
support compliance**. It does not claim legal compliance - that determination
requires counsel and a formal DPIA.

## Controls implemented

| NDPA principle | Implementation |
|---|---|
| Privacy by design/default | Least privilege everywhere; non-admin roles facility-scoped; DTO-style responses; no PHI in browser storage; notifications avoid diagnoses by default (portal/queue surfaces show minimal context) |
| Data minimization | AI tools return aggregates over raw rows; staff directory exposes name/designation/department only; research queries are de-identified; DTOs exclude sensitive fields (e.g. salary-class HR fields stay behind `hr:read/manage`) |
| Purpose limitation | Role-based module boundaries (accountant cannot read patients; HR cannot read invoices - regression-tested) |
| Security of personal data | See threat-model + architecture docs: encryption-at-rest for secrets, hashed tokens, access control, audit trail, rate limiting |
| Accountability | Append-only audit of every sensitive action with actor identity; retention-capable logs |
| Data subject rights (support) | Portal gives patients read access to their own records (token-gated, read-only); export tooling is permission-gated and audited; deletion/de-identification workflows require owner action - formal DSAR tooling is a roadmap item |
| Retention limitation | AI conversations user-scoped and prunable; sessions/gates/tokens expire and are pruned; full retention schedule = policy decision for each facility (roadmap) |
| Vendor management | AI provider processes minimized data; production use requires privacy/vendor review (data sent, retention, purpose - see ai-security.md) |
| Breach readiness | incident-response.md incl. NDPC notification considerations (counsel decides thresholds) |

## Known privacy-relevant behaviors

- The facility gate credential is workspace-level and never impersonates a
  person; every sensitive action is attributed to the individual staff account.
- Sandbox/dev modes echo reset/invite links in API responses (no SMTP) - never
  in production (`NODE_ENV=production`).
- Audit summaries are bounded and action-focused to avoid storing PHI copies.

## Requires external assessment

- Formal DPIA, records of processing (RPA), DPO appointment, DSAR workflows,
  cross-border transfer analysis for the AI/SMS/email vendors.
