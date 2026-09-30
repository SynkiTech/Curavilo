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
