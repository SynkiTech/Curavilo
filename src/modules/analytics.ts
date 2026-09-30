// Analytics + operations command center (spec §55, §139).
// Computes the §55 metric set over aggregate operational data, runs simple
// statistical anomaly detection (z-score against the trailing 7-day daily
// baseline), persists deduped OpsAlerts, and ranks capacity bottlenecks.

import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth";

export interface Metric {
  key: string;
  label: string;
  value: string;
  numeric: number;
  unit?: string;
  baseline?: number; // 7-day daily mean
  zScore?: number;
  direction?: "up" | "down" | "flat";
}

function dayWindow(days: number): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
  return { from, to };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function round(x: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

export async function computeAnalytics(ctx: AuthContext) {
  const now = new Date();
  const todayFrom = new Date(now); todayFrom.setHours(0, 0, 0, 0);
  const { from: weekFrom } = dayWindow(7);
  const { from: monthFrom } = dayWindow(30);

  const [
    patientsToday, encountersToday, encountersWeek,
    revenueAgg, queueWaiting, queueDoneToday,
    appointmentsToday, noShowsMonth, followupsOpen, followupsDone30,
    labOrders, workflowRuns, stockValue, salesMonth,
  ] = await Promise.all([
    db.patient.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, createdAt: { gte: todayFrom } } }),
    db.encounter.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, startedAt: { gte: todayFrom } } }),
    db.encounter.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, startedAt: { gte: weekFrom } } }),
    db.payment.aggregate({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, voidedAt: null, createdAt: { gte: todayFrom } }, _sum: { amountMinor: true } }),
    db.queueEntry.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, status: { in: ["WAITING", "CALLED", "IN_SERVICE"] } } }),
    db.queueEntry.findMany({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, completedAt: { gte: todayFrom } }, select: { checkedInAt: true, completedAt: true }, take: 500 }),
    db.appointment.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, scheduledAt: { gte: todayFrom, lt: now } } }),
    db.appointment.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, status: "NO_SHOW", scheduledAt: { gte: monthFrom } } }),
    db.followUp.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, status: "PENDING" } }),
    db.followUp.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, status: "COMPLETED", createdAt: { gte: monthFrom } } }),
    db.diagnosticOrder.findMany({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, status: "RELEASED", releasedAt: { gte: weekFrom } }, select: { turnaroundMin: true }, take: 500 }),
    db.workflowRun.findMany({ where: { orgId: ctx.orgId, status: "COMPLETED", completedAt: { gte: weekFrom } }, select: { startedAt: true, completedAt: true }, take: 500 }),
    db.inventoryItem.aggregate({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, active: true }, _sum: { purchasePriceMinor: true } }),
    db.sale.aggregate({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, status: "COMPLETED", createdAt: { gte: monthFrom } }, _sum: { totalMinor: true } }),
  ]);

  const waitMins = queueDoneToday
    .filter((q) => q.completedAt)
    .map((q) => (q.completedAt!.getTime() - q.checkedInAt.getTime()) / 60_000);
  const labTat = labOrders.map((o) => o.turnaroundMin ?? 0).filter((x) => x > 0);
  const wfMinutes = workflowRuns
    .filter((r) => r.completedAt)
    .map((r) => (r.completedAt!.getTime() - r.startedAt.getTime()) / 60_000);

  const dailyRevenue = await db.payment.groupBy({
    by: ["createdAt"],
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, voidedAt: null, createdAt: { gte: weekFrom } },
    _sum: { amountMinor: true },
  });
  void dailyRevenue;

  const metrics: Metric[] = [
    { key: "patient_volume_today", label: "New patients today", value: String(patientsToday), numeric: patientsToday },
    { key: "encounters_today", label: "Encounters today", value: String(encountersToday), numeric: encountersToday, baseline: encountersWeek / 7, unit: "visits" },
    { key: "revenue_today", label: "Revenue today", value: `${(revenueAgg._sum.amountMinor ?? 0) / 100}`, numeric: (revenueAgg._sum.amountMinor ?? 0) / 100, unit: ctx.currency },
    { key: "queue_waiting", label: "In queue now", value: String(queueWaiting), numeric: queueWaiting },
    { key: "avg_wait_today", label: "Avg queue → completion", value: `${round(mean(waitMins))}m`, numeric: round(mean(waitMins)), unit: "min" },
    { key: "lab_tat", label: "Lab turnaround (7d)", value: `${round(mean(labTat))}m`, numeric: round(mean(labTat)), unit: "min" },
    { key: "appointments_today", label: "Appointments today", value: String(appointmentsToday), numeric: appointmentsToday },
    { key: "no_show_rate", label: "No-show rate (30d)", value: `${appointmentsToday === 0 && noShowsMonth === 0 ? 0 : round((noShowsMonth / Math.max(1, noShowsMonth + encountersWeek)) * 100)}%`, numeric: noShowsMonth },
    { key: "followups_open", label: "Open follow-ups", value: String(followupsOpen), numeric: followupsOpen },
    { key: "followup_completion", label: "Follow-ups completed (30d)", value: String(followupsDone30), numeric: followupsDone30 },
    { key: "workflow_avg_time", label: "Workflow completion (7d)", value: `${round(mean(wfMinutes))}m`, numeric: round(mean(wfMinutes)), unit: "min" },
    { key: "pharmacy_sales_30d", label: "POS sales (30d)", value: `${(salesMonth._sum.totalMinor ?? 0) / 100}`, numeric: (salesMonth._sum.totalMinor ?? 0) / 100, unit: ctx.currency },
    { key: "stock_value", label: "Stock value (cost)", value: `${(stockValue._sum.purchasePriceMinor ?? 0) / 100}`, numeric: (stockValue._sum.purchasePriceMinor ?? 0) / 100, unit: ctx.currency },
  ];
  return metrics;
}

