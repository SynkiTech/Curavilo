// Auth API — register / login / logout / session (single entry, action-dispatched)
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, parseBody, AppError } from "@/lib/api";
import { createSession, destroySession, getAuth, verifyPassword, setActiveFacility } from "@/lib/auth";
import { registerOrganization, registerSchema } from "@/modules/org";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(100),
});

const switchFacilitySchema = z.object({ facilityId: z.string().min(5) });

export async function GET() {
  try {
    const ctx = await getAuth();
    if (!ctx) return ok({ authenticated: false });
    const facilities = await db.facility.findMany({
      where: { orgId: ctx.orgId },
      select: { id: true, name: true, serviceProfileKey: true, type: true },
      orderBy: { createdAt: "asc" },
    });
    const activeFacility = await db.facility.findUnique({ where: { id: ctx.facilityId } });
    return ok({
      authenticated: true,
      user: {
        id: ctx.userId, name: ctx.userName, email: ctx.email, role: ctx.role,
        orgId: ctx.orgId, orgName: ctx.orgName,
        facilityId: ctx.facilityId, facilityName: ctx.facilityName,
        serviceProfileKey: ctx.serviceProfileKey,
        currency: ctx.currency, timezone: ctx.timezone,
        permissions: ctx.permissions,
      },
      facilities,
      branding: {
        logoData: activeFacility?.logoData ?? null,
        address: activeFacility?.address ?? null,
        phone: activeFacility?.phone ?? null,
        email: activeFacility?.email ?? null,
        reportFooter: activeFacility?.reportFooter ?? null,
        receiptFooter: activeFacility?.receiptFooter ?? null,
      },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody(request, z.object({ action: z.enum(["register", "login", "logout", "switch-facility"]) }).and(z.record(z.string(), z.unknown())));

    if (body.action === "register") {
      const input = registerSchema.parse(body);
      const result = await registerOrganization(input);
      await createSession(result.userId, result.orgId);
      await setActiveFacility(result.userId, result.orgId, result.facilityId);
      return ok({ ok: true }, 201);
    }

    if (body.action === "login") {
      const input = loginSchema.parse(body);
      const user = await db.user.findUnique({ where: { email: input.email.toLowerCase() } });
      if (!user || !verifyPassword(input.password, user.passwordHash)) {
        throw new AppError(401, "invalid_credentials", "Invalid email or password.");
      }
      const membership = await db.membership.findFirst({ where: { userId: user.id, active: true }, orderBy: { createdAt: "asc" } });
      await createSession(user.id, membership?.orgId ?? null);
      return ok({ ok: true });
    }

    if (body.action === "logout") {
      await destroySession();
      return ok({ ok: true });
    }

    // switch-facility
    const ctx = await getAuth();
    if (!ctx) throw new AppError(401, "unauthorized", "Authentication required.");
    const input = switchFacilitySchema.parse(body);
    const success = await setActiveFacility(ctx.userId, ctx.orgId, input.facilityId);
    if (!success) throw new AppError(403, "forbidden", "Facility does not belong to your organization.");
    return ok({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
