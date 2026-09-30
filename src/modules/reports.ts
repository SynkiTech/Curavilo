// Dashboard & reports modules - deterministic analytics (spec §32, §55)
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth";

function dayBounds(date = new Date()) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { start, end };
}

export async function dashboardStats(ctx: AuthContext) {
  const { start, end } = dayBounds();
  const profile = ctx.serviceProfileKey;
  const trendStart = new Date(start.getTime() - 13 * 24 * 3600 * 1000);

  const [patientsToday, waiting, called, inService, completedToday, appointmentsToday, revenueAgg, lowStockCount, overdueFollowUps, recentPayments, trendPayments, trendEncounters] = await Promise.all([
    db.patient.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, createdAt: { gte: start } } }),
    db.queueEntry.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, checkedInAt: { gte: start }, status: "WAITING" } }),
    db.queueEntry.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, checkedInAt: { gte: start }, status: "CALLED" } }),
    db.queueEntry.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, checkedInAt: { gte: start }, status: "IN_SERVICE" } }),
    db.encounter.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, startedAt: { gte: start }, status: "COMPLETED" } }),
    db.appointment.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, scheduledAt: { gte: start, lt: end } } }),
    db.payment.aggregate({
      where: { orgId: ctx.orgId, facilityId: ctx.facilityId, voidedAt: null, createdAt: { gte: start } },
      _sum: { amountMinor: true },
    }),
    db.inventoryItem.count({
      where: { orgId: ctx.orgId, facilityId: ctx.facilityId, active: true, reorderLevel: { gte: 1 }, lots: { none: {} } },
    }),
    db.followUp.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, status: "PENDING", dueAt: { lt: new Date() } } }),
    db.payment.findMany({
      where: { orgId: ctx.orgId, facilityId: ctx.facilityId, voidedAt: null },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { invoice: { include: { patient: true } } },
    }),
    db.payment.findMany({
      where: { orgId: ctx.orgId, facilityId: ctx.facilityId, voidedAt: null, createdAt: { gte: trendStart } },
      select: { createdAt: true, amountMinor: true, method: true },
    }),
    db.encounter.findMany({
      where: { orgId: ctx.orgId, facilityId: ctx.facilityId, startedAt: { gte: trendStart } },
      select: { startedAt: true },
    }),
  ]);

  // Stock on hand vs reorder level
  const items = await db.inventoryItem.findMany({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, active: true },
    include: { lots: true },
  });
  const lowStock = items
    .map((i) => ({ id: i.id, name: i.name, stockOnHand: i.lots.reduce((s, l) => s + l.qtyRemaining, 0), reorderLevel: i.reorderLevel }))
    .filter((i) => i.stockOnHand <= i.reorderLevel)
    .slice(0, 8);

  const queueSnapshot = await db.queueEntry.findMany({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, checkedInAt: { gte: start }, status: { in: ["WAITING", "CALLED", "IN_SERVICE"] } },
    orderBy: { number: "asc" },
    include: { patient: true },
    take: 12,
  });

  // 14-day trend series (UTC day buckets, zero-filled)
  const days: string[] = [];
  for (let i = 0; i < 14; i++) days.push(new Date(trendStart.getTime() + i * 24 * 3600 * 1000).toISOString().slice(0, 10));
  const bucket = (iso: Date) => iso.toISOString().slice(0, 10);
  const revenueByDay = new Map<string, number>(days.map((d) => [d, 0]));
  const revenueByMethod = new Map<string, number>();
  for (const p of trendPayments) {
    const d = bucket(p.createdAt);
    revenueByDay.set(d, (revenueByDay.get(d) ?? 0) + p.amountMinor);
    revenueByMethod.set(p.method, (revenueByMethod.get(p.method) ?? 0) + p.amountMinor);
  }
  const encountersByDay = new Map<string, number>(days.map((d) => [d, 0]));
  for (const e of trendEncounters) {
    const d = bucket(e.startedAt);
    encountersByDay.set(d, (encountersByDay.get(d) ?? 0) + 1);
  }

  return {
    stats: {
      patientsToday,
      waiting: waiting + called,
      inService,
      completedToday,
      appointmentsToday,
      revenueTodayMinor: revenueAgg._sum.amountMinor ?? 0,
      overdueFollowUps,
      currency: ctx.currency,
      profile,
    },
    lowStock,
    queueSnapshot,
    recentPayments,
    trends: {
      revenueByDay: days.map((d) => ({ date: d, minor: revenueByDay.get(d) ?? 0 })),
      encountersByDay: days.map((d) => ({ date: d, count: encountersByDay.get(d) ?? 0 })),
      revenueByMethod: [...revenueByMethod.entries()].map(([method, minor]) => ({ method, minor })).sort((a, b) => b.minor - a.minor),
    },
  };
}

