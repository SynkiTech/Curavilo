// Staff API — directory list + create (settings:manage for writes, staff:read for list)
import { ok, fail, requireAuth, parseBody } from "@/lib/api";
import { z } from "zod";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const ctx = await requireAuth("staff:read");
    const staff = await db.staffMember.findMany({
      where: { orgId: ctx.orgId, facilityId: ctx.facilityId, active: true },
      orderBy: { name: "asc" },
    });
    return ok({ staff });
  } catch (error) {
    return fail(error);
  }
}

const createSchema = z.object({
  name: z.string().min(2).max(80),
  designation: z.enum(["DOCTOR", "NURSE", "OPTOMETRIST", "RECEPTIONIST", "PHARMACIST", "LAB_SCIENTIST", "CASHIER", "ADMIN", "OTHER"]),
  department: z.string().max(40).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("staff:manage");
    const input = await parseBody(request, createSchema);
    const staff = await db.staffMember.create({
      data: { ...input, orgId: ctx.orgId, facilityId: ctx.facilityId, department: input.department || null },
    });
    return ok({ staff }, 201);
  } catch (error) {
    return fail(error);
  }
}
