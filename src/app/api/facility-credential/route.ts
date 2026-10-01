// Facility access credential API (ADR 0011) - OWNER-only management of the
// workspace gate credential. The password is stored hashed (scrypt) and is
// never returned, logged or echoed. Changing it does not affect staff accounts.
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, requireAuth, parseBody, NotFound, BadRequest } from "@/lib/api";
import { hashPassword, passwordPolicyError } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function GET() {
  try {
    const ctx = await requireAuth("org:manage");
    const credential = await db.facilityCredential.findUnique({
      where: { orgId: ctx.orgId },
    });
    if (!credential) throw NotFound("No facility credential exists yet.");
    return ok({ credentialEmail: credential.email, updatedAt: credential.updatedAt });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth("org:manage");
    const input = await parseBody(
      request,
      z.object({
        email: z.string().email().max(120).optional(),
        password: z.string().min(1).max(100).optional(),
      })
    );
    const existing = await db.facilityCredential.findUnique({ where: { orgId: ctx.orgId } });
    if (!existing) throw NotFound("No facility credential exists yet.");

    if (input.email && input.email.toLowerCase() !== existing.email) {
      const clash = await db.facilityCredential.findUnique({ where: { email: input.email.toLowerCase() } });
      if (clash) throw BadRequest("That email is already used by another facility credential.");
    }
    if (input.password) {
      const policy = passwordPolicyError(input.password);
      if (policy) throw BadRequest(policy);
    }

    await db.facilityCredential.update({
      where: { orgId: ctx.orgId },
      data: {
        ...(input.email ? { email: input.email.toLowerCase() } : {}),
        ...(input.password ? { passwordHash: hashPassword(input.password), updatedById: ctx.userId } : {}),
      },
    });

    await audit({
      orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
      action: "facility.credential_changed", entityType: "FacilityCredential", entityId: ctx.orgId,
      summary: `Facility access credential updated${input.email ? " (new gate email)" : ""}${input.password ? " (new gate password)" : ""}.`,
    });
    return ok({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
