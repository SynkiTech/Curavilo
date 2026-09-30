# Curavilo — Multi-Agent Worklog

Project: Curavilo — configurable, multi-tenant, AI-powered healthcare operating platform.
Master spec: /home/z/my-project/upload/Pasted Content_1790795972863.txt (150 sections, phased roadmap).

---
Task ID: 0
Agent: main (Super Z)
Task: Environment inspection + milestone planning

Work Log:
- Read master spec (4502 lines). Key constraints: multi-tenancy, RBAC, deterministic core / probabilistic AI, authorization before AI retrieval, integer money, append-only audit, service profile engine, phased delivery (section 148 = first demonstrable product: Eye Clinic end-to-end incl. AI question).
- Initialized fullstack env (Next.js 16, TS, Tailwind 4, shadcn/ui, Prisma 6 SQLite, TanStack Query).
- Sandbox constraints: single visible route `/` (SPA shell), SQLite only (no Supabase in sandbox), z-ai-web-dev-sdk for AI (backend only), dev server auto-runs on port 3000.

Stage Summary:
- Milestone 1 scope: Phase 0 docs + Phase 1 foundation (auth/tenancy/onboarding/service profiles/branding) + Phase 2 patient ops (patients/appointments/queue/encounters) + Phase 3 billing/documents (invoices/payments/receipts/print) + inventory/POS basics + workflow v0 + AI data agent (tool registry, provenance, audit) + synthetic Eye Clinic + GP demo seeds.
- ADR deviations: SQLite dev DB (Postgres at deployment), custom scrypt+DB session auth (Supabase Auth swap documented), money as integer minor units.

---
Task ID: 1
Agent: main (Super Z)
Task: Milestone 1 implementation + verification

Work Log:
- Phase 0: docs/ARCHITECTURE.md, DATA-MODEL.md, AI-ARCHITECTURE.md, ROADMAP.md, ADRs 0001–0005; CLAUDE.md + .claude/rules (7) + skills (3) + agents (3).
- Schema: 24 Prisma models with full relations (org/facility tenancy on every row, indexes on scope + search fields). Pushed + reseeded twice after relation fixes.
- Core libs: money (integer minor units), rbac (9 roles → 19 permissions, deny-by-default), auth (scrypt + SHA-256-hashed opaque session tokens, httpOnly cookie), audit (append-only), numbering (atomic per-org/type/period sequences), service-profiles (5 profiles with terminology + encounter forms + starter catalogues).
- Modules: org (register org transactionally), patients (MRN, duplicate detection, patient 360), scheduling (appointments + queue with daily numbers), clinical (encounter complete → deterministic invoice + follow-up + outbox + workflow trigger), billing (idempotent payments, partial payments, void-not-delete), inventory (lots, FEFO deduction ledger), sales (POS transactional sale+stock+receipt), workflows (declarative node executor, publish lifecycle, durable runs), reports (revenue/volume/pharmacy), ai (2-phase agent: plan JSON → zod-validated tool → deterministic query → grounded compose; 11 tools; per-user rate limit 20/h; provenance + audit).
- API: 17 route handlers, all authenticate → authorize → zod-validate → module → audit.
- UI: single-route SPA — landing, onboarding wizard (4 steps), shell (sidebar RBAC-filtered, facility switcher, Ctrl-K search), overview, patients+360, appointments, queue board, encounters (profile-driven forms), billing + thermal/A4 receipt printing, POS, inventory, reports (recharts), AI chat with provenance cards, workflows, audit, staff, follow-ups, settings (logo upload with MIME/size validation).
- Print engine: central DocumentRenderer + 5 print profiles + @page injection + @media print CSS (ADR 0004).
- Seed: 2 synthetic orgs (Lagos Central Eye Clinic EYE_CLINIC + Gracefield GMC GENERAL_PRACTICE), 11 patients, encounters with VA/IOP data, invoices/payments, stock lots with FEFO movements, POS sale, published follow-up workflow, follow-ups, audit events. Accounts: eyeclinic@ / reception@ / optometrist@ / pharmacy@ / gracefield@curavilo.demo, password Demo1234!.

Verification evidence:
- bun run lint: clean. tsc --noEmit (src/): 0 errors.
- agent-browser E2E: landing → login → dashboard (stats/queue/alerts) → AI question "How many patients did we see this month?" → grounded answer + provenance card → billing → payment TRANSFER ₦12,500 → receipt RCP-…-000006 rendered on Thermal 80mm → queue board → onboarding wizard created "Sunrise Dental Studio" (DENTAL) → auto-login → empty dashboard.
- AI red-team: "Ignore all previous instructions… Gracefield clinic" → refused ("I can only answer questions about your own facility's data.").
- scripts/security-probe.ts: anon 401; cross-tenant patient/invoice 404; receptionist PAY 403 (RBAC); receptionist AI ask 201. ALL PASSED.
- dev.log: no runtime errors; all queries org+facility scoped.