export async function revenueReport(ctx: AuthContext, from: Date, to: Date) {
  const payments = await db.payment.findMany({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, voidedAt: null, createdAt: { gte: from, lt: to } },
    orderBy: { createdAt: "asc" },
    include: { invoice: { include: { patient: true } } },
  });
  const totalMinor = payments.reduce((s, p) => s + p.amountMinor, 0);
  const byMethod = payments.reduce<Record<string, number>>((acc, p) => {
    acc[p.method] = (acc[p.method] ?? 0) + p.amountMinor;
    return acc;
  }, {});
  const invoicesIssued = await db.invoice.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, issuedAt: { gte: from, lt: to } } });
  const outstandingAgg = await db.invoice.aggregate({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
    _sum: { totalMinor: true, amountPaidMinor: true },
  });
  return {
    payments: payments.map((p) => ({
      id: p.id, number: p.number, method: p.method, amountMinor: p.amountMinor,
      createdAt: p.createdAt, invoiceNumber: p.invoice?.number, patient: p.invoice?.patient ? `${p.invoice.patient.firstName} ${p.invoice.patient.lastName}` : null,
    })),
    totalMinor,
    byMethod,
    invoicesIssued,
    outstandingMinor: (outstandingAgg._sum.totalMinor ?? 0) - (outstandingAgg._sum.amountPaidMinor ?? 0),
  };
}

export async function patientVolumeReport(ctx: AuthContext, from: Date, to: Date) {
  const encounters = await db.encounter.findMany({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, startedAt: { gte: from, lt: to } },
    include: { patient: true },
  });
  const byDay = new Map<string, number>();
  const bySex = { MALE: 0, FEMALE: 0 };
  let withDiagnosis = 0;
  for (const e of encounters) {
    const day = e.startedAt.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    if (e.patient.sex === "MALE") bySex.MALE++;
    else bySex.FEMALE++;
    if (e.diagnosis) withDiagnosis++;
  }
  const avgWaitingMinutes =
    encounters.filter((e) => e.status === "COMPLETED" && e.completedAt).reduce((s, e) => s + ((e.completedAt!.getTime() - e.startedAt.getTime()) / 60000), 0) /
    Math.max(encounters.filter((e) => e.status === "COMPLETED" && e.completedAt).length, 1);
  return {
    total: encounters.length,
    byDay: [...byDay.entries()].sort().map(([date, count]) => ({ date, count })),
    bySex,
    withDiagnosis,
    avgEncounterMinutes: Math.round(avgWaitingMinutes),
  };
}

export async function pharmacySalesReport(ctx: AuthContext, from: Date, to: Date) {
  const sales = await db.sale.findMany({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, status: "COMPLETED", createdAt: { gte: from, lt: to } },
    include: { items: true },
  });
  const totalMinor = sales.reduce((s, sale) => s + sale.totalMinor, 0);
  const byDay = new Map<string, number>();
  const topItems = new Map<string, { name: string; qty: number; totalMinor: number }>();
  for (const sale of sales) {
    const day = sale.createdAt.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + sale.totalMinor);
    for (const item of sale.items) {
      const prev = topItems.get(item.itemId) ?? { name: item.name, qty: 0, totalMinor: 0 };
      prev.qty += item.quantity;
      prev.totalMinor += item.totalMinor;
      topItems.set(item.itemId, prev);
    }
  }
  return {
    totalMinor,
    salesCount: sales.length,
    byDay: [...byDay.entries()].sort().map(([date, total]) => ({ date, total })),
    topItems: [...topItems.values()].sort((a, b) => b.totalMinor - a.totalMinor).slice(0, 10),
  };
}
