# ADR 0008 — Simulation Engine (Discrete-Event, Seeded)

**Status:** Accepted · **Date:** 2026-10-01

## Decision
Deterministic **discrete-event simulation** (spec §57 requires a researched model, not a spreadsheet):

- Arrivals are a **Poisson process** (exponential inter-arrival times); service times are normally-approximated (Irwin–Hall sum of 3 uniforms), clamped ≥ 0.5 min; stations have server counts (staff/rooms) and route shares; urgent arrivals queue-jump (35 % effective wait).
- **Seeded PRNG** (mulberry32) — every run is reproducible; scenarios run across 5 seeds and report **medians with p10–p90 ranges** (§58 "estimated ranges for stochastic outputs").
- **Historical calibration**: `calibrateFromOperations()` derives arrivals/day from 14-day queue entries and consultation mean/SD service times from 14-day encounter durations. Only aggregates leave the database (§60 privacy).
- **Safety boundary (§59)**: the API response and UI carry the disclaimer that outputs are operational estimates for planning, never clinical predictions. The engine has no patient-level inputs.
- Bottleneck ranking uses station utilization; the Command Center reuses the same analytics for live pressure hints.
