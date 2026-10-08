// Accounting module - expense ledger, management accounting summary, P&L and
// receivables aging. Deterministic figures computed from the ledgers (spec §32).
// Money: integer minor units. All queries facility-scoped via AuthContext.
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFound, AppError } from "@/lib/api";
import type { AuthContext } from "@/lib/auth";

export const EXPENSE_CATEGORIES = [
  "RENT", "UTILITIES", "SALARIES", "SUPPLIES", "EQUIPMENT",
  "MAINTENANCE", "MARKETING", "INSURANCE", "TRANSPORT", "TAX",
  "OPERATIONS", "OTHER",
] as const;

export const EXPENSE_METHODS = ["CASH", "TRANSFER", "CARD", "POS", "CHEQUE"] as const;

export const EXPENSE_STATUSES = ["PENDING", "APPROVED", "PAID", "REJECTED"] as const;

export const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES).default("OPERATIONS"),
  description: z.string().min(2).max(300),
  vendor: z.string().max(160).optional().nullable(),
  reference: z.string().max(80).optional().nullable(),
  amountMinor: z.number().int().min(1).max(10_000_000_000),
  method: z.enum(EXPENSE_METHODS).default("CASH"),
  incurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(600).optional().nullable(),
});

export const expensePatchSchema = z.object({
  id: z.string().min(5),
  action: z.enum(["approve", "reject", "mark-paid", "update"]),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  description: z.string().min(2).max(300).optional(),
  vendor: z.string().max(160).optional().nullable(),
  reference: z.string().max(80).optional().nullable(),
  amountMinor: z.number().int().min(1).max(10_000_000_000).optional(),
  method: z.enum(EXPENSE_METHODS).optional(),
  incurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(600).optional().nullable(),
});

/** Full accounting summary for a period: income vs expenses, P&L, receivables aging. */
export async function accountingSummary(ctx: AuthContext, from: Date, to: Date) {
  const base = { orgId: ctx.orgId, facilityId: ctx.facilityId };

  const [payments, expenses, invoicesIssued, outstandingInvoices] = await Promise.all([
    db.payment.findMany({
      where: { ...base, voidedAt: null, createdAt: { gte: from, lte: to } },
      select: { method: true, amountMinor: true, createdAt: true },
    }),
    db.expense.findMany({
      where: { ...base, status: { in: ["APPROVED", "PAID"] }, incurredAt: { gte: from, lte: to } },
      select: { category: true, amountMinor: true, status: true, method: true },
    }),
    db.invoice.count({ where: { ...base, issuedAt: { gte: from, lte: to }, voidedAt: null } }),
    db.invoice.findMany({
      where: { ...base, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, voidedAt: null },
      select: { number: true, totalMinor: true, amountPaidMinor: true, issuedAt: true, patient: { select: { firstName: true, lastName: true } } },
      orderBy: { issuedAt: "asc" },
      take: 500,
    }),
  ]);

  const revenueMinor = payments.reduce((s, p) => s + p.amountMinor, 0);
  const expensesMinor = expenses.reduce((s, e) => s + e.amountMinor, 0);
  const netMinor = revenueMinor - expensesMinor;

  const byMethod: Record<string, number> = {};
  for (const p of payments) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amountMinor;

  const byCategory: Record<string, number> = {};
  for (const e of expenses) byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amountMinor;

  const pendingExpenses = await db.expense.aggregate({
    where: { ...base, status: "PENDING" },
    _count: true,
    _sum: { amountMinor: true },
  });

  // Receivables aging buckets by invoice issue date relative to today.
  const now = Date.now();
  const aging = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  const receivables = outstandingInvoices
    .filter((inv): inv is (typeof inv) & { issuedAt: Date } => !!inv.issuedAt)
    .map((inv) => {
      const due = inv.totalMinor - inv.amountPaidMinor;
      const days = Math.floor((now - inv.issuedAt.getTime()) / 86_400_000);
      if (days <= 30) aging.current += due;
      else if (days <= 60) aging.d30 += due;
      else if (days <= 90) aging.d60 += due;
      else if (days <= 120) aging.d90 += due;
      else aging.d90plus += due;
      return {
        number: inv.number,
        patient: inv.patient ? `${inv.patient.firstName} ${inv.patient.lastName}` : null,
        dueMinor: due,
        daysOutstanding: days,
      };
    })
    .sort((a, b) => b.daysOutstanding - a.daysOutstanding)
    .slice(0, 20);
  const outstandingMinor = Object.values(aging).reduce((s, v) => s + v, 0);

  return {
    period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    revenueMinor,
    expensesMinor,
    netMinor,
    paymentCount: payments.length,
    invoicesIssued,
    byMethod,
    byCategory,
    outstandingMinor,
    aging,
    receivables,
    pendingExpenseCount: pendingExpenses._count ?? 0,
    pendingExpenseMinor: pendingExpenses._sum.amountMinor ?? 0,
    currency: ctx.currency,
  };
}

