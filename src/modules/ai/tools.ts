// AI tool registry — permission-before-retrieval, deterministic, row-limited (spec §42–46)
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth";

export interface ToolProvenance {
  source: string;
  period?: { from: string; to: string; label?: string };
  filters?: Record<string, unknown>;
  recordCount?: number;
  note?: string;
}

export interface ToolResult {
  data: unknown;
  provenance: ToolProvenance;
}

export interface ToolDef {
  name: string;
  description: string;
  permission: string;
  params: z.ZodTypeAny;
  provenanceFields: string[];
  exec: (ctx: AuthContext, params: unknown) => Promise<ToolResult>;
}

const periodSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
    label: z.string().max(60).optional(),
  })
  .strict();

function normalizePeriod(raw: unknown): { from: Date; to: Date; label?: string } {
  const p = periodSchema.parse(raw);
  const from = new Date(`${p.from}T00:00:00.000Z`);
  const to = new Date(`${p.to}T23:59:59.999Z`);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new z.ZodError([]);
  if (to.getTime() - from.getTime() > 400 * 24 * 3600 * 1000) {
    throw new Error("Period too long (max 400 days).");
  }
  if (to < from) throw new Error("Period 'to' is before 'from'.");
  return { from, to, label: p.label };
}

function periodRange(period: "TODAY" | "THIS_WEEK" | "THIS_MONTH" | "THIS_YEAR" | "ALL_TIME") {
  const now = new Date();
  if (period === "TODAY") {
    const from = new Date(now); from.setUTCHours(0, 0, 0, 0);
    return { from, to: now, label: "today" };
  }
  if (period === "THIS_WEEK") {
    const from = new Date(now); from.setUTCHours(0, 0, 0, 0);
    from.setUTCDate(from.getUTCDate() - from.getUTCDay());
    return { from, to: now, label: "this week" };
  }
  if (period === "THIS_MONTH") {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from, to: now, label: "this month" };
  }
  if (period === "THIS_YEAR") {
    const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return { from, to: now, label: "this year" };
  }
  return { from: new Date(Date.UTC(2000, 0, 1)), to: now, label: "all time" };
}

const namedPeriod = z.object({
  period: z.enum(["TODAY", "THIS_WEEK", "THIS_MONTH", "THIS_YEAR", "ALL_TIME"]).default("THIS_MONTH"),
  department: z.string().max(40).optional(),
  status: z.string().max(20).optional(),
}).strict();

const rangePeriod = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().max(60).optional(),
}).strict();

function resolveRange(params: Record<string, unknown>): { from: Date; to: Date; label: string } {
  if (typeof params.from === "string" && typeof params.to === "string") {
    const r = normalizePeriod(params);
    return { from: r.from, to: r.to, label: r.label ?? `${params.from} to ${params.to}` };
  }
  const p = namedPeriod.parse(params);
  const r = periodRange(p.period);
  return { from: r.from, to: r.to, label: r.label ?? p.period };
}

function deny(): ToolResult {
  return {
    data: { denied: true, message: "Your role does not include permission for this information." },
    provenance: { source: "authorization", note: "Permission check failed before data retrieval." },
  };
}

