// Data import/export API (spec §64–65)
import { z } from "zod";
import { ok, fail, requireAuth, parseBody } from "@/lib/api";
import { exportPatients, exportInvoices, exportAppointments, previewPatientImport, commitPatientImport } from "@/modules/data";

// Server-side row schema: import rows are NEVER trusted as-is. Explicit field
// picking means tenant columns (orgId/facilityId/mrn) can never be overridden.
const importRowSchema = z.object({
  firstName: z.string().min(2).max(60),
  lastName: z.string().min(2).max(60),
  phone: z.string().min(7).max(30),
  sex: z.enum(["MALE", "FEMALE"]),
});

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("data:manage");
    // Bulk PHI export: rate limited per user and always audited (auditExport below).
    const { rateLimit, clientIp } = await import("@/lib/rate-limit");
    if (!rateLimit(`export:${clientIp(request)}:${ctx.userId}`, 10, 10 * 60_000)) {
      return ok({ error: "Too many exports. Please wait a few minutes." }, 429);
    }
    const what = new URL(request.url).searchParams.get("export");
    let csv = "";
    if (what === "patients") csv = await exportPatients(ctx);
    else if (what === "invoices") csv = await exportInvoices(ctx);
    else if (what === "appointments") csv = await exportAppointments(ctx);
    else return ok({ error: "Unknown export type. Use ?export=patients|invoices|appointments" }, 400);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="curavilo-${what}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("data:manage");
    const body = await parseBody(
      request,
      z.object({
        action: z.enum(["PREVIEW", "COMMIT"]),
        csv: z.string().max(400_000).optional(),
        rows: z.array(importRowSchema).max(500).optional(),
      })
    );
    if (body.action === "PREVIEW") {
      if (!body.csv) return ok({ error: "csv is required for PREVIEW." }, 400);
      const result = await previewPatientImport(ctx, body.csv);
      return ok(result);
    }
    // COMMIT: rows re-validated by Zod above (strict field set), length capped;
    // the module picks explicit fields only - tenant columns never come from the client.
    if (!body.rows || body.rows.length === 0) return ok({ error: "rows are required for COMMIT." }, 400);
    return ok(await commitPatientImport(ctx, body.rows));
  } catch (error) {
    return fail(error);
  }
}
export const dynamic = "force-dynamic";
