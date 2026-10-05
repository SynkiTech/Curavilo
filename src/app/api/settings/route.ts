// Settings API - facility branding/profile + editable terminology + profile switching
import { ok, fail, requireAuth, parseBody } from "@/lib/api";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getProfile, SERVICE_PROFILES, PROFILE_KEYS, TERMINOLOGY_KEYS, resolveTerminology } from "@/lib/service-profiles";

export async function GET() {
  try {
    const ctx = await requireAuth("settings:manage");
    const facility = await db.facility.findFirst({ where: { id: ctx.facilityId, orgId: ctx.orgId } });
    if (!facility) return ok({ error: "Facility not found." }, 404);
    const profile = getProfile(facility.serviceProfileKey);
    const terminology = resolveTerminology(facility.serviceProfileKey, facility.termOverrides);
    const profiles = Object.values(SERVICE_PROFILES).map((p) => ({ key: p.key, name: p.name, description: p.description }));
    return ok({ facility, profile, terminology, profiles });
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
  // Per-facility terminology overrides: empty string removes an override
  termOverrides: z.partialRecord(z.enum(TERMINOLOGY_KEYS as [string, ...string[]]), z.string().max(60)).optional(),
  // Switching the service profile changes terminology defaults and encounter form templates
  serviceProfileKey: z.enum(PROFILE_KEYS as [string, ...string[]]).optional(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth("settings:manage");
    const input = await parseBody(request, patchSchema);
    const facility = await db.facility.findFirst({ where: { id: ctx.facilityId, orgId: ctx.orgId } });
    if (!facility) return ok({ error: "Facility not found." }, 404);

    // Merge terminology overrides into the stored JSON (empty value = clear override)
    let termOverridesJson: string | undefined;
    if (input.termOverrides) {
      let current: Record<string, string> = {};
      try {
        const parsed = JSON.parse(facility.termOverrides ?? "{}") as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed as Record<string, string>;
      } catch {
        current = {};
      }
      for (const [k, v] of Object.entries(input.termOverrides)) {
        if (typeof v !== "string") continue;
        const trimmed = v.trim().slice(0, 60);
        if (trimmed) current[k] = trimmed;
        else delete current[k];
      }
      termOverridesJson = JSON.stringify(current);
    }

    // Profile switch: validate key, keep the facility's catalogue (no re-seed, codes stay unique)
    let profileChanged = false;
    if (input.serviceProfileKey && input.serviceProfileKey !== facility.serviceProfileKey) {
      if (!SERVICE_PROFILES[input.serviceProfileKey]) return ok({ error: "Unknown service profile." }, 400);
      profileChanged = true;
    }

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
        ...(termOverridesJson !== undefined ? { termOverrides: termOverridesJson } : {}),
        ...(profileChanged ? { serviceProfileKey: input.serviceProfileKey } : {}),
      },
    });

    await audit({
      orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
      action: "settings.facility_updated", entityType: "Facility", entityId: facility.id,
      summary: `Facility settings updated${input.logoData ? " (logo uploaded)" : ""}${termOverridesJson ? " (terminology customized)" : ""}${profileChanged ? ` (service profile switched to ${input.serviceProfileKey})` : ""}.`,
    });
    return ok({ facility: updated });
  } catch (error) {
    return fail(error);
  }
}
