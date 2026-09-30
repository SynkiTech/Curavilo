# ADR 0007 — Workflow Builder & Node Model

**Status:** Accepted · **Date:** 2026-10-01

## Decision
- The workflow **builder** is a structured vertical editor (`workflow-builder.tsx`) — typed node cards, reorder, condition branch targets, trigger/SLA/schedule fields. No canvas library (React Flow) was added: zero new dependencies, keyboard accessible, and the engine's graph is simple enough that a linear chain + labeled condition edges is fully expressive for facility automations.
- Node types (v2): `CREATE_FOLLOWUP, CREATE_TASK, NOTIFY, SEND_EMAIL, SEND_SMS, SEND_WHATSAPP, CREATE_APPOINTMENT, GENERATE_REPORT, GENERATE_DOCUMENT, INVOKE_WEBHOOK, DELAY, CONDITION, APPROVAL, UPDATE_RECORD`. Configs are validated per type at save/publish/run; arbitrary code can never execute (spec §27).
- **Dry-run** executes the full graph with side effects suppressed; every action is recorded as "would …" in the node output and shown in the builder before publishing.
- **Publishing is immutable**: editing a published definition creates version+1 as a DRAFT; archive supersedes older published versions of the same key.
- Payload interpolation (`{{patientName}}`, `{{invoiceNumber}}`, …) is plain string substitution from the validated trigger payload.
