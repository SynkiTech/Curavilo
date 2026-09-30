# ADR 0009 — Interoperability: FHIR Mapping, Webhooks, Import/Export

**Status:** Accepted · **Date:** 2026-10-01

## FHIR R4 mapping layer (spec §91)
- Pure mappers (`src/lib/fhir.ts`) project the canonical model onto 11 resources: Patient, Practitioner, Organization, Encounter, Appointment, Observation, DiagnosticReport, MedicationRequest, MedicationDispense, ServiceRequest, Invoice.
- **Read-only export surface** at `GET /api/fhir/{Resource}?count=` returning a `searchset` Bundle; unknown resources and writes return `OperationOutcome` errors. No full FHIR server is attempted (per spec).
- Every export is **permission-gated** (per-resource permission map), **tenant-scoped** (org-level where clauses) and **audited** (`fhir.export`).
- Local codes live under `https://curavilo.example/fhir`; no proprietary/licensed terminology is embedded. FHIR ids equal canonical ids so clients can join back.

## Webhooks (§140)
- Outbound: endpoint registry (URL + events + HMAC secret), deliveries signed `X-Curavilo-Signature: t=<ts>,v1=<hmac(ts.body)>`, retried with exponential backoff up to 5 attempts, then dead-lettered. Delivery log surfaces attempts, response status and errors.
- Inbound custom events enter via the outbox (`CUSTOM_WEBHOOK` trigger) — never write to domain tables directly.

## Import / export (§64–65)
- CSV import (patients): parse → column map → per-row validation → duplicate detection (in-file + against DB) → **preview with errors** → explicit transactional commit → audit. Never silent; 1–500 rows per batch.
- Exports (patients, invoices, appointments CSV): tenant-scoped, permission-gated, audited, hard 2 000-row cap.
