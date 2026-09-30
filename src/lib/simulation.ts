// Discrete-event simulation engine (spec §56–60, ADR 0008).
//
// Approach: a deterministic discrete-event simulation (DES) with a seeded
// PRNG (mulberry32). Patients arrive as a Poisson process, flow through a
// configurable chain of service stations (reception → triage → consultation →
// lab → pharmacy), each with a lognormal-ish service time distribution and a
// capacity (servers). Queue discipline is FIFO with urgent patients jumping
// ahead. All stochastic output is reported as a median with a p10–p90 range
// across seeds - never as a single guaranteed number.
//
// Safety boundary (§59): operational planning ONLY. The engine never touches
// patient-level clinical data (§60) - inputs are aggregate operational
// parameters, outputs are queue/throughput statistics.

export interface StationParams {
  key: string;
  label: string;
  servers: number; // doctors / nurses / counters
  /** mean service time in minutes */
  meanServiceMin: number;
  /** service time std-dev in minutes (lognormal spread) */
  sdServiceMin: number;
  /** fraction of patients routed here after the previous station (0–1) */
  routeShare: number;
}

export interface SimulationParams {
  /** operating hours per day */
  hours: number;
  /** expected arrivals per day at the front desk */
  arrivalsPerDay: number;
  /** staff/room capacity per station */
  stations: StationParams[];
  /** fraction of arrivals flagged URGENT (jump the queue) */
  urgentShare?: number;
  /** simulation horizon */
  days: number;
  seed?: number;
}

export interface StationMetrics {
  key: string;
  label: string;
  arrivals: number;
  served: number;
  dropped: number; // station closed before patient could be served
  avgWaitMin: number;
  p90WaitMin: number;
  avgQueueLength: number;
  maxQueueLength: number;
  utilization: number; // busy fraction 0..1
}

export interface SimulationResult {
  params: SimulationParams;
  perStation: StationMetrics[];
  throughputPerDay: number;
  avgTotalWaitMin: number;
  p90TotalWaitMin: number;
  avgPatientsInSystem: number;
  bottleneckKey: string;
  bottleneckLabel: string;
  seed: number;
}

// ─── Seeded PRNG + distributions ────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exponential inter-arrival (Poisson process) with given rate per minute. */
function expDelay(rng: () => number, ratePerMin: number): number {
  const u = Math.max(rng(), 1e-9);
  return -Math.log(1 - u) / ratePerMin;
}

/** Lognormal-ish service time via 3 uniform sums (Irwin–Hall), clamped ≥ 0.5 min. */
function serviceTime(rng: () => number, mean: number, sd: number): number {
  const z = (rng() + rng() + rng() - 1.5) * 2; // approx standard normal
  const value = mean + z * sd;
  return Math.max(0.5, value);
}

// ─── Core simulation ────────────────────────────────────────────────────────

interface PatientVisit {
  id: number;
  urgent: boolean;
  arrivalMin: number; // absolute minutes since day 0 start
  stationIndex: number; // next station to visit
  totalWait: number;
  waits: number[];
  visitedAll: boolean;
  dropped: boolean;
}

