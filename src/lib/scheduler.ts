// Durable background scheduler (spec §29, ADR 0006).
//
// The database is the source of truth for all pending work; this in-process
// pump merely advances it every 30 s (wakes workflow timers, dispatches the
// outbox, delivers webhooks, runs detection jobs). Every job is idempotent and
// org-scoped, so a missed or duplicated tick is harmless. In production this
// swaps for pg-boss / BullMQ against the same tables — the pump is disposable
// by design.

import { db } from "@/lib/db";
import { schedulerTick } from "@/modules/automation";

const TICK_MS = 30_000;

interface SchedulerState {
  timer?: ReturnType<typeof setInterval>;
  running: boolean;
  ticks: number;
}

const globalForScheduler = globalThis as unknown as { __curaviloScheduler?: SchedulerState };

async function tick() {
  const state = globalForScheduler.__curaviloScheduler;
  if (!state || state.running) return;
  state.running = true;
  try {
    const orgs = await db.organization.findMany({ select: { id: true }, take: 50 });
    for (const org of orgs) {
      try {
        await schedulerTick(org.id);
      } catch (e) {
        console.error("[scheduler] org tick failed", org.id, e);
      }
    }
    state.ticks++;
  } catch (e) {
    console.error("[scheduler] tick failed", e);
  } finally {
    state.running = false;
  }
}

export function startScheduler() {
  if (globalForScheduler.__curaviloScheduler?.timer) return;
  const state: SchedulerState = globalForScheduler.__curaviloScheduler ?? { running: false, ticks: 0 };
  state.timer = setInterval(() => void tick(), TICK_MS);
  globalForScheduler.__curaviloScheduler = state;
  console.log("[scheduler] started — tick every", TICK_MS / 1000, "s");
  // First tick shortly after boot so parked work resumes quickly.
  setTimeout(() => void tick(), 3_000);
}