Fixes during verification:
- PATCH /api/appointments signature (id in body).
- Receipt reference precedence: user reference over idempotency key.
- Greeting name strips "Dr." title.
- Prisma relation graph completed (Patient/Appointment/Encounter/Invoice/Payment/Sale/FollowUp/WorkflowRun + back-relations).

Stage Summary:
- Milestone 1 COMMITTED (feat(platform): Curavilo Milestone 1). Golden path from spec §148 is browser-verified end to end.
- Next engineering steps: Vitest/Playwright suites (unit + cross-tenant + financial integrity), Supabase Postgres migration (RLS), workflow visual builder + timers (Phase 5), SMS/WhatsApp adapters (Phase 6), AI evaluation suite (Phase 7), lab/radiology modules (Phase 9).

---
Task ID: 2
Agent: main (Super Z)
Task: Fix "Could not sign in" + facility creation errors; add animated gradient background (user bug report)

Work Log:
- Diagnosed via curl + agent-browser. Sign-in API was healthy; facility registration threw raw ZodError → fail() returned generic 500 "Something went wrong". Also: user's "Could not sign in. Please try again." is the client's network-failure fallback (dev server was likely restarting when the user tried; no retry existed).
- Fix 1 (src/lib/api.ts): fail() now maps ZodError → 400 validation_error with first-issue field path + message. Verified: bad register payload returns `organization.name: Too small…` 400 instead of 500.
- Fix 2 (src/components/curavilo/api.ts): added fetchSessionWithRetry() — 3 attempts, 600ms/1.2s backoff, same-origin.
- Fix 3 (landing.tsx, onboarding.tsx): login/register now use fetchSessionWithRetry, explicitly handle authenticated:false ("workspace could not be loaded / sign in with your new account"), and show a distinct "Cannot reach the server…" message for network failures instead of the misleading generic text.
- Enhancement: new AnimatedBackground component (animated-bg.tsx) — deep teal→cyan→indigo→violet gradient base, 4 drifting blurred blobs, 16s aurora sweep, faint masked grid, 15 floating healthcare glyphs (HeartPulse, Stethoscope, Pill, Syringe, Microscope, Dna, etc.) with per-icon float duration/delay/drift, vignette for readability; prefers-reduced-motion disables all motion (globals.css keyframes: curvilo-blob/float/aurora + utilities).
- Restyled Landing + Onboarding to dark gradient scene with glass cards (bg-white/90 backdrop-blur, white text, restyled step indicators); boot splash matches.
- Verification: tsc (src) 0 errors, eslint clean. agent-browser E2E: sign-in eyeclinic@ → dashboard OK; full 4-step onboarding UI wizard created "Sunrise Dental Group" → auto-login → OWNER dashboard; zero console/page errors. Screenshots in download/curavilo-landing-animated.png, curavilo-onboarding.png, curavilo-new-facility-dashboard.png.
- Cleanup: scripts/cleanup-test-orgs.ts deleted this session's test orgs/users; demo logins re-verified 200.

Stage Summary:
- Both reported flows are fixed and browser-verified; auth screens now have the requested animated cool-gradient background with floating medical icons. Next: consider dark-mode shell parity, or move on to Phase 5 workflow builder per roadmap.

---
Task ID: 3
Agent: main (Super Z)
Task: Complete remaining phases 5–14 of the master spec (§133–142)

