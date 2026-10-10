# Workflow Engine

## Overview
Curavilo's workflow engine enables automation of healthcare processes through versioned, configurable workflows.

## Core Concepts

### Workflow
- A versioned graph representing a business process
- Composed of nodes, edges, rules, assignments, SLAs, and actions
- Tenant-scoped (organization/facility)
- Can be triggered by various events (patient registered, appointment created, etc.)

### Workflow Versioning
- Draft: Editable, not executable
- Published: Immutable, executable
- Archived: Historical reference
- Running instances continue on the version they started with unless explicit migration

### Node Types
- START: Entry point
- END: Terminal point
- TASK: Manual work assignment
- CONDITION: Branching based on data
- APPROVAL: Requires authorized sign-off
- WAIT: Pause until condition or time
- TIMER: Delay for specified duration
- NOTIFICATION: Send alert/message
- UPDATE_RECORD: Modify database record
- ASSIGN: Assign to user/team
- BRANCH: Split flow
- MERGE: Join converging paths
- WEBHOOK: Call external HTTP endpoint
- GENERATE_DOCUMENT: Create document from template

### Workflow Run
- Each execution creates a workflow run record
- Tracks: trigger, current state, completed/pending/failed steps, retries, timestamps, SLA compliance
- Idempotency keys where applicable
- Retry mechanisms with exponential backoff
- Dead-letter handling for repeated failures

## Engine Properties
- Durable execution (survives restarts)
- Event-driven (triggers create runs)
- Horizontal scalability
- At-least-once delivery for actions
- Workflow state stored in database
- Background workers process runs

## Triggers
- Patient registered
- Appointment created/approaching/missed
- Patient checked in
- Triage completed
- Encounter completed
- Test ordered
- Payment received
- Result released
- Prescription created
- Drug dispensed
- Stock below threshold
- Follow-up due
- Invoice overdue
- Staff certification nearing expiry
- Custom webhook
- Scheduled trigger (cron-like)

## Actions (Workflow -> System)
- Create task
- Assign task
- Send notification (email, SMS, in-app, WhatsApp via adapter)
- Create appointment
- Generate report
- Generate document
- Update status (e.g., patient status)
- Create follow-up
- Create inventory alert
- Invoke webhook (outbound)
- Start another workflow (sub-workflow)

## Data & Rules
- Workflow definition includes data mapping and transformation rules
- Conditions can examine workflow context, patient data, encounter data, etc.
- Assignments can be dynamic (based on workload, role, etc.)
- SLAs define expected completion times and escalation paths

## Versioning & Migration
- Version history stored
- Diff tool to compare versions
- Rollback to previous version (does not affect running instances)
- Migration paths for updating running instances (opt-in, with data mapping)

## Security & Permissions
- Workflow execution inherits initiator's permissions for actions
- Authorization checked before each action that accesses data or performs operations
- No arbitrary code execution in tenant-defined workflows
- Webhook calls go through adapter layer with validation

## Audit
- Every workflow action audited (who, what, when, outcome)
- Workflow creation, publishing, archiving audited
- Run start/end/completion/failure audited

## Extensibility
- Custom node types via plugin mechanism (reviewed for safety)
- Custom actions through adapter registry
- Service profiles can define starter workflows
- Workflow templates export/import

## Performance
- Engine designed for high throughput
- Database indexes on workflow run status, tenant, timestamps
- Polling optimized with efficient queries
- Horizontal scaling of workers