/** Expense ledger with optional filters. */
export async function listExpenses(
  ctx: AuthContext,
  opts: { status?: string; category?: string; from?: string; to?: string; q?: string }
) {
  const where: Record<string, unknown> = { orgId: ctx.orgId, facilityId: ctx.facilityId };
  if (opts.status) where.status = opts.status;
  if (opts.category) where.category = opts.category;
  if (opts.from || opts.to) {
    where.incurredAt = {
      ...(opts.from ? { gte: new Date(`${opts.from}T00:00:00.000Z`) } : {}),
      ...(opts.to ? { lte: new Date(`${opts.to}T23:59:59.999Z`) } : {}),
    };
  }
  if (opts.q) {
    where.OR = [
      { description: { contains: opts.q } },
      { vendor: { contains: opts.q } },
      { reference: { contains: opts.q } },
    ];
  }
  const rows = await db.expense.findMany({
    where,
    orderBy: { incurredAt: "desc" },
    take: 300,
  });
  const totals = {
    allMinor: rows.reduce((s, e) => s + e.amountMinor, 0),
    pendingMinor: rows.filter((e) => e.status === "PENDING").reduce((s, e) => s + e.amountMinor, 0),
    approvedMinor: rows.filter((e) => e.status === "APPROVED").reduce((s, e) => s + e.amountMinor, 0),
    paidMinor: rows.filter((e) => e.status === "PAID").reduce((s, e) => s + e.amountMinor, 0),
  };
  return { expenses: rows.map(serializeExpense), totals, currency: ctx.currency };
}

type ExpenseRow = {
  id: string; orgId: string; facilityId: string; category: string; description: string;
  vendor: string | null; reference: string | null; amountMinor: number; currency: string;
  method: string; status: string; incurredAt: Date; paidAt: Date | null;
  requestedByName: string; approvedByName: string | null; note: string | null;
  createdAt: Date; updatedAt: Date;
};

function serializeExpense(e: ExpenseRow) {
  return {
    id: e.id,
    category: e.category,
    description: e.description,
    vendor: e.vendor,
    reference: e.reference,
    amountMinor: e.amountMinor,
    currency: e.currency,
    method: e.method,
    status: e.status,
    incurredAt: e.incurredAt.toISOString().slice(0, 10),
    paidAt: e.paidAt?.toISOString() ?? null,
    requestedByName: e.requestedByName,
    approvedByName: e.approvedByName,
    note: e.note,
  };
}

export async function createExpense(ctx: AuthContext, input: z.infer<typeof expenseSchema>) {
  const expense = await db.expense.create({
    data: {
      orgId: ctx.orgId,
      facilityId: ctx.facilityId,
      category: input.category,
      description: input.description,
      vendor: input.vendor ?? null,
      reference: input.reference ?? null,
      amountMinor: input.amountMinor,
      currency: ctx.currency,
      method: input.method,
      status: "PENDING",
      incurredAt: new Date(`${input.incurredAt}T00:00:00.000Z`),
      requestedByName: ctx.userName,
      note: input.note ?? null,
    },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "expense.created", entityType: "Expense", entityId: expense.id,
    summary: `Expense recorded: ${expense.description} (${expense.category}, ${expense.amountMinor} minor).`,
  });
  return serializeExpense(expense);
}

export async function patchExpense(ctx: AuthContext, input: z.infer<typeof expensePatchSchema>) {
  const existing = await db.expense.findFirst({
    where: { id: input.id, orgId: ctx.orgId, facilityId: ctx.facilityId },
  });
  if (!existing) throw NotFound("Expense not found.");

  let data: Record<string, unknown> = {};

  if (input.action === "approve") {
    if (existing.status !== "PENDING") throw new AppError(400, "invalid_state", "Only pending expenses can be approved.");
    data = { status: "APPROVED", approvedByName: ctx.userName };
  } else if (input.action === "reject") {
    if (existing.status !== "PENDING") throw new AppError(400, "invalid_state", "Only pending expenses can be rejected.");
    data = { status: "REJECTED", approvedByName: ctx.userName };
  } else if (input.action === "mark-paid") {
    if (existing.status !== "APPROVED") throw new AppError(400, "invalid_state", "Approve the expense before recording payment.");
    data = { status: "PAID", paidAt: new Date() };
  } else {
    if (existing.status === "PAID" || existing.status === "REJECTED") {
      throw new AppError(400, "invalid_state", "Paid or rejected expenses can no longer be edited.");
    }
    data = {
      ...(input.category ? { category: input.category } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.vendor !== undefined ? { vendor: input.vendor } : {}),
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
      ...(input.amountMinor ? { amountMinor: input.amountMinor } : {}),
      ...(input.method ? { method: input.method } : {}),
      ...(input.incurredAt ? { incurredAt: new Date(`${input.incurredAt}T00:00:00.000Z`) } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    };
  }

  const expense = await db.expense.update({ where: { id: existing.id }, data });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: `expense.${input.action}`, entityType: "Expense", entityId: expense.id,
    summary: `Expense ${expense.description} is now ${expense.status}.`,
  });
  return serializeExpense(expense);
}
