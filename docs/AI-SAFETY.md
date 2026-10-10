# AI Safety

## Overview
Ensuring the AI agent operates safely within the healthcare context.

## Risks & Mitigations

### Prompt Injection
- Malicious instructions hidden in patient notes or other fields
- Mitigation: Treat retrieved content as untrusted data; never follow embedded instructions; separate instructions from data; enforce permissions before retrieval; minimize context; redact unnecessary sensitive fields.

### Sensitive Information Disclosure
- AI revealing PHI or other sensitive data to unauthorized users
- Mitigation: Authorization enforced before data retrieval; AI inherits application permissions; no tool returns more data than necessary; provenance shows only what user is allowed to see.

### Tool Misuse
- Attempts to trigger unauthorized tools or exceed tool limits
- Mitigation: Tool registry with explicit permissions; validation of tool calls; rate limiting; quotas; abort on misuse.

### Privilege Escalation
- Using AI to gain higher privileges
- Mitigation: AI cannot change permissions or roles; all actions require deterministic authorization and human confirmation for high-risk actions.

### Memory/Context Poisoning
- Corrupting conversation history to affect future interactions
- Mitigation: Conversation history is user-scoped and facility-scoped; no cross-tenant leakage; patient context is explicit.

### Malicious Files
- Uploaded files with harmful content
- Mitigation: File validation (type, size, scanning); secure storage; no execution of uploaded files.

### Unbounded Consumption
- Attempts to cause excessive resource usage
- Mitigation: Pagination, limits, timeouts, quotas, AbortController for long-running tasks.

### Model Misinformation
- AI generating false information about facility data
- Mitigation: Grounded answers from actual data; provenance attached; disclaimers when data incomplete; never invent values.

### Insecure Output Handling
- XSS or injection via AI-generated content
- Mitigation: Output encoding; AI-generated content treated as untrusted in UI; sanitization where appropriate.

## Design Principles
- Permission before retrieval
- No hallucinated database answers
- Human control over high-risk actions
- Deterministic core, probabilistic AI
- Privacy by design
- Auditability of AI interactions
- Transparency (provenance)
- Conservative by default (when in doubt, restrict)

## High-Risk Actions
AI may eventually perform actions, but high-impact actions require:
- Deterministic authorization
- Explicit human confirmation
- Complete audit event
- Possible step-up authentication

Examples of high-risk actions:
- Refunds
- Deleting sensitive records
- Changing permissions
- Bulk exports
- Modifying financial records
- Publishing high-impact workflows
- Altering important clinical records
- Large-scale patient communications

## Monitoring & Response
- AI usage tracking
- Anomaly detection in queries
- Alert on potential misuse
- Regular red-team exercises
- Incident response for AI-related issues

## Synthetic Data Only
- AI evaluation and testing uses only synthetic data
- No real patient data in development or testing
- Clear labeling of synthetic data