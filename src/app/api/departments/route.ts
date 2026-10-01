// Departments API (ADR 0011) - facility departments for staff organization.
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, requireAuth, parseBody, parseQuery, NotFound } from "@/lib/api";
import { audit } from "@/lib/audit";

export async function GET() {
  try {
    const ctx = await requireAuth("staff:read");
    const departments = await db.department.findMany({
      where: { orgId: ctx.orgId, active: true },
      orderBy: { name: "asc" },
      include: { _count: { select: { users: true } } },
    });
    return ok({ departments: departments.map((d) => ({ id: d.id, name: d.name, facilityId: d.facilityId, memberCount: d._count.users })) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("staff:manage");
    const input = await parseBody(request, z.object({
      name: z.string().min(2).max(60),
      facilityId: z.string().min(5).optional().nullable(),
    }));
    if (input.facilityId) {
      const facility = await db.facility.findFirst({ where: { id: input.facilityId, orgId: ctx.orgId } });
      if (!facility) throw NotFound("Facility not found.");
    }
    const department = await db.department.create({
      data: { orgId: ctx.orgId, facilityId: input.facilityId || null, name: input.name },
    });
    await audit({
      orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
      action: "staff.department_created", entityType: "Department", entityId: department.id,
      summary: `Department "${department.name}" created.`,
    });
    return ok({ department }, 201);
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth("staff:manage");
    const input = await parseBody(request, z.object({
      id: z.string().min(5),
      name: z.string().min(2).max(60).optional(),
      active: z.boolean().optional(),
    }));
    const department = await db.department.findFirst({ where: { id: input.id, orgId: ctx.orgId } });
    if (!department) throw NotFound("Department not found.");
    await db.department.update({
      where: { id: department.id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    await audit({
      orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
      action: "staff.department_updated", entityType: "Department", entityId: department.id,
      summary: `Department "${department.name}" updated.`,
    });
    return ok({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