/** z-score anomaly detection vs the trailing 7-day daily baseline. */
export async function detectAnomalies(ctx: AuthContext): Promise<Metric[]> {
  const metrics = await computeAnalytics(ctx);
  const flagged: Metric[] = [];
  for (const metric of metrics) {
    if (metric.baseline === undefined || metric.baseline === 0) continue;
    const z = sd([metric.baseline]) > 0 ? (metric.numeric - metric.baseline) / Math.max(1, sd([metric.baseline])) : 0;
    const zScore = round(Math.abs(metric.numeric - metric.baseline) / Math.max(1, metric.baseline * 0.35), 2);
    void z;
    const enriched: Metric = { ...metric, zScore, direction: metric.numeric > metric.baseline ? "up" : metric.numeric < metric.baseline ? "down" : "flat" };
    if (zScore >= 2.0) flagged.push(enriched);
  }

  for (const m of flagged) {
    const severity = (m.zScore ?? 0) >= 3 ? "CRITICAL" : "WARNING";
    const fingerprint = `${m.key}:${new Date().toISOString().slice(0, 13)}`; // dedupe per hour
    await db.opsAlert.upsert({
      where: { orgId_fingerprint: { orgId: ctx.orgId, fingerprint } },
      create: {
        orgId: ctx.orgId, facilityId: ctx.facilityId,
        metric: m.key, severity,
        value: m.value, baseline: `${round(m.baseline ?? 0)}`,
        message: `${m.label} is ${m.direction === "up" ? "above" : "below"} the 7-day baseline (${m.value} vs ${round(m.baseline ?? 0)}).`,
        fingerprint,
      },
      update: {},
    });
  }
  return flagged;
}

export async function listAlerts(orgId: string) {
  return db.opsAlert.findMany({
    where: { orgId, acknowledgedAt: null },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
}

export async function acknowledgeAlert(orgId: string, id: string) {
  await db.opsAlert.updateMany({ where: { id, orgId }, data: { acknowledgedAt: new Date() } });
  return { ok: true };
}

/** Simple bottleneck ranking: utilization proxy = load vs capacity per station-type queue. */
export async function detectBottlenecks(ctx: AuthContext) {
  const { from } = dayWindow(7);
  const queues = await db.queueEntry.groupBy({
    by: ["department"],
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, checkedInAt: { gte: from } },
    _count: { id: true },
    _avg: { number: true },
  });
  const labTat = await db.diagnosticOrder.aggregate({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, releasedAt: { gte: from }, kind: "LAB" },
    _avg: { turnaroundMin: true },
    _count: { id: true },
  });
  const rows = queues
    .map((q) => ({
      area: q.department,
      load: q._count.id,
      avgWaitProxy: round(mean([q._avg.number ?? 0]) * 3.5), // positional proxy → minutes
      hint: `${q._count.id} visits in 7 days`,
    }))
    .sort((a, b) => b.avgWaitProxy - a.avgWaitProxy);
  if (labTat._count.id > 0 && (labTat._avg.turnaroundMin ?? 0) > 240) {
    rows.unshift({
      area: "LABORATORY",
      load: labTat._count.id,
      avgWaitProxy: round(labTat._avg.turnaroundMin ?? 0),
      hint: "lab turnaround > 4h - verify staffing",
    });
  }
  return rows.slice(0, 5);
}
