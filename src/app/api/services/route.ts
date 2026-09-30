// Services API — service catalogue list + create
import { ok, fail, requireAuth, parseBody } from "@/lib/api";
import { z } from "zod";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const ctx = await requireAuth("patients:read");
    const services = await db.serviceItem.findMany({
      where: { orgId: ctx.orgId, active: true, OR: [{ facilityId: ctx.facilityId }, { facilityId: null }] },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return ok({ services });
  } catch (error) {
    return fail(error);
  }
}

const createSchema = z.object({
  code: z.string().min(2).max(40),
  name: z.string().min(2).max(120),
  category: z.enum(["CONSULTATION", "EXAMINATION", "PROCEDURE", "LAB", "IMAGING", "MEDICATION", "OTHER"]),
  priceMinor: z.number().int().min(0).max(10_000_000_000),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("settings:manage");
    const input = await parseBody(request, createSchema);
    const existing = await db.serviceItem.findFirst({ where: { orgId: ctx.orgId, code: input.code } });
    if (existing) return ok({ error: "Code already exists." }, 409);
    const service = await db.serviceItem.create({
      data: { ...input, orgId: ctx.orgId, currency: ctx.currency },
    });
    return ok({ service }, 201);
  } catch (error) {
    return fail(error);
  }
}
