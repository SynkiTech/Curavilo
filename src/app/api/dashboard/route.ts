// Dashboard API - role-aware overview stats + role-gated widget datasets (ADR 0011).
// Every dataset is computed only when the caller's permission set allows it;
// the frontend also filters widgets, but this server-side gate is authoritative.
import { ok, fail, requireAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { dashboardStats } from "@/modules/reports";

export async function GET() {
  try {
    const ctx = await requireAuth("patients:read");
    const stats = await dashboardStats(ctx);
    const p = ctx.permissions;
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const extras: Record<string, unknown> = {};

    if (p.includes("appointments:read")) {
      const appointments = await db.appointment.findMany({
        where: { orgId: ctx.orgId, facilityId: ctx.facilityId, scheduledAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { scheduledAt: "asc" },
        take: 8,
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
          staffMember: { select: { name: true } },
          serviceItem: { select: { name: true } },
        },
      });
      extras.todayAppointments = appointments.map((a) => ({
        id: a.id, scheduledAt: a.scheduledAt.toISOString(), status: a.status,
        patient: a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : "Patient",
        mrn: a.patient?.mrn ?? null,
        with: a.staffMember?.name ?? a.serviceItem?.name ?? null,
      }));
    }

    // My tasks: open tasks for the user's role or unassigned.
    const tasks = await db.task.findMany({
      where: { orgId: ctx.orgId, status: { not: "COMPLETED" }, OR: [{ role: ctx.role }, { role: null }] },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 6,
    });
    extras.myTasks = tasks.map((t) => ({
      id: t.id, title: t.title, priority: t.priority, status: t.status,
      role: t.role, createdAt: t.createdAt.toISOString(),
    }));

    if (p.includes("inventory:read")) {
      const in30 = new Date(Date.now() + 30 * 24 * 3600 * 1000);
      const lots = await db.stockLot.findMany({
        where: {
          orgId: ctx.orgId,
          qtyRemaining: { gt: 0 },
          expiresAt: { not: null, lte: in30 },
        },
        orderBy: { expiresAt: "asc" },
        take: 6,
        include: { item: { select: { name: true, sku: true } } },
      });
      extras.expiringLots = lots.map((l) => ({
        id: l.id, item: l.item.name, batchNo: l.batchNo,
        qtyRemaining: l.qtyRemaining, expiresAt: l.expiresAt?.toISOString() ?? null,
      }));
    }

    if (p.includes("pos:sell")) {
      const [salesCount, salesAgg, returnsAgg] = await Promise.all([
        db.sale.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, status: "COMPLETED", createdAt: { gte: dayStart, lt: dayEnd } } }),
        db.sale.aggregate({
          _sum: { totalMinor: true },
          where: { orgId: ctx.orgId, facilityId: ctx.facilityId, status: "COMPLETED", createdAt: { gte: dayStart, lt: dayEnd } },
        }),
        db.saleReturn.aggregate({
          _sum: { totalMinor: true },
          where: { orgId: ctx.orgId, facilityId: ctx.facilityId, createdAt: { gte: dayStart, lt: dayEnd } },
        }),
      ]);
      extras.todaySales = {
        count: salesCount,
        grossMinor: salesAgg._sum.totalMinor ?? 0,
        returnsMinor: returnsAgg._sum.totalMinor ?? 0,
        currency: ctx.currency,
      };
    }

    if (p.includes("lab:operate")) {
      const [pending, orders] = await Promise.all([
        db.diagnosticOrder.count({
          where: { orgId: ctx.orgId, facilityId: ctx.facilityId, status: { in: ["ORDERED", "SPECIMEN_COLLECTED", "RESULT_ENTERED"] } },
        }),
        db.diagnosticOrder.findMany({
          where: { orgId: ctx.orgId, facilityId: ctx.facilityId, status: { in: ["ORDERED", "SPECIMEN_COLLECTED", "RESULT_ENTERED"] } },
          orderBy: { createdAt: "asc" },
          take: 5,
          include: { patient: { select: { firstName: true, lastName: true } } },
        }),
      ]);
      extras.pendingResults = {
        count: pending,
        orders: orders.map((o) => ({
          id: o.id, test: o.testName, status: o.status,
          patient: o.patient ? `${o.patient.firstName} ${o.patient.lastName}` : "Patient",
          orderedAt: o.createdAt.toISOString(),
        })),
      };
    }

    return ok({ ...stats, ...extras });
  } catch (error) {
    return fail(error);
  }
}
