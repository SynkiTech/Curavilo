# Curavilo — Roadmap

Phased per master spec §128–142. ✅ = this milestone, 🚧 = partially implemented, ⬜ = future.

- **Phase 0 — Architecture** ✅ docs/, ADRs 0001–0005, CLAUDE.md + .claude rules
- **Phase 1 — Platform foundation** ✅ auth (sessions), org/facility, onboarding wizard, service profiles + terminology, branding/logo, users/roles/permissions (RBAC), navigation, dashboard shell, audit foundation, tenant isolation, schema push, seed
- **Phase 2 — Patient operations** ✅ patients + search, patient 360, duplicate warnings (phone/name match at registration), appointments, queue, encounters (profile-driven forms), tasks/notifications (basic), audit
- **Phase 3 — Billing / POS / documents** ✅ service catalogue, invoices, payments (partial/full), receipts + print profiles (A4/thermal) + reprint, POS with transactional stock deduction, report engine foundation (revenue, patient volume, pharmacy sales)
- **Phase 4 — Pharmacy / inventory** 🚧 items, lots/batches/expiry, receive/adjust, movement ledger, low-stock alerts, barcode field, POS sales; pending: suppliers/purchase orders, transfers between facilities, expiry alerts automation
- **Phase 5 — Workflow engine** 🚧 versioned definitions, publish lifecycle, durable runs, trigger on encounter completion; pending: visual builder (React Flow), timers/SLAs, retries, dry runs
- **Phase 6 — Automation** 🚧 event outbox + encounter-completed trigger; pending: email/SMS/WhatsApp adapters, scheduled triggers
- **Phase 7 — AI data agent** 🚧 tool registry, permission-before-retrieval, provenance, audit, rate limits; pending: multi-step chains, report generation actions, evaluation suite (spec §54), ACT-mode with human confirmation
- **Phase 8 — Specialty modules** 🚧 Eye Clinic, General Practice, Dental, Diagnostic profiles with terminology + encounter forms; pending: deep specialty workflows per profile
- **Phase 9 — Lab / Radiology / inpatient** ⬜ (lab model stub in profiles only)
- **Phase 10 — Simulation** ⬜ (engine design required first, spec §56–60)
- **Phase 11 — Operations command center** ⬜
- **Phase 12 — Interoperability (FHIR mapping layer)** ⬜ (canonical model kept mappable; no proprietary lock-in)
- **Phase 13 — Patient / staff portals** ⬜
- **Phase 14 — Production hardening** ⬜ (security review, AI red-team, backup/restore drills, print compatibility matrix)

## Testing note (spec §96)
This milestone ships with lint + type discipline and browser-verified golden paths; the Vitest/Playwright suites (unit, cross-tenant security, financial integrity, AI grounding) are the next engineering step and are scaffolded under `tests/`.