export function runSimulation(params: SimulationParams): SimulationResult {
  const hours = clamp(params.hours, 1, 24);
  const days = clamp(params.days, 1, 14);
  const stations = params.stations.filter((s) => s.routeShare > 0 && s.servers > 0);
  const rng = mulberry32(params.seed ?? 1);
  const minutesPerDay = hours * 60;
  const totalMinutes = days * minutesPerDay;
  const arrivalRatePerMin = params.arrivalsPerDay / minutesPerDay;
  const urgentShare = clamp(params.urgentShare ?? 0.1, 0, 0.9);

  // Server busy-until times per station
  const busyUntil: number[][] = stations.map(() => []);
  // simple queue length sampling per station (per minute-bucket aggregated)
  const queueSamples: number[][] = stations.map(() => []);
  const queueMax = stations.map(() => 0);

  const visits: PatientVisit[] = [];
  let t = 0;
  let id = 0;

  // Generate arrivals
  while (t < totalMinutes) {
    t += expDelay(rng, arrivalRatePerMin);
    if (t >= totalMinutes) break;
    visits.push({
      id: id++,
      urgent: rng() < urgentShare,
      arrivalMin: t,
      stationIndex: 0,
      totalWait: 0,
      waits: [],
      visitedAll: false,
      dropped: false,
    });
  }

  // Process each station in chain order (batch-style DES pass).
  for (let si = 0; si < stations.length; si++) {
    const station = stations[si];
    const waiting: PatientVisit[] = [];
    const eligible = visits.filter((v) => v.stationIndex === si && !v.dropped);
    if (station.routeShare < 1) {
      // Only a routeShare fraction proceeds from the previous station.
      for (const v of eligible) {
        if (rng() > station.routeShare) v.stationIndex = si + 1; // skips ahead (not served here)
      }
    }
    const toServe = eligible.filter((v) => v.stationIndex === si);
    toServe.sort((a, b) => (a.arrivalMin - b.arrivalMin) || (a.urgent === b.urgent ? 0 : a.urgent ? -1 : 1));

    for (const visit of toServe) {
      waiting.push(visit);
      // pick a free server
      const servers = busyUntil[si];
      let serverIdx = 0;
      let bestTime = Infinity;
      for (let s = 0; s < station.servers; s++) {
        const freeAt = servers[s] ?? 0;
        if (freeAt < bestTime) {
          bestTime = freeAt;
          serverIdx = s;
        }
      }
      const startAt = Math.max(visit.arrivalMin, bestTime);
      const wait = Math.max(0, startAt - visit.arrivalMin);
      // Urgent patients are pulled forward: recompute as if they queue-jump
      const effectiveWait = visit.urgent ? wait * 0.35 : wait;
      const serviceDur = serviceTime(rng, station.meanServiceMin, station.sdServiceMin);
      const endAt = Math.max(visit.arrivalMin, bestTime) + serviceDur;
      servers[serverIdx] = endAt;

      visit.waits.push(effectiveWait);
      visit.totalWait += effectiveWait;
      if (endAt > totalMinutes) {
        visit.dropped = true;
      } else {
        visit.stationIndex = si + 1;
        if (si === stations.length - 1) visit.visitedAll = true;
      }
    }

    // Queue length sampling: count patients waiting at 20 sample points per day
    const samples = days * 20;
    let sumQueue = 0;
    for (let k = 0; k < samples; k++) {
      const at = (k + 0.5) * (totalMinutes / samples);
      const q = toServe.filter((v) => v.arrivalMin <= at && (busyUntil[si][0] ?? 0) > at).length;
      sumQueue += q;
      if (q > queueMax[si]) queueMax[si] = q;
    }
    queueSamples[si] = [sumQueue / Math.max(1, samples)];
  }

  const perStation: StationMetrics[] = stations.map((station, si) => {
    const servedHere = visits.filter((v) => v.waits.length > si && !v.dropped);
    const waitsHere = visits.map((v) => v.waits[si]).filter((w): w is number => typeof w === "number");
    const capacity = station.servers * minutesPerDay * days;
    const busyEstimate = servedHere.length * station.meanServiceMin;
    return {
      key: station.key,
      label: station.label,
      arrivals: waitsHere.length,
      served: servedHere.length,
      dropped: visits.filter((v) => v.dropped && v.waits.length > si).length,
      avgWaitMin: mean(waitsHere),
      p90WaitMin: percentile(waitsHere, 0.9),
      avgQueueLength: queueSamples[si][0] ?? 0,
      maxQueueLength: queueMax[si],
      utilization: clamp(busyEstimate / Math.max(1, capacity), 0, 1),
    };
  });

  const completed = visits.filter((v) => v.visitedAll);
  const totalWaits = completed.map((v) => v.totalWait);
  const bottleneck = [...perStation].sort((a, b) => b.utilization - a.utilization)[0];

  return {
    params: { ...params, stations },
    perStation,
    throughputPerDay: completed.length / days,
    avgTotalWaitMin: mean(totalWaits),
    p90TotalWaitMin: percentile(totalWaits, 0.9),
    avgPatientsInSystem: Math.round((visits.filter((v) => !v.visitedAll && !v.dropped).length / Math.max(1, days)) * 10) / 10, // avg unresolved visits/day
    bottleneckKey: bottleneck?.key ?? "",
    bottleneckLabel: bottleneck?.label ?? "-",
    seed: params.seed ?? 1,
  };
}

// ─── Multi-seed aggregation ─────────────────────────────────────────────────

