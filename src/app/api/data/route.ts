// Data import/export API (spec §64–65)
import { ok, fail, requireAuth } from "@/lib/api";
import { exportPatients, exportInvoices, exportAppointments, previewPatientImport, commitPatientImport } from "@/modules/data";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("data:manage");
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
    const body = (await request.json().catch(() => ({}))) as { action?: string; csv?: string; rows?: Array<{ firstName: string; lastName: string; phone: string; sex: string }> };
    if (body.action === "PREVIEW" && typeof body.csv === "string") {
      if (body.csv.length > 400_000) return ok({ error: "CSV too large (max 400 KB)." }, 400);
      const result = await previewPatientImport(ctx, body.csv);
      return ok(result);
    }
    if (body.action === "COMMIT" && Array.isArray(body.rows)) {
      // Rows must come from a preview this session — re-validate length only; server re-validates content shape.
      return ok(await commitPatientImport(ctx, body.rows.slice(0, 500)));
    }
    return ok({ error: "action must be PREVIEW or COMMIT." }, 400);
  } catch (error) {
    return fail(error);
  }
}
export const dynamic = "force-dynamic";
