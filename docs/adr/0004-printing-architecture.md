# ADR 0004 — Printing & Documents

**Status:** Accepted · **Date:** 2026-10-01

## Context
Facilities print on A4/Letter reports and 58/80 mm thermal receipts. A browser cannot silently drive arbitrary printers, and the spec forbids per-page printing implementations.

## Decision
- Central document flow: `document type → data snapshot → template → facility branding → print profile → renderer`.
- **Layer 1 (implemented):** universal browser printing via print CSS. Print profiles (A4, A5, LETTER, THERMAL_58MM, THERMAL_80MM) define width, margins, typography and table behavior; the renderer component consumes the profile, not the page.
- **Layer 2 (roadmap):** server-rendered PDF export for sharing.
- **Layer 3 (roadmap):** optional local print bridge (ESC/POS) behind an adapter interface.
- Reprints re-render the original payment/invoice snapshot; `reprintCount` is incremented and a `REPRINT` marker is rendered per facility configuration. Reprinting never creates financial records.

## Consequences
- All documents share one renderer + audit path (`document.printed` audit events, no document contents in logs).
- Thermal vs. paper differences are CSS concerns; new paper sizes are profile entries.
