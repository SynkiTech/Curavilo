// Patient detail API - patient 360 + update
import { ok, fail, requireAuth, parseBody, NotFound } from "@/lib/api";
import { getPatient360, updatePatient, patientSchema } from "@/modules/patients";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth("patients:read");
    const { id } = await params;
    const data = await getPatient360(ctx, id);
    if (!data) return fail(NotFound("Patient not found."));
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth("patients:write");
    const { id } = await params;
    const input = await parseBody(request, patientSchema);
    const patient = await updatePatient(ctx, id, input);
    if (!patient) return fail(NotFound("Patient not found."));
    return ok({ patient });
  } catch (error) {
    return fail(error);
  }
}
