// Encounters API - start, list, detail, complete (charges → invoice, follow-up, workflow trigger)
import { ok, fail, requireAuth, parseBody, parseQuery } from "@/lib/api";
import { z } from "zod";
import { startEncounter, encounterStartSchema, completeEncounter, encounterCompleteSchema, listEncounters, getEncounter } from "@/modules/clinical";

const listQuery = z.object({
  status: z.string().max(20).optional(),
  patientId: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("encounters:read");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (id) {
      const encounter = await getEncounter(ctx, id);
      return ok({ encounter });
    }
    const query = parseQuery(request, listQuery);
    const encounters = await listEncounters(ctx, query);
    return ok({ encounters });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("encounters:write");
    const input = await parseBody(request, encounterStartSchema);
    const encounter = await startEncounter(ctx, input);
    return ok({ encounter }, 201);
  } catch (error) {
    return fail(error);
  }
}

const completeSchema = encounterCompleteSchema;

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth("encounters:write");
    const body = await parseBody(request, completeSchema.and(z.object({ encounterId: z.string().min(5) })));
    const { encounterId, ...input } = body;
    const result = await completeEncounter(ctx, encounterId, input);
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
