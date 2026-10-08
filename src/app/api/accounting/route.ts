// Accounting API - expense ledger + management accounting summary (permission-gated).
import { ok, fail, requireAuth, parseBody, parseQuery } from "@/lib/api";
import { z } from "zod";
import {
  accountingSummary, listExpenses, createExpense, patchExpense,
  expenseSchema, expensePatchSchema,
} from "@/modules/accounting";

const query = z.object({
  view: z.enum(["summary", "expenses"]).default("summary"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.string().max(20).optional(),
  category: z.string().max(30).optional(),
  q: z.string().max(120).optional(),
});

export async function GET(request: Request) {
  try {
    const q = parseQuery(request, query);
    const ctx = await requireAuth("accounting:read");

    if (q.view === "expenses") {
      return ok(await listExpenses(ctx, { status: q.status, category: q.category, from: q.from, to: q.to, q: q.q }));
    }

    const to = q.to ?? new Date().toISOString().slice(0, 10);
    const from = q.from ?? new Date(new Date(`${to}T00:00:00.000Z`).getTime() - 89 * 86_400_000).toISOString().slice(0, 10);
    const fromD = new Date(`${from}T00:00:00.000Z`);
    const toD = new Date(`${to}T23:59:59.999Z`);
    if (isNaN(fromD.getTime()) || isNaN(toD.getTime()) || toD < fromD) {
      return ok({ error: "Invalid date range." }, 400);
    }
    return ok(await accountingSummary(ctx, fromD, toD));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("accounting:write");
    const input = await parseBody(request, expenseSchema);
    return ok({ expense: await createExpense(ctx, input) }, 201);
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth("accounting:write");
    const input = await parseBody(request, expensePatchSchema);
    return ok({ expense: await patchExpense(ctx, input) });
  } catch (error) {
    return fail(error);
  }
}