export const AI_TOOLS: ToolDef[] = [
  {
    name: "encounter.count",
    description: "Count patient encounters (completed visits/examinations) in a period, optionally filtered by status or department.",
    permission: "encounters:read",
    params: namedPeriod,
    provenanceFields: ["period", "status"],
    exec: async (ctx, raw) => {
      const params = namedPeriod.parse(raw);
      const { from, to, label } = resolveRange(raw as Record<string, unknown>);
      const where: Record<string, unknown> = { orgId: ctx.orgId, facilityId: ctx.facilityId, startedAt: { gte: from, lte: to } };
      if (params.status) where.status = params.status;
      if (params.department) where.serviceLine = { contains: params.department };
      const count = await db.encounter.count({ where });
      const completed = await db.encounter.count({ where: { ...where, status: "COMPLETED" } });
      return {
        data: { count, completed },
        provenance: { source: "Patient Encounter records", period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label }, filters: { ...(params.status ? { status: params.status } : {}), ...(params.department ? { department: params.department } : {}) }, recordCount: count },
      };
    },
  },
  {
    name: "appointment.count",
    description: "Count appointments in a period, optionally filtered by status (SCHEDULED, CHECKED_IN, COMPLETED, CANCELLED, NO_SHOW).",
    permission: "appointments:read",
    params: namedPeriod,
    provenanceFields: ["period", "status"],
    exec: async (ctx, raw) => {
      const params = namedPeriod.parse(raw);
      const { from, to, label } = resolveRange(raw as Record<string, unknown>);
      const where: Record<string, unknown> = { orgId: ctx.orgId, facilityId: ctx.facilityId, scheduledAt: { gte: from, lte: to } };
      if (params.status) where.status = params.status;
      const count = await db.appointment.count({ where });
      return {
        data: { count },
        provenance: { source: "Appointment records", period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label }, filters: params.status ? { status: params.status } : {}, recordCount: count },
      };
    },
  },
  {
    name: "patient.count",
    description: "Count registered patients (optionally registered within a period).",
    permission: "patients:read",
    params: namedPeriod,
    provenanceFields: ["period"],
    exec: async (ctx, raw) => {
      const { from, to, label } = resolveRange(raw as Record<string, unknown>);
      const where: Record<string, unknown> = { orgId: ctx.orgId, active: true };
      if (label !== "all time") where.createdAt = { gte: from, lte: to };
      const count = await db.patient.count({ where });
      return {
        data: { count, scope: label === "all time" ? "all registered patients" : `patients registered ${label}` },
        provenance: { source: "Patient records", period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label }, recordCount: count },
      };
    },
  },
  {
    name: "patient.search",
    description: "Search patients by name, MRN or phone. Returns limited fields (MRN, name, phone). Max 8 results.",
    permission: "patients:read",
    params: z.object({ query: z.string().min(2).max(60) }).strict(),
    provenanceFields: ["query"],
    exec: async (ctx, raw) => {
      const params = z.object({ query: z.string().min(2).max(60) }).strict().parse(raw);
      const patients = await db.patient.findMany({
        where: {
          orgId: ctx.orgId,
          active: true,
          OR: [
            { firstName: { contains: params.query } },
            { lastName: { contains: params.query } },
            { mrn: { contains: params.query } },
            { phone: { contains: params.query } },
          ],
        },
        take: 8,
        select: { mrn: true, firstName: true, lastName: true, phone: true, id: true },
      });
      return {
        data: { patients },
        provenance: { source: "Patient records", filters: { query: params.query }, recordCount: patients.length },
      };
    },
  },
  {
    name: "billing.revenue",
    description: "Total recorded (non-void) payments in a period, broken down by payment method.",
    permission: "billing:read",
    params: rangePeriod,
    provenanceFields: ["period"],
    exec: async (ctx, raw) => {
      const params = rangePeriod.parse(raw);
      const { from, to, label } = normalizePeriod(params);
      const agg = await db.payment.aggregate({
        where: { orgId: ctx.orgId, facilityId: ctx.facilityId, voidedAt: null, createdAt: { gte: from, lte: to } },
        _sum: { amountMinor: true },
        _count: true,
      });
      const byMethod = await db.payment.groupBy({
        by: ["method"],
        where: { orgId: ctx.orgId, facilityId: ctx.facilityId, voidedAt: null, createdAt: { gte: from, lte: to } },
        _sum: { amountMinor: true },
      });
      return {
        data: {
          totalMinor: agg._sum.amountMinor ?? 0,
          paymentCount: agg._count,
          byMethod: byMethod.map((m) => ({ method: m.method, totalMinor: m._sum.amountMinor ?? 0 })),
          note: "amounts are integer minor units (kobo); 100 minor = 1 major unit",
        },
        provenance: { source: "Payment records", period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label }, recordCount: agg._count },
      };
    },
  },
  {
    name: "pharmacy.sales",
    description: "Total completed POS/pharmacy sales in a period.",
    permission: "pos:sell",
    params: rangePeriod,
    provenanceFields: ["period"],
    exec: async (ctx, raw) => {
      const params = rangePeriod.parse(raw);
      const { from, to, label } = normalizePeriod(params);
      const agg = await db.sale.aggregate({
        where: { orgId: ctx.orgId, facilityId: ctx.facilityId, status: "COMPLETED", createdAt: { gte: from, lte: to } },
        _sum: { totalMinor: true },
        _count: true,
      });
      return {
        data: { totalMinor: agg._sum.totalMinor ?? 0, salesCount: agg._count, note: "amounts are integer minor units (kobo)" },
        provenance: { source: "POS Sale records", period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label }, recordCount: agg._count },
      };
    },
  },
  {
    name: "inventory.lowStock",
    description: "List inventory items at or below reorder level (stock on hand vs reorder level). Max 20 rows.",
    permission: "inventory:read",
    params: z.object({}).strict(),
    provenanceFields: [],
    exec: async (ctx) => {
      const items = await db.inventoryItem.findMany({
        where: { orgId: ctx.orgId, facilityId: ctx.facilityId, active: true },
        include: { lots: true },
        take: 200,
      });
      const low = items
        .map((i) => ({ name: i.name, sku: i.sku, stockOnHand: i.lots.reduce((s, l) => s + l.qtyRemaining, 0), reorderLevel: i.reorderLevel }))
        .filter((i) => i.stockOnHand <= i.reorderLevel)
        .slice(0, 20);
      return {
        data: { lowStockItems: low, count: low.length },
        provenance: { source: "Inventory item + stock lot records", recordCount: low.length },
      };
    },
  },
  {
    name: "inventory.expiry",
    description: "List stock lots expiring within N days (default 90). Max 20 rows.",
    permission: "inventory:read",
    params: z.object({ days: z.number().int().min(1).max(365).default(90) }).strict(),
    provenanceFields: ["days"],
    exec: async (ctx, raw) => {
      const params = z.object({ days: z.number().int().min(1).max(365).default(90) }).strict().parse(raw);
      const cutoff = new Date(Date.now() + params.days * 24 * 3600 * 1000);
      const lots = await db.stockLot.findMany({
        where: { orgId: ctx.orgId, expiresAt: { not: null, lte: cutoff }, qtyRemaining: { gt: 0 } },
        include: { item: { select: { name: true, sku: true } } },
        take: 20,
        orderBy: { expiresAt: "asc" },
      });
      return {
        data: { lots: lots.map((l) => ({ item: l.item.name, sku: l.item.sku, batchNo: l.batchNo, expiresAt: l.expiresAt, qtyRemaining: l.qtyRemaining })) },
        provenance: { source: "Stock lot records", filters: { expiringWithinDays: params.days }, recordCount: lots.length },
      };
    },
  },
  {
    name: "followup.overdue",
    description: "Count/list pending follow-ups past their due date. Max 20 rows listed.",
    permission: "patients:read",
    params: z.object({}).strict(),
    provenanceFields: [],
    exec: async (ctx) => {
      const overdue = await db.followUp.findMany({
        where: { orgId: ctx.orgId, facilityId: ctx.facilityId, status: "PENDING", dueAt: { lt: new Date() } },
        include: { patient: { select: { mrn: true, firstName: true, lastName: true } } },
        take: 20,
        orderBy: { dueAt: "asc" },
      });
      const count = await db.followUp.count({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, status: "PENDING", dueAt: { lt: new Date() } } });
      return {
        data: { count, sample: overdue.map((f) => ({ patient: `${f.patient.firstName} ${f.patient.lastName}`, mrn: f.patient.mrn, dueAt: f.dueAt, title: f.title })) },
        provenance: { source: "Follow-up records", recordCount: count },
      };
    },
  },
  {
    name: "analytics.patientVolume",
    description: "Patient volume (completed encounters) grouped by department/service line for a period.",
    permission: "reports:read",
    params: rangePeriod,
    provenanceFields: ["period"],
    exec: async (ctx, raw) => {
      const params = rangePeriod.parse(raw);
      const { from, to, label } = normalizePeriod(params);
      const encounters = await db.encounter.findMany({
        where: { orgId: ctx.orgId, facilityId: ctx.facilityId, startedAt: { gte: from, lte: to }, status: "COMPLETED" },
        select: { serviceLine: true },
      });
      const byServiceLine = encounters.reduce<Record<string, number>>((acc, e) => {
        acc[e.serviceLine] = (acc[e.serviceLine] ?? 0) + 1;
        return acc;
      }, {});
      return {
        data: { total: encounters.length, byServiceLine },
        provenance: { source: "Patient Encounter records", period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label }, recordCount: encounters.length },
      };
    },
  },
  {
    name: "staff.count",
    description: "Count active staff, optionally filtered by designation (DOCTOR, NURSE, OPTOMETRIST, ...).",
    permission: "staff:read",
    params: z.object({ designation: z.string().max(30).optional() }).strict(),
    provenanceFields: ["designation"],
    exec: async (ctx, raw) => {
      const params = z.object({ designation: z.string().max(30).optional() }).strict().parse(raw);
      const where: Record<string, unknown> = { orgId: ctx.orgId, facilityId: ctx.facilityId, active: true };
      if (params.designation) where.designation = { contains: params.designation };
      const count = await db.staffMember.count({ where });
      return {
        data: { count, filter: params.designation ?? "all designations" },
        provenance: { source: "Staff records", filters: params.designation ? { designation: params.designation } : {}, recordCount: count },
      };
    },
  },
];

/** Permission-gated, zod-validated, row-limited execution. Throws AppError on denial. */
export async function executeTool(ctx: AuthContext, toolName: string, params: unknown): Promise<{ result?: ToolResult; denied?: string }> {
  const tool = AI_TOOLS.find((t) => t.name === toolName);
  if (!tool) return { denied: `Unknown tool "${toolName}".` };
  if (!ctx.permissions.includes(tool.permission as never)) {
    return { denied: `Your role does not include permission for "${toolName}" data.` };
  }
  const parsed = tool.params.safeParse(params ?? {});
  if (!parsed.success) {
    return { denied: `Invalid parameters for ${toolName}.` };
  }
  const result = await tool.exec(ctx, parsed.data);
  return { result };
}

export function toolCatalogueForPrompt(): string {
  return AI_TOOLS.map((t) => `- ${t.name}: ${t.description}`).join("\n");
}
