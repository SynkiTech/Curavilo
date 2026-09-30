# Curavilo — Data Model (Milestone 1)

Prisma/SQLite dev schema. `*Minor` fields are integer minor units (kobo). All tenant rows carry `orgId`; most carry `facilityId`.

## Identity & tenancy
- **Organization** — tenant root: name, slug, currency (NGN default), timezone (Africa/Lagos default).
- **Facility** — belongs to org; type, `serviceProfileKey`, address/contact, branding (logo data URL, footers, brand color).
- **User** — global login identity (email unique, scrypt password hash). `isPlatformAdmin` reserved for the Phase platform console.
- **Membership** — user↔org with role (OWNER, ADMIN, RECEPTIONIST, NURSE, DOCTOR, LAB, PHARMACY, BILLING, STAFF, PLATFORM_ADMIN). Role→permissions resolved by `lib/rbac.ts`.
- **Session** — DB-backed sessions; stores `activeFacilityId` (verified against membership before switch). Cookie carries opaque token; only SHA-256 hash is stored.

## Configuration
- **ServiceItem** — service catalogue (code, name, category, priceMinor) per org (+optional facility).
- **StaffMember** — facility staff directory (designation DOCTOR/NURSE/…, department, optional user link).

## Patient operations
- **Patient** — MRN (org-unique), demographics, phone (indexed for search/duplicate detection), next of kin, allergies, consent note, soft-delete (`active`).
- **Appointment** — patient + staff + service + `scheduledAt`, status SCHEDULED/CHECKED_IN/COMPLETED/CANCELLED/NO_SHOW.
- **QueueEntry** — daily queue number per facility+department, status WAITING/CALLED/IN_SERVICE/COMPLETED/SKIPPED, wait timestamps.
- **Encounter** — patient visit record; `formKey` + `formData` JSON from the service-profile form template; diagnosis/plan; startedAt/completedAt; links appointment/queue.
- **FollowUp** — due date + status; created manually or by workflow runs.

## Finance
- **Invoice / InvoiceItem** — status DRAFT/ISSUED/PARTIALLY_PAID/PAID/VOID; integer totals; `number` from document numbering.
- **Payment** — append-only financial record (method CASH/TRANSFER/CARD/MOBILE, reference, receipt `number`); `voidedAt` for reversal without deletion.
- **Sale / SaleItem** — POS/pharmacy transactions; payment fields embedded; stock deduction via movements in the same DB transaction.

## Supply chain
- **InventoryItem** — category (PHARMACEUTICAL, CONSUMABLE, LAB, EQUIPMENT, OFFICE, OTHER), sku/barcode, purchase/selling priceMinor, reorderLevel.
- **StockLot** — batch/lot + expiry + qtyRemaining.
- **StockMovement** — append-only ledger (RECEIPT/SALE/DISPENSE/ADJUSTMENT/DAMAGE/TRANSFER/RETURN, signed quantity, reason, ref). Stock on hand = Σ lots; ledger is the audit truth.

## Workflow & automation
- **WorkflowDef** — versioned JSON definition (nodes/edges, no code), DRAFT/PUBLISHED/ARCHIVED.
- **WorkflowRun** — trigger, version snapshot, JSON state, RUNNING/COMPLETED/FAILED.
- **OutboxEvent** — transactional outbox bridge for async processing (Phase 6).
- **Task / Notification** — assigned work and user alerts, with source links.

## AI
- **AIConversation / AIMessage** — user+org scoped chat history; AIMessage stores toolCalls and provenance JSON.
- **AuditEvent** — append-only (actor, action, entity, summary, metadata). AI queries, payments, prints, permission-relevant mutations all land here.

## Document numbering
**NumberSequence** — id = `orgId:type:period`, atomic increment inside the business transaction. Formats: `MRN-000001`, `INV-20260930-000001`, `RCP-…`, `POS-…`, `ENC-…`. Never timestamps alone.
