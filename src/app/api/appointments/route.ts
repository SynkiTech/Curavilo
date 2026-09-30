// Appointments API — list, create, status actions
import { ok, fail, requireAuth, parseBody, parseQuery } from "@/lib/api";
import { z } from "zod";
import { createAppointment, appointmentCreateSchema, listAppointments, appointmentAction, type AppointmentAction } from "@/modules/scheduling";

const listQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.string().max(20).optional(),
  patientId: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("appointments:read");
    const query = parseQuery(request, listQuery);
    const appointments = await listAppointments(ctx, query);
    return ok({ appointments });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("appointments:write");
    const input = await parseBody(request, appointmentCreateSchema);
    const appointment = await createAppointment(ctx, input);
    return ok({ appointment }, 201);
  } catch (error) {
    return fail(error);
  }
}

const actionSchema = z.object({ id: z.string().min(5), action: z.enum(["CHECK_IN", "CANCEL", "NO_SHOW", "COMPLETE"]) });

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth("appointments:write");
    const { id, action } = await parseBody(request, actionSchema);
    const appointment = await appointmentAction(ctx, id, action as AppointmentAction);
    return ok({ appointment });
  } catch (error) {
    return fail(error);
  }
}