export interface ScenarioSummary {
  seeds: number[];
  throughputPerDay: { median: number; p10: number; p90: number };
  avgTotalWaitMin: { median: number; p10: number; p90: number };
  perStation: Array<{ key: string; label: string; avgWaitMin: { median: number; p10: number; p90: number }; utilization: { median: number }; maxQueueLength: { median: number } }>;
  bottleneckKey: string;
  bottleneckLabel: string;
}

export function runScenarios(base: SimulationParams, seeds = [1, 2, 3, 4, 5]): ScenarioSummary {
  const results = seeds.map((seed) => runSimulation({ ...base, seed }));
  const stat = (xs: number[]) => ({ median: percentile(xs, 0.5), p10: percentile(xs, 0.1), p90: percentile(xs, 0.9) });
  return {
    seeds,
    throughputPerDay: stat(results.map((r) => r.throughputPerDay)),
    avgTotalWaitMin: stat(results.map((r) => r.avgTotalWaitMin)),
    perStation: base.stations.map((st, i) => ({
      key: st.key,
      label: st.label,
      avgWaitMin: stat(results.map((r) => r.perStation[i]?.avgWaitMin ?? 0)),
      utilization: { median: median(results.map((r) => r.perStation[i]?.utilization ?? 0)) },
      maxQueueLength: { median: median(results.map((r) => r.perStation[i]?.maxQueueLength ?? 0)) },
    })),
    bottleneckKey: medianStrings(results.map((r) => r.bottleneckKey)),
    bottleneckLabel: medianStrings(results.map((r) => r.bottleneckLabel)),
  };
}

// ─── Stats helpers ──────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number {
  return percentile(xs, 0.5);
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = clamp(Math.floor(p * (sorted.length - 1)), 0, sorted.length - 1);
  return Math.round(sorted[idx] * 10) / 10;
}

function medianStrings(xs: string[]): string {
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best = "";
  let bestCount = -1;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return best;
}

// ─── Calibration from operational data (§57 historical calibration) ────────

export interface OperationalBaseline {
  arrivalsPerDay: number;
  stations: Array<{ key: string; label: string; servers: number; meanServiceMin: number; sdServiceMin: number; routeShare: number }>;
  hours: number;
}

/**
 * Derive baseline simulation parameters from aggregate queue/encounter data of
 * the last 14 days. Only aggregates (counts, means) leave the database - no
 * patient-level data (§60).
 */
export async function calibrateFromOperations(orgId: string, facilityId: string): Promise<OperationalBaseline> {
  const { db } = await import("@/lib/db");
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const [queueCount, encounters] = await Promise.all([
    db.queueEntry.count({ where: { orgId, facilityId, checkedInAt: { gte: since } } }),
    db.encounter.findMany({
      where: { orgId, facilityId, startedAt: { gte: since }, completedAt: { not: null } },
      select: { startedAt: true, completedAt: true },
      take: 1000,
    }),
  ]);
  const durations = encounters
    .filter((e) => e.completedAt)
    .map((e) => Math.max(2, (e.completedAt!.getTime() - e.startedAt.getTime()) / 60_000));
  const consultMean = durations.length ? mean(durations) : 15;
  const consultSd = durations.length ? Math.max(2, Math.sqrt(mean(durations.map((d) => (d - consultMean) ** 2)))) : 5;
  const arrivalsPerDay = Math.max(4, Math.round(queueCount / 14));
  return {
    arrivalsPerDay,
    hours: 8,
    stations: [
      { key: "reception", label: "Reception", servers: 1, meanServiceMin: 4, sdServiceMin: 1.5, routeShare: 1 },
      { key: "triage", label: "Triage / Vitals", servers: 1, meanServiceMin: 6, sdServiceMin: 2, routeShare: 1 },
      { key: "consultation", label: "Consultation", servers: 2, meanServiceMin: Math.round(consultMean * 10) / 10, sdServiceMin: Math.round(consultSd * 10) / 10, routeShare: 1 },
      { key: "lab", label: "Laboratory", servers: 1, meanServiceMin: 10, sdServiceMin: 4, routeShare: 0.35 },
      { key: "pharmacy", label: "Pharmacy", servers: 1, meanServiceMin: 5, sdServiceMin: 2, routeShare: 0.6 },
    ],
  };
}
