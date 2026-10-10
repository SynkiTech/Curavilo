# Curavilo UX Principles

What every screen must answer and how roles shape the experience (spec §85, §87, §93, §108, §131).

## 1. The five questions every screen answers

1. Where am I? (page header, active nav state, breadcrumb-level clarity)
2. What matters right now? (visual hierarchy: alerts > queues > metrics > history)
3. What can I do next? (primary CTAs, quick actions, cross-links)
4. What requires my attention? (bottlenecks, overdue, low stock: severity + motion, not red boxes)
5. Where can I find more detail? (every metric links to its module)

## 2. Role-specific workspaces (§21, §87)

One design system, different emphasis. Dashboards resolve server-side from role + permissions + service profile.

| Role | Workspace | Priority |
|------|-----------|----------|
| OWNER / ADMIN | Command Center | Revenue, operations, staff, bottlenecks |
| DOCTOR / OPTOMETRIST / DENTIST | Clinical Workspace | Patients, consultations, results |
| NURSE | Patient Care Workspace | Queue, check-ins, tasks |
| RECEPTIONIST | Front Desk Operations | Appointments, queue, registration speed |
| PHARMACY | Pharmacy Operations | Prescriptions, dispensing, stock |
| OPTICIAN | Optical Operations | Sales, inventory |
| LAB | Laboratory Workspace | Worklist, pending results |
| BILLING | Finance | Invoices, payments, export |
| STAFF / custom roles | Minimal | My tasks |

The interface must always make clear which role the user is operating under (sidebar user card, header chip, greeting role line).

## 3. Signature patterns

- **Patient flow strip** (`FlowStrip`): Registration -> Waiting -> In consultation -> Completed, with animated connectors and a "Busiest" bottleneck cue. The living-operations signature (§131).
- **Cross-linking** (§93, §94): low inventory card leads to Inventory; queue card leads to Queue; follow-ups lead to FollowUps; AI offers actions on what it found. The UI creates natural pathways.
- **Command palette**: Ctrl/Cmd K searches patients and opens modules; respects permissions.
- **Contextual loading**: "Searching patients…", "Preparing report…", "Preparing document…" (§44). Generic spinners only inside `ActivityIndicator` with a label.

## 4. Speed for repetitive work (§24, §75)

Reception, POS and clinical flows reward repetition: keyboard shortcuts, large search targets, minimal clicks to complete a sale or check-in. Animations must never delay transaction completion; the POS and queue operate at interaction speed.

## 5. Forms (§49)

Intelligent field grouping, inline validation before submission, clear labels and help text, keyboard navigation, visible focus, unsaved-change warnings. Errors never appear only after submit.

## 6. Dangerous actions (§57)

Consequence-first dialogs: describe the outcome, show affected records, require explicit confirmation; typed confirmation for the most destructive operations. Motion emphasizes state change calmly, never dramatically.

## 7. Data integrity and privacy (§114, §115)

Only server-authorized data reaches the client. Tooltips, toasts, and animation state must not leak restricted records. Permission-denied is an explicit state, not hidden content.

## 8. Responsive behavior (§54, §55)

Desktop/laptop is the staff workstation target. Tablet and mobile prioritize: tasks, appointments, patient lookup, notifications, quick actions. Clinical tables do not squeeze into tiny screens; navigation moves to the drawer with the same grouped structure.

## 9. Quality bar (§130)

A screen ships when it passes: the screenshot test (premium in a showcase), the 5-second test (where am I, what matters), the 30-second test (what to do next), the 5-minute test (main task without fighting the UI), the 8-hour test (tolererable all day), the distinctiveness test (Curavilo, not a template), the motion test (animation aids comprehension), the performance test, and the accessibility test (usable without animation or mouse).

## 10. The feeling we are engineering

> A living operational system. Patient movement feels like flow. Workflow execution feels alive. AI feels intelligent. Transactions feel immediate. Reports feel precise. Printing feels reliable. Every interaction feels intentional.

The reaction to engineer for: "This doesn't feel like ordinary hospital software."
