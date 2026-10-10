# Curavilo Product Requirements Document

## Vision
Curavilo is a configurable, multi-tenant, AI-powered healthcare operating platform for hospitals, clinics, specialist practices, diagnostic centres, laboratories, pharmacies and other healthcare facilities.

## Core Purpose
Help healthcare facilities understand how they operate, manage their records, automate routine work, generate reliable documents and reports, and use AI to interact with their own operational data.

## Key Principles
- Configuration over hard-coding
- One source of truth
- Deterministic core, probabilistic AI
- Permission before retrieval
- No hallucinated database answers
- Human control over high-risk actions
- Privacy by design
- Modular monolith first
- Every important operation must be auditable

## Target Users
- Healthcare facility administrators
- Doctors and clinicians
- Nurses and medical staff
- Pharmacists
- Laboratory technicians
- Front desk/reception staff
- Billing and finance staff

## Core Modules
1. Organization and Facility Management
2. Service Profile Engine
3. Patient Management (Patient 360)
4. Appointments and Queue Management
5. Encounters and Clinical Documentation
6. Billing and Payments
7. Pharmacy and Inventory
8. Laboratory
9. Radiology/Imaging
10. Workflow Engine
11. Automation
12. Reporting Engine
13. Document Engine and Printing
14. AI Data Agent
15. Simulation Engine
16. Analytics
17. Notifications and Task Management
18. Audit and Security

## Non-Goals
- Not a prototype or throwaway demo
- Not a generic hospital-management template
- Not merely an electronic medical record
- Not merely an AI chatbot

## Acceptance Criteria (Phase 0)
- Architecture documented
- Project setup complete
- Initial ADRs created
- Technology stack selected

## Acceptance Criteria (Phase 1)
- User can create an organization
- User can create a facility
- User can select services
- User can upload logo
- User can create a staff member
- User can log in and reach a protected dashboard

## Acceptance Criteria (Phase 2)
- Synthetic patient can progress through an outpatient workflow

## Acceptance Criteria (Phase 3)
- Patient transaction can be billed, paid, recorded, printed and reprinted correctly

## Acceptance Criteria (Phase 4)
- Receiving stock and selling stock produces consistent balances and audit history

## Acceptance Criteria (Phase 5)
- Configured outpatient workflow can execute end to end

## Acceptance Criteria (Phase 6)
- Patient event can trigger a reliable multi-step workflow

## Acceptance Criteria (Phase 7)
- Authorized user can ask real questions about synthetic hospital data and receive accurate grounded answers

## And so on...