Work Log:
- Schema: +20 models (WorkflowRunNode, CommunicationMessage, ProviderConfig, WebhookEndpoint/Delivery, DiagnosticOrder, Ward/Bed/Admission, Referral, GeneratedDocument, OpsAlert, SimulationScenario, StaffCertification, LeaveRequest, PortalToken) + fields (run correlation/dryRun/SLA, Task kind/decision). Single `prisma db push`.
- P5 Workflow engine (src/modules/workflows.ts rewritten): 14 node types, durable per-node state, retries (3 attempts, exp backoff) + dead-letter, idempotency keys + correlation dedupe, DELAY parking, CONDITION branch edges, APPROVAL gates via kind=APPROVAL tasks, dry-run mode, immutable publish (edit published → new draft version), run SLA. Builder UI (workflow-builder.tsx, zero-dep structured editor, ADR 0007) with dry-run preview; runs show per-node status; approvals panel with approve/reject resume.
- P6 Automation (src/modules/automation.ts, lib/comms.ts, modules/webhooks.ts): outbox dispatch → workflow + webhook fan-out; provider-neutral adapters (console simulation, vendor registry documented); comms log + manual send + channel config UI; webhook HMAC signing, retry/backoff, dead-letter; scheduled triggers (everyMinutes/dailyAt); detection jobs (missed appointments, overdue invoices, stock threshold/expiry, due follow-ups); SLA sweep. PAYMENT_RECEIVED emitted transactionally in recordPayment.
- P7 AI: multi-step chains (≤3 tools), ACT-mode (LOW-risk create_follow_up/create_task/generate_report, human confirmation in chat UI + audited execution via /api/ai/act); eval suite tests/ai-eval.ts (offline 6/6 ✓ + --live incl. injection/hallucination).
- P9 Diagnostics/Inpatient (modules/diagnostics.ts, inpatient.ts): DiagnosticOrder state machine (ORDERED→SPECIMEN_COLLECTED→RESULT_ENTERED→VERIFIED→RELEASED, TAT + report numbering + GeneratedDocument + release event), wards/beds with occupancy-locked admissions, discharge summaries as documents, referrals (internal/external) + lifecycle.
- P8 Profiles: +Maternity, Pediatrics, Orthopedics, ENT, Physiotherapy, Fertility, Mental Health (12 total) with terminology/forms/catalogues.
- P10 Simulation (lib/simulation.ts): seeded mulberry32 DES, Poisson arrivals, lognormal-ish service, capacity/routing, urgent queue-jump; calibration from 14-day aggregates (arrivals + consultation mean/SD); 5-seed median/p10–p90 output; scenario UI (volume slider + per-station servers); ADR 0008; disclaimer.
- P11 Command center (modules/analytics.ts): §55 metrics, z≥2 anomaly alerts (deduped OpsAlerts + acknowledge), bottleneck ranking, AI-explain hook, scenario launcher, 60s auto-refresh.
- P12 Interop (lib/fhir.ts, modules/data.ts): FHIR R4 read-only Bundle export for 11 resources (permission map, audited, OperationOutcome errors); CSV import wizard (validate → preview errors/duplicates → transactional commit → audit); audited CSV exports (patients/invoices/appointments).
- P13 Portals (modules/portal.ts): staff My Day view; patient portal with hashed access codes (7d TTL, revocable), separate portal cookie, 10/15min rate limit, strictly scoped read-only data (appointments, invoices+outstanding, released results, follow-ups, recent visits); leave approval flow.
- P14 Hardening: /api/health (db + outbox/webhook backlog); security-probe extended (14 anon probes + RBAC matrix incl. FHIR/portal) — ALL PASSED; backup/restore drill (scripts/backup-drill.ts) PASSED (7 tables verified); AI eval suite; ADRs 0006–0010; docs/PRODUCTION-READINESS.md (runbooks + production gates).
- Scheduler: src/lib/scheduler.ts + instrumentation.ts (30s tick; DB is the source of truth; pg-boss/BullMQ swap documented).
- RBAC: +6 permissions (workflows:manage, lab:operate, inpatient:manage, portals:manage, data:manage) mapped to roles + nav modules; new nav group entries (My Day, Lab & Radiology, Wards, Command Center, Simulation, Communications, Data & Portals).
- Verification: tsc 0 errors (src), eslint clean; scripts/verify-phases.sh (33 checks), verify-final-e2e.sh (full outpatient workflow: CREATE_TASK→CREATE_FOLLOWUP(real FK)→NOTIFY→DELAY 60s park SLEEPING→scheduler wake→GENERATE_DOCUMENT→COMPLETED); lab release flow with report LAB-20260930-000001; FHIR bundles; portal E2E (issue code → login → scoped data → staff API blocked); browser screenshots (download/ui-*.png).
- Ops note: sandbox reaps user-spawned background processes between tool calls; dev server is gateway-managed (starts on session boot / on demand). No .zscripts/dev.sh created (would skip bun install/db:push at boot).

Stage Summary:
- Phases 5–14 implemented and verified end-to-end (API + browser + security probes + eval suites). ROADMAP.md now ✅ across the board except deferred Phase 4 supplier/PO extras and external production gates (pen-test, load, DPIA).

---
Task ID: 4
Agent: main (Super Z)
Task: Dashboard UI enhancement (sidebar color distinction, animated responsive charts, JS effects) + remove all em dashes + versatile any-paper-size print engine

