# Security Architecture

## Overview
Curavilo follows security by design principles and adheres to OWASP ASVS 5.0.

## Authentication
- Supabase Auth (email/password, optional MFA)
- Secure password reset
- Session management via JWT

## Authorization
- RBAC with contextual restrictions (organization, facility, department, service line)
- Permissions checked before data retrieval
- AI agent inherits application authorization
- No permission bypass by AI

## Data Protection
- Encryption at rest (Supabase managed)
- TLS 1.3 in transit
- Sensitive data fields encrypted where required (e.g., patient identifiers)
- No logging of sensitive data (passwords, tokens, full patient records)

## Input Validation
- All inputs validated server-side (Zod schemas)
- Output encoding to prevent XSS
- SQL injection prevented via Prisma ORM and parameterized queries

## File Security
- Upload validation (MIME type, extension, size)
- Virus scanning (where applicable)
- Secure storage (Supabase Storage)
- Access controls on files

## Auditing
- Comprehensive audit logs for critical operations
- Audit logs do not contain unnecessary sensitive data
- Immutable audit trail

## Multi-Tenancy Security
- Row-Level Security (RLS) in PostgreSQL as defense-in-depth
- Application-level tenant enforcement
- Cross-tenant access blocked at API and data layers

## AI Security
- Tools enforce permissions before data retrieval
- No unrestricted SQL access for AI
- Rate limiting and quotas
- Prompt injection defenses
- Tool abuse protection

## Dependencies
- Regular vulnerability scanning
- Locked dependencies with regular updates

## Compliance
- Designed to support Nigeria Data Protection Act 2023
- Privacy by design
- Data subject rights facilitation