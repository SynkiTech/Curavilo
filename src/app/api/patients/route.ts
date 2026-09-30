// Patients API — list/search, register, patient 360, update
import { ok, fail, requireAuth, parseBody, parseQuery } from "@/lib/api";
import { z } from "zod";
import { registerPatient, patientSchema, searchPatients } from "@/modules/patients";

const listQuery = z.object({
  q: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("patients:read");
    const query = parseQuery(request, listQuery);
    const patients = await searchPatients(ctx, query.q ?? "", query.limit ?? 50);
    return ok({ patients });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("patients:write");
    const input = await parseBody(request, patientSchema);
    const { patient, duplicates } = await registerPatient(ctx, input);
    return ok({ patient, duplicates }, 201);
  } catch (error) {
    return fail(error);
  }
}