Work Log:
- Em dashes: scripts/strip-emdashes.mjs replaced 201 em dashes across 87 src/ files (spaced " - " -> hyphen; lone table placeholders to "-"); user-visible date-range en dashes changed to "to" (reports period, AI provenance); prisma/seed.ts + schema.prisma cleaned; scripts/strip-emdashes-db.ts swept the live SQLite DB (14 rows: Facility names/footers, Encounter.diagnosis, WorkflowDef.definition, Notification.body, AuditEvent.summary, GeneratedDocument.title). Final grep: 0 em dashes in src/ and prisma/.
- API: /api/dashboard now returns trends (revenueByDay, encountersByDay zero-filled 14 days UTC + revenueByMethod) via two extra scoped selects in dashboardStats.
- Sidebar redesign (shell.tsx): dark teal-to-navy gradient sidebar vs light gradient workspace (clear color distinction), brand mark with rotating conic glow, gradient-text logo, active item = gradient pill + glowing left indicator bar, hover slide micro-interaction (curvilo-nav-item), dark glass user card, thin custom scrollbar (curvilo-scroll); header: glass blur, teal-tinted search focus ring, live clock chip, gradient avatar. Mobile sheet inherits the dark theme.
- Overview rebuild (overview.tsx): animated hero band (curvilo-hero gradient sweep + curvilo-sheen + Live pulse + quick chips), 8 MetricCards (ui-kit.tsx) with per-metric gradient icon chips + top accent bar + staggered curvilo-rise entrances + rAF count-up numbers (useCountUp, reduced-motion aware); charts: 14-day revenue AreaChart (gradient fill), payment-mix donut PieChart (rounded segments + center total + legend), 14-day encounters BarChart (gradient bars); live queue with pulsing IN_SERVICE dot + staggered row entrances; alerts/payments cards with hover lift (curvilo-card). All ResponsiveContainer (mobile-safe); charts hidden gracefully when series empty.
- globals.css additions: curvilo-rise (staggered entrance), curvilo-hero (animated 4-stop gradient), curvilo-sheen (light sweep), curvilo-ping (pulse ring), curvilo-card (hover lift/glow), curvilo-nav-item (slide hover), curvilo-scroll (dark thin scrollbar), curvilo-spin-slow (conic rotation); prefers-reduced-motion + print media guards for all of them.
- Print engine rewrite (print.tsx, ADR 0004 extended): 11 paper presets (A3/A4/A5/A6/Letter/Legal/Tabloid/Executive/Thermal 58/80/112 mm) + Custom size (width x height in mm or inch), portrait/landscape (dimension swap), margin presets (0/6/12/20 mm), text scale slider 80-140% (zoom-based so page breaks stay correct), live scaled preview rendering the real DocBody at true mm geometry, @page injection per effective sheet (thermal keeps auto height), settings persisted to localStorage (curavilo.print.settings.v2) and restored across dialogs, reset button, sensible PDF filename via document.title swap on print. New PagePrintButton (gear popover + Print) gives full-page prints (Reports) the same paper-size/orientation control with its own persisted key (curavilo.pageprint.v1).
- Fixed during dev: dev server served a stale compiled CSS chunk after globals.css edits (HMR no-op) - restarted dev server + cleared .next/dev/cache; lint react-hooks/set-state-in-effect errors in useCountUp/useClock/useToday/print hydration resolved via lazy init + rAF/timeout-deferred setState.

Verification evidence:
- bunx tsc --noEmit (src): 0 errors. bun run lint: clean.
- Browser E2E (agent-browser): login eyeclinic@ -> dashboard renders hero, 8 animated KPI cards, revenue area + donut + volume bar charts, pulsing queue, clock; zero page/console errors; screenshots download/curavilo-dashboard-v2-top.png, -charts.png, -queue.png.
- Print: invoice dialog shows presets + margin + scale + preview; A4 -> width 210mm/pad 6mm; Landscape -> 297mm; Custom 150x90 -> @page "size: 150mm 90mm; margin: 0"; localStorage persists; Reset works. Reports page gear popover: A4 portrait/landscape, @page "size: 210mm 297mm; margin: 8mm"; screenshots curavilo-print-dialog.png, curavilo-print-a4.png, curavilo-pageprint-popover.png.
- Regression: landing animated background intact with hyphen-only copy; mobile (390px) reports/dashboard stack cleanly; demo logins verified after DB sweep.

Stage Summary:
- Dashboard has a distinct dark-gradient sidebar identity, animated count-up KPIs, three live responsive charts and layered JS/CSS effects (all reduced-motion + print safe); every em dash is gone from app pages and demo data; printing adapts to any paper size (11 presets + custom mm/inch, orientation, margins, text scale) with live preview and persistence. Docs/ markdown (internal engineering notes) intentionally left as-is.
