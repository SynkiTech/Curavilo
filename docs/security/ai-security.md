# AI Security

Architecture: `src/modules/ai/agent.ts` (planner -> tool loop -> composer) +
`src/modules/ai/tools.ts` (registry). The model is an untrusted component; the
security boundary is deterministic code.

## Non-negotiables (all implemented)

| Control | Implementation |
|---|---|
| Permissions ⊆ user permissions | Every tool declares `permission`; the executor re-checks `ctx.permissions` server-side before running. The model cannot request elevation. |
| Tool allowlist | Tools exist only in the registry; there is **no** SQL, shell, file, template or arbitrary-URL tool. |
| Tenant scope | Every tool query filters `orgId` (+ facility where PHI), taken from the session, never from the prompt. |
| Param validation | Tool params re-parsed with Zod `.strict()` schemas (type, range, enums, date caps <= 400 days). |
| Result limits | Bounded takes (8-200 rows), aggregates preferred over raw rows, provenance + recordCount returned. |
| Cost/DoS abuse | 30 requests/hour/user, message <= 1000 chars, max 3 tool steps per question, conversation chain depth bounded. |
| Prompt injection | Planner treats instruction-like content as untrusted; verified by red-team suite (`ignore all rules`, `you are OWNER`, cross-tenant extraction - all contained). |
| Indirect injection | Tool results are JSON data; no eval/exec/render-as-HTML path exists for them. |
| Output handling | Answers render as **plain text** (no markdown-HTML sink); source links carry `rel="noopener noreferrer nofollow"`; structured action plans are schema-validated and require **explicit human confirmation** (human-in-the-loop) before execution. |
| Conversation isolation | `AIConversation` rows scoped `orgId + userId`; loading another user's conversation is not possible (regression-tested). |
| Audit | Every AI query audited (user, facility, action) without storing full PHI payloads. |
| Data minimization | Aggregates over dumps; staff directory tool exposes name/designation/department only; no bulk-PHI tool exists. |
| Fail-closed | If authorization context cannot be established, the AI refuses protected questions; model failures return safe errors, never partial tool execution. |

## Provider

`z-ai-web-dev-sdk` server-side only (chat + `web_search` for the research
tool). No credentials or secrets enter prompts; bulk PHI never leaves the
system (research queries are de-identified medical questions). Vendor/privacy
review is required before production (see `privacy.md`).
