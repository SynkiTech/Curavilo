// Reports API - revenue, patient volume, pharmacy sales, inventory, expenses,
// people (permission-filtered per report type).
import { ok, fail, requireAuth, parseQuery } from "@/lib/api";
import { z } from "zod";
import {
  revenueReport, patientVolumeReport, pharmacySalesReport,
  inventoryReport, expensesReport, peopleReport,
} from "@/modules/reports";

const query = z.object({
  type: z.enum(["revenue", "volume", "pharmacy", "inventory", "expenses", "people"]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const PERMISSION: Record<string, string> = {
  revenue: "billing:read",
  volume: "reports:read",
  pharmacy: "pos:sell",
  inventory: "inventory:read",
  expenses: "accounting:read",
  people: "hr:read",
};

export async function GET(request: Request) {
  try {
    const q = parseQuery(request, query);
    const ctx = await requireAuth(PERMISSION[q.type]);

    // Point-in-time reports ignore the date range; ledger reports need it.
    if (q.type === "inventory") return ok(await inventoryReport(ctx));
    if (q.type === "people") return ok(await peopleReport(ctx));

    const to = q.to ?? new Date().toISOString().slice(0, 10);
    const from = q.from ?? new Date(new Date(`${to}T00:00:00.000Z`).getTime() - 89 * 86_400_000).toISOString().slice(0, 10);
    const fromD = new Date(`${from}T00:00:00.000Z`);
    const toD = new Date(`${to}T23:59:59.999Z`);
    if (isNaN(fromD.getTime()) || isNaN(toD.getTime()) || toD < fromD) {
      return ok({ error: "Invalid date range." }, 400);
    }
    if (q.type === "revenue") return ok(await revenueReport(ctx, fromD, toD));
    if (q.type === "pharmacy") return ok(await pharmacySalesReport(ctx, fromD, toD));
    if (q.type === "expenses") return ok(await expensesReport(ctx, fromD, toD));
    return ok(await patientVolumeReport(ctx, fromD, toD));
  } catch (error) {
    return fail(error);
  }
}
