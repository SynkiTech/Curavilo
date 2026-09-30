// Settings API — facility branding/profile + terminology preview
import { ok, fail, requireAuth, parseBody } from "@/lib/api";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getProfile } from "@/lib/service-profiles";

export async function GET() {
  try {
    const ctx = await requireAuth("settings:manage");
    const facility = await db.facility.findFirst({ where: { id: ctx.facilityId, orgId: ctx.orgId } });
    if (!facility) return ok({ error: "Facility not found." }, 404);
    const profile = getProfile(facility.serviceProfileKey);
    return ok({ facility, profile });
  } catch (error) {
    return fail(error);
  }
}

const patchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  address: z.string().max(300).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  logoData: z
    .string()
    .max(400_000)
    .refine((v) => v === "" || /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(v), "Logo must be a PNG/JPEG/WebP image (raster only).")
    .optional()
    .nullable(),
  reportFooter: z.string().max(300).optional().nullable(),
  receiptFooter: z.string().max(300).optional().nullable(),
  brandColor: z.string().max(20).optional().nullable(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth("settings:manage");
    const input = await parseBody(request, patchSchema);
    const facility = await db.facility.findFirst({ where: { id: ctx.facilityId, orgId: ctx.orgId } });
    if (!facility) return ok({ error: "Facility not found." }, 404);

    const updated = await db.facility.update({
      where: { id: facility.id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.address !== undefined ? { address: input.address || null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.logoData !== undefined ? { logoData: input.logoData || null } : {}),
        ...(input.reportFooter !== undefined ? { reportFooter: input.reportFooter || null } : {}),
        ...(input.receiptFooter !== undefined ? { receiptFooter: input.receiptFooter || null } : {}),
        ...(input.brandColor !== undefined ? { brandColor: input.brandColor || null } : {}),
      },
    });

    await audit({
      orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
      action: "settings.facility_updated", entityType: "Facility", entityId: facility.id,
      summary: `Facility settings updated${input.logoData ? " (logo uploaded)" : ""}.`,
    });
    return ok({ facility: updated });
  } catch (error) {
    return fail(error);
  }
}
