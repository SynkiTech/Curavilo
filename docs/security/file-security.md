# File & Storage Security

## Model

Curavilo deliberately has **no filesystem uploads and no object storage**: all
images are base64 data URLs stored in database rows (facility logos, staff
photos), and all documents (receipts, reports, FHIR bundles, CSV exports) are
generated server-side on demand. This removes an entire vulnerability class:
no path traversal, no storage buckets, no signed URLs, no executable uploads.

## Upload validation (data URLs)

| Surface | Rule |
|---|---|
| Settings logo | `data:image/(png\|jpeg\|jpg\|webp);base64,` regex + 400 KB cap; **SVG rejected** (script vector) |
| Registration logo / staff photos | Same raster-only regex + 400 KB cap (hardening pass unified the policy) |
| Rendering | `<img src>` only - no inline SVG DOM, no `dangerouslySetInnerHTML` from stored values |
| AI research links | External URLs rendered as anchor text with `noopener noreferrer nofollow`; never fetched server-side |

## Downloads / exports

- CSV exports (`/api/data`): `data:manage` permission, tenant-scoped, row cap
  2000, rate limited, audited, `Content-Disposition: attachment` with a
  server-generated filename, **formula-injection guard** (leading `= + - @`
  tab/CR prefixed with `'`).
- Report CSV (client builder): same formula-injection guard.
- FHIR bundles: JSON responses, permission-gated per resource, audited, rate
  limited.
- Generated PDFs come from the browser print engine on already-authorized
  client data; no server-side PDF templating exists (no template injection
  surface).

## Print authorization

Printing renders data the user already received under permission; print events
are audited (`document.printed`) with server-derived actor, bounded input
schema, and a 60/min rate limit so the audit trail cannot be flooded.

## Residual

Malware scanning is not applicable to raster data URLs, but if file/object
storage is introduced later, re-open this document (scan, private buckets,
signed URLs, size/type inspection).
