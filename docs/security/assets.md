# Curavilo Asset Inventory & Classification

Classification levels:
- **PHI-Critical**: patient-identifiable health data. Breach = reportable privacy incident.
- **Confidential**: staff/personal/financial data, credentials, secrets.
- **Internal**: operational data with no direct personal or financial impact.
- **Public**: safe to expose.

## Data assets

| Asset | Model(s) | Classification | Notes |
|---|---|---|---|
| Patient identity (name, MRN, phone, email, address, DOB, next of kin) | `Patient` | PHI-Critical | Org+facility scoped; non-admin reads facility-scoped |
| Clinical data (encounters, diagnoses, plans, allergies, blood group) | `Encounter`, `Patient.allergies/bloodGroup` | PHI-Critical | Permission `encounters:read` |
| Appointments / queue | `Appointment`, queue state | PHI-Critical (links patient to care) | `appointments:read` / `queue:operate` |
| Prescriptions / dispenses | `SaleItem` (POS) linked to patients | PHI-Critical | `inventory:read`/FHIR mapping |
| Lab / diagnostic results | `DiagnosticOrder` | PHI-Critical | `lab:operate`; released results also portal-visible |
| Follow-ups | `FollowUp` | PHI-Critical | `patients:read` |
| Staff identity (name, email, phone, designation, photo) | `StaffMember`, `User` | Confidential | `staff:read` |
| HR data (leave, attendance, certifications, performance reviews) | `LeaveRequest`, `AttendanceLog`, `StaffCertification`, `PerformanceReview` | Confidential | `hr:read`/`hr:manage` |
| Financial records (invoices, payments, expenses, POS sales) | `Invoice`, `Payment`, `Expense`, `Sale` | Confidential | `billing:*`, `accounting:*`, `pos:*` |
| Inventory & suppliers | `InventoryItem`, `Supplier`, `PurchaseOrder`, movements | Internal | `inventory:read` |
| Credentials (password hashes, temp passwords) | `User.passwordHash`, `FacilityCredential.passwordHash` | Confidential (secret) | scrypt; never returned; temp passwords shown once |
| Session tokens | `Session.tokenHash`, `GateSession.tokenHash`, `PortalToken.tokenHash` | Confidential (secret) | SHA-256 hashes only; opaque tokens in httpOnly cookies |
| Invite / reset tokens | `PasswordToken` (hashed) | Confidential (secret) | Single-use, expiring; plaintext never persisted (preview redacted) |
| Webhook secrets | `WebhookEndpoint.secretHash` + encrypted copy | Confidential (secret) | Shown once; HMAC keys derived from secret |
| Facility branding (logo, footers, terminology) | `Facility`, `termOverrides` | Internal | Validated raster data URLs only |
| Uploaded images (logos, staff photos) | base64 data URLs in DB rows | Internal | <= 400 KB, MIME-validated, rendered via `<img src>` (no SVG execution) |
| AI conversations | `AIConversation`, `AIMessage` | PHI-Critical (may contain patient context) | User-scoped, org-scoped, retention-limited |
| Audit log | `AuditEvent` | Confidential (integrity-critical) | Append-only; no user-facing edit path |
| Communication log | `CommunicationMessage` | Confidential | Preview redaction for secrets |
| Workflow definitions & runs | `WorkflowDef`, `WorkflowRun` | Internal | `workflows:manage` for mutation |
| System configuration (service profiles, providers, settings) | `ServiceItem`, `ProviderConfig`, `Facility` | Internal | `settings:manage` |

## Secret assets (where they live and die)

| Secret | Storage | Exposure path |
|---|---|---|
| DATABASE_URL | `.env` (gitignored) | server only |
| Staff passwords | scrypt hash | never |
| Facility gate credential | scrypt hash | never |
| Session/gate/portal tokens | random 192-256 bit; DB stores SHA-256 | httpOnly cookie, per session row |
| Invite/reset tokens | random 192 bit; DB stores SHA-256 | once, in one-time link |
| Portal access codes | random 96-bit display code; DB stores SHA-256 | shown once to staff |
| Webhook signing secrets | random 192 bit; DB stores hash + AES-GCM encrypted copy | shown once; HMAC key server-side |
| AI provider keys | z-ai-web-dev-sdk server-side env | never client-side |

## Backups

`db/custom.db` (SQLite). Backup drill: `scripts/backup-drill.ts`. Production
backup encryption/retention is an infrastructure responsibility (documented in
`disaster-recovery.md`).
