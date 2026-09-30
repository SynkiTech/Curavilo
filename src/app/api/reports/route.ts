// Reports API — revenue, patient volume, pharmacy sales (permission-filtered)
import { ok, fail, requireAuth, parseQuery } from "@/lib/api";
import { z } from "zod";
import { revenueReport, patientVolumeReport, pharmacySalesReport } from "@/modules/reports";

const query = z.object({
  type: z.enum(["revenue", "volume", "pharmacy"]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const PERMISSION: Record<string, string> = {
  revenue: "billing:read",
  volume: "reports:read",
  pharmacy: "pos:sell",
};

export async function GET(request: Request) {
  try {
    const q = parseQuery(request, query);
    const ctx = await requireAuth(PERMISSION[q.type]);
    const from = new Date(`${q.from}T00:00:00.000Z`);
    const to = new Date(`${q.to}T23:59:59.999Z`);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) {
      return ok({ error: "Invalid date range." }, 400);
    }
    if (q.type === "revenue") return ok(await revenueReport(ctx, from, to));
    if (q.type === "pharmacy") return ok(await pharmacySalesReport(ctx, from, to));
    return ok(await patientVolumeReport(ctx, from, to));
  } catch (error) {
    return fail(error);
  }
}
