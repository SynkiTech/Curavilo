// Services API - service catalogue list + create + edit (facility-wide)
import { ok, fail, requireAuth, parseBody, parseQuery } from "@/lib/api";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("patients:read");
    const q = parseQuery(request, z.object({ includeInactive: z.enum(["1", "true"]).optional() }));
    // Seeing inactive catalogue entries is a settings-manage capability
    const canManage = ctx.permissions.includes("settings:manage");
    const includeInactive = canManage && (q.includeInactive === "1" || q.includeInactive === "true");
    const services = await db.serviceItem.findMany({
      where: {
        orgId: ctx.orgId,
        ...(includeInactive ? {} : { active: true }),
        OR: [{ facilityId: ctx.facilityId }, { facilityId: null }],
      },
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
    await audit({
      orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
      action: "service.created", entityType: "ServiceItem", entityId: service.id,
      summary: `Service "${service.name}" (${service.code}) added to the catalogue.`,
    });
    return ok({ service }, 201);
  } catch (error) {
    return fail(error);
  }
}

// Edit an existing catalogue entry: prices, name, category, code, active flag.
// Changes are org-wide, so every facility surface (billing, appointments, encounters, POS) sees them.
const patchSchema = z.object({
  id: z.string().min(5),
  code: z.string().min(2).max(40).optional(),
  name: z.string().min(2).max(120).optional(),
  category: z.enum(["CONSULTATION", "EXAMINATION", "PROCEDURE", "LAB", "IMAGING", "MEDICATION", "OTHER"]).optional(),
  priceMinor: z.number().int().min(0).max(10_000_000_000).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth("settings:manage");
    const input = await parseBody(request, patchSchema);
    const service = await db.serviceItem.findFirst({ where: { id: input.id, orgId: ctx.orgId } });
    if (!service) return ok({ error: "Service not found." }, 404);

    if (input.code && input.code !== service.code) {
      const clash = await db.serviceItem.findFirst({ where: { orgId: ctx.orgId, code: input.code } });
      if (clash) return ok({ error: "Code already exists." }, 409);
    }

    const updated = await db.serviceItem.update({
      where: { id: service.id },
      data: {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.priceMinor !== undefined ? { priceMinor: input.priceMinor } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });

    await audit({
      orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
      action: "service.updated", entityType: "ServiceItem", entityId: service.id,
      summary: `Service "${updated.name}" (${updated.code}) updated${
        input.priceMinor !== undefined && input.priceMinor !== service.priceMinor
          ? ` (price ${service.priceMinor} -> ${updated.priceMinor} minor)`
          : ""
      }${input.active === false ? " - deactivated" : ""}${input.active === true ? " - reactivated" : ""}.`,
    });
    return ok({ service: updated });
  } catch (error) {
    return fail(error);
  }
}
