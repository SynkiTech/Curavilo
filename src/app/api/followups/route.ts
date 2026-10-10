// Follow-ups API - list pending/overdue, complete
import { ok, fail, requireAuth, parseBody, parseQuery } from "@/lib/api";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

const query = z.object({
  status: z.enum(["PENDING", "COMPLETED", "CANCELLED"]).optional(),
  patientId: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("patients:read");
    const q = parseQuery(request, query);
    const followUps = await db.followUp.findMany({
      where: { orgId: ctx.orgId, facilityId: ctx.facilityId, ...(q.status ? { status: q.status } : {}), ...(q.patientId ? { patientId: q.patientId } : {}) },
      orderBy: { dueAt: "asc" },
      take: 100,
      include: { patient: { select: { mrn: true, firstName: true, lastName: true } } },
    });
    return ok({ followUps });
  } catch (error) {
    return fail(error);
  }
}

const patchSchema = z.object({
  followUpId: z.string().min(5),
  status: z.enum(["COMPLETED", "CANCELLED"]),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth("encounters:write");
    const body = await parseBody(request, patchSchema);
    // Facility isolation: non-admin staff may only close follow-ups of their own facility.
    const spansOrg = ctx.role === "OWNER" || ctx.role === "ADMIN" || ctx.permissions.includes("org:manage");
    const followUp = await db.followUp.findFirst({
      where: { id: body.followUpId, orgId: ctx.orgId, ...(spansOrg ? {} : { facilityId: ctx.facilityId }) },
    });
    if (!followUp) return ok({ error: "Follow-up not found." }, 404);
    const updated = await db.followUp.update({
      where: { id: followUp.id },
      data: { status: body.status },
    });
    await audit({
      orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
      action: "followup.updated", entityType: "FollowUp", entityId: followUp.id,
      summary: `Follow-up marked ${body.status}.`,
    });
    return ok({ followUp: updated });
  } catch (error) {
    return fail(error);
  }
}
