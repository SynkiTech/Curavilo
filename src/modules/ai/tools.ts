// AI tool registry - permission-before-retrieval, deterministic, row-limited (spec §42–46)
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

/**
 * Designation keyword expansion: stored designations are free text ("Front Desk
 * Officer", "OD", "RN, Ophthalmic"), so role-style queries ("receptionist",
 * "doctor") are expanded into keywords that match how the facility writes them.
 * The department is included as a fallback match (e.g. department "Front Desk").
 */
export const DESIGNATION_KEYWORDS: Record<string, string[]> = {
  RECEPTIONIST: ["reception", "front desk"],
  DOCTOR: ["doctor", "mbbs", "physician", "medical"],
  OPHTHALMOLOGIST: ["ophthalm"],
  OPTOMETRIST: ["optom", "od"],
  OPTICIAN: ["optic", "dispensing"],
  DENTIST: ["dent"],
  NURSE: ["nurse", "rn"],
  PHARMACIST: ["pharm"],
  LAB_SCIENTIST: ["lab", "scientist"],
  CASHIER: ["cashier"],
  ADMIN: ["admin"],
};

export function designationFilters(input: string): string[] {
  const key = input.trim().toUpperCase();
  const keywords = new Set<string>([input.trim()]);
  for (const [roleKey, words] of Object.entries(DESIGNATION_KEYWORDS)) {
    if (roleKey.includes(key) || key.includes(roleKey) || words.some((w) => key.includes(w.toUpperCase()))) {
      for (const w of words) keywords.add(w);
    }
  }
  return [...keywords];
}

/** Prisma WHERE fragment matching a designation/role query across designation + department. */
export function designationWhere(input: string): Record<string, unknown> {
  const keywords = designationFilters(input);
  return {
    OR: [
      ...keywords.map((kw) => ({ designation: { contains: kw } })),
      { department: { contains: input.trim() } },
    ],
  };
}

/**
 * Map a free-text designation ("Front Desk Officer", "receptionist", "OD") to the
 * closest platform role. Used to reach the facility role team when no staff
 * record matches, and to interpret directory queries.
 */
export function platformRoleForDesignation(input: string | null | undefined): string | null {
  const d = (input ?? "").toUpperCase();
  if (!d) return null;
  // Nurse first: "RN, Ophthalmic" is a nurse, not an ophthalmologist.
  if (d.includes("NURSE") || d.includes("RN")) return "NURSE";
  if (d.includes("OPHTHAL")) return "OPHTHALMOLOGIST";
  if (d.includes("OPTOM")) return "OPTOMETRIST";
  if (d.includes("DENT")) return "DENTIST";
  if (d.includes("OPTIC") || d.includes("DISPENS")) return "OPTICIAN";
  if (d.includes("RECEPTION") || d.includes("FRONT DESK")) return "RECEPTIONIST";
  if (d.includes("PHARM")) return "PHARMACY";
  if (d.includes("LAB") || d.includes("SCIENTIST")) return "LAB";
  if (d.includes("BILL") || d.includes("ACCOUNT") || d.includes("CASHIER")) return "BILLING";
  if (d.includes("DOCTOR") || d.includes("MBBS") || d.includes("MD") || d.includes("MEDICAL") || d.includes("PHYSICIAN")) return "DOCTOR";
  if (d.includes("ADMIN")) return "ADMIN";
  return null;
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
  {
    // Directory lookup for intra-facility messaging and "who is available" questions.
    // Returns workplace contact info only (name, designation, department) - never
    // personal contact details. Available to every role that can use the AI.
    name: "staff.directory",
    description:
      "Look up colleagues in THIS facility by part of a name and/or by role/designation (e.g. receptionist, optometrist, doctor, nurse, pharmacist). Covers personnel records AND active facility accounts. Use it to find who to notify or message, or to answer who-is-on-the-team questions. Returns name, designation and department only. Max 10 rows.",
    permission: "ai:ask",
    params: z
      .object({
        query: z.string().min(2).max(60).optional(),
        designation: z.string().min(2).max(40).optional(),
      })
      .strict(),
    provenanceFields: ["query", "designation"],
    exec: async (ctx, raw) => {
      const params = z
        .object({
          query: z.string().min(2).max(60).optional(),
          designation: z.string().min(2).max(40).optional(),
        })
        .strict()
        .parse(raw);
      if (!params.query && !params.designation) {
        return {
          data: { staff: [], note: "Provide a name or a designation to search the staff directory." },
          provenance: { source: "Staff records", note: "No search filter provided." },
        };
      }
      // Source 1: personnel staff records (may exist without a user account).
      const where: Record<string, unknown> = { orgId: ctx.orgId, facilityId: ctx.facilityId, active: true };
      if (params.query && params.designation) {
        where.AND = [{ name: { contains: params.query } }, designationWhere(params.designation)];
      } else if (params.query) {
        where.name = { contains: params.query };
      } else if (params.designation) {
        Object.assign(where, designationWhere(params.designation));
      }
      const staff = await db.staffMember.findMany({
        where,
        take: 10,
        orderBy: [{ designation: "asc" }, { name: "asc" }],
        select: { id: true, name: true, designation: true, department: true },
      });

      // Source 2: active user accounts opened at this facility (covers colleagues
      // without a personnel record). Matched by name, free-text designation, or
      // the platform role that corresponds to the requested designation.
      const userOr: Record<string, unknown>[] = [];
      if (params.query) {
        userOr.push({ name: { contains: params.query } });
        const qRole = platformRoleForDesignation(params.query);
        if (qRole) userOr.push({ memberships: { some: { orgId: ctx.orgId, role: qRole, active: true } } });
      }
      if (params.designation) {
        const dRole = platformRoleForDesignation(params.designation);
        if (dRole) userOr.push({ memberships: { some: { orgId: ctx.orgId, role: dRole, active: true } } });
        for (const kw of designationFilters(params.designation)) {
          userOr.push({ designation: { contains: kw } });
        }
      }
      let userRows: Array<{ id: string; name: string; designation: string | null; department: string | null }> = [];
      if (userOr.length > 0) {
        const users = await db.user.findMany({
          where: { status: "ACTIVE", facilityMemberships: { some: { facilityId: ctx.facilityId } }, OR: userOr },
          take: 10,
          orderBy: { name: "asc" },
          select: {
            id: true, name: true, designation: true,
            memberships: { where: { orgId: ctx.orgId, active: true }, select: { role: true } },
          },
        });
        userRows = users.map((u) => ({
          id: u.id,
          name: u.name,
          designation: u.designation ?? u.memberships[0]?.role ?? "STAFF",
          department: u.memberships[0]?.role ?? null,
        }));
      }

      // Merge + dedupe by name (a person can exist in both sources).
      const seen = new Set(staff.map((s) => s.name.toLowerCase()));
      const merged = [
        ...staff.map((s) => ({ id: s.id, name: s.name, designation: s.designation, department: s.department })),
        ...userRows.filter((u) => !seen.has(u.name.toLowerCase())),
      ].slice(0, 10);
      return {
        data: { staff: merged, count: merged.length, facility: ctx.facilityName },
        provenance: {
          source: "Staff records",
          filters: {
            ...(params.query ? { query: params.query } : {}),
            ...(params.designation ? { designation: params.designation } : {}),
          },
          recordCount: merged.length,
        },
      };
    },
  },
  {
    // Knowledge tool: clinical decision support, drug/dosing questions, guidelines research,
    // Curavilo platform how-to, and general factual questions. Backed by live web research.
    name: "knowledge.research",
    description:
      "Research a question for professional use. mode=clinical for medical/clinical questions (diagnosis support, differentials, workup, dosing, guidelines - requires healthcare-professional permissions for personalized answers), mode=platform for Curavilo how-to questions (no search needed), mode=general for any other factual question. Provide a concise self-contained search query.",
    permission: "ai:ask",
    params: z.object({
      mode: z.enum(["clinical", "platform", "general"]).default("general"),
      query: z.string().min(2).max(300),
    }).strict(),
    provenanceFields: ["mode"],
    exec: async (ctx, raw) => {
      const params = z.object({
        mode: z.enum(["clinical", "platform", "general"]).default("general"),
        query: z.string().min(2).max(300),
      }).strict().parse(raw);
      // Clinical personalization is reserved for healthcare professionals; others get general info.
      const clinicalProfessional =
        ctx.permissions.includes("encounters:write") ||
        ctx.permissions.includes("lab:operate") ||
        ctx.permissions.includes("inpatient:manage");

      if (params.mode === "platform") {
        return {
          data: {
            mode: params.mode,
            platform: true,
            facility: { name: ctx.facilityName, role: ctx.role },
            note: "Answer from Curavilo product knowledge. No live search needed.",
          },
          provenance: { source: "Curavilo platform knowledge", filters: { mode: params.mode } },
        };
      }

      if (params.mode === "clinical" && !clinicalProfessional) {
        return {
          data: {
            mode: params.mode,
            clinicalAccess: false,
            note: "User is not a healthcare professional: provide general, non-personalized health information only and advise consulting a licensed clinician.",
          },
          provenance: { source: "General health information", filters: { mode: params.mode } },
        };
      }

      // Live research for clinical/general questions (best effort - degrade gracefully)
      let results: Array<{ title: string; snippet: string; url: string; date?: string }> = [];
      try {
        const ZAI = (await import("z-ai-web-dev-sdk")).default;
        const zai = await ZAI.create();
        const search = await zai.functions.invoke("web_search", {
          query: params.query.slice(0, 200),
          num: 6,
          ...(params.mode === "clinical" ? { recency_days: 1095 } : {}),
        });
        results = (Array.isArray(search) ? search : []).slice(0, 6).map((r) => ({
          title: String(r?.name ?? "Source").slice(0, 160),
          snippet: String(r?.snippet ?? "").slice(0, 400),
          url: String(r?.url ?? "").slice(0, 300),
          ...(r?.date ? { date: String(r.date).slice(0, 40) } : {}),
        })).filter((r) => r.title || r.url);
      } catch {
        results = [];
      }
      return {
        data: {
          mode: params.mode,
          clinicalAccess: true,
          searchedAt: new Date().toISOString(),
          results,
          note: results.length
            ? "Synthesize with professional medical knowledge; prefer the search results for recent numbers, doses and guideline updates."
            : "Live research was unavailable - answer from professional knowledge and say the answer could not be verified against live sources.",
        },
        provenance: {
          source: results.length ? "Live web research" : "Professional knowledge (live research unavailable)",
          filters: { mode: params.mode, query: params.query.slice(0, 120) },
          recordCount: results.length,
          results: results.map((r) => ({ title: r.title, url: r.url })),
        },
      };
    },
  },
  {
    name: "accounting.summary",
    description:
      "Accounting summary for THIS facility: expenses booked (total and by category), pending expense approvals, revenue collected and net position for a period. Accepts either explicit from/to dates (YYYY-MM-DD) or a named period. For accountant/finance questions like 'how much did we spend', 'what expenses are pending', 'net position this month'.",
    permission: "accounting:read",
    params: z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        period: z.enum(["TODAY", "THIS_WEEK", "THIS_MONTH", "THIS_YEAR", "ALL_TIME"]).optional(),
        label: z.string().max(60).optional(),
      })
      .strict(),
    provenanceFields: ["period"],
    exec: async (ctx, raw) => {
      const { from, to, label } = resolveRange(raw as Record<string, unknown>);
      const base = { orgId: ctx.orgId, facilityId: ctx.facilityId };
      const [expenses, pending, payments] = await Promise.all([
        db.expense.aggregate({
          where: { ...base, status: { in: ["APPROVED", "PAID"] }, incurredAt: { gte: from, lte: to } },
          _sum: { amountMinor: true },
        }),
        db.expense.aggregate({ where: { ...base, status: "PENDING" }, _sum: { amountMinor: true }, _count: true }),
        db.payment.aggregate({ where: { ...base, voidedAt: null, createdAt: { gte: from, lte: to } }, _sum: { amountMinor: true } }),
      ]);
      const rows = await db.expense.findMany({
        where: { ...base, status: { in: ["APPROVED", "PAID"] }, incurredAt: { gte: from, lte: to } },
        select: { category: true, amountMinor: true },
      });
      const byCategory = rows.reduce<Record<string, number>>((acc, e) => {
        acc[e.category] = (acc[e.category] ?? 0) + e.amountMinor;
        return acc;
      }, {});
      const revenueMinor = payments._sum.amountMinor ?? 0;
      const expensesMinor = expenses._sum.amountMinor ?? 0;
      return {
        data: {
          revenueMinor, expensesMinor,
          netMinor: revenueMinor - expensesMinor,
          pendingExpenses: pending._count ?? 0,
          pendingExpensesMinor: pending._sum.amountMinor ?? 0,
          byCategory,
          currency: ctx.currency,
        },
        provenance: { source: "Expense ledger and payment records", period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label }, recordCount: rows.length },
      };
    },
  },
  {
    name: "hr.summary",
    description:
      "People overview for THIS facility: headcount by department, staff on leave today, pending leave requests, certifications expiring within 30 days and today's attendance. For HR questions like 'who is on leave', 'how many staff', 'which certifications expire soon'.",
    permission: "hr:read",
    params: z.object({}).strict(),
    provenanceFields: [],
    exec: async (ctx) => {
      const now = new Date();
      const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
      const in30 = new Date(now.getTime() + 30 * 86_400_000);
      const [staff, onLeave, pendingLeave, certs] = await Promise.all([
        db.staffMember.findMany({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, active: true }, select: { designation: true, department: true } }),
        db.leaveRequest.findMany({
          where: { orgId: ctx.orgId, status: "APPROVED", fromAt: { lte: now }, toAt: { gte: dayStart } },
          include: { staff: { select: { name: true, designation: true } } },
          take: 10,
        }),
        db.leaveRequest.count({ where: { orgId: ctx.orgId, status: "PENDING" } }),
        db.staffCertification.findMany({
          where: { orgId: ctx.orgId, expiresAt: { lte: in30, gte: now } },
          include: { staff: { select: { name: true } } },
          orderBy: { expiresAt: "asc" },
          take: 6,
        }),
      ]);
      const byDepartment = staff.reduce<Record<string, number>>((acc, s) => {
        const d = s.department?.trim() || "Unassigned";
        acc[d] = (acc[d] ?? 0) + 1;
        return acc;
      }, {});
      return {
        data: {
          headcount: staff.length,
          byDepartment,
          onLeaveToday: onLeave.map((l) => ({ name: l.staff?.name ?? "Staff", designation: l.staff?.designation ?? null, until: l.toAt.toISOString().slice(0, 10) })),
          pendingLeaveRequests: pendingLeave,
          certificationsExpiring: certs.map((c) => ({ staff: c.staff?.name ?? "Staff", name: c.name, expiresAt: c.expiresAt.toISOString().slice(0, 10) })),
        },
        provenance: { source: "Personnel, leave and certification records", filters: {}, recordCount: staff.length },
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
