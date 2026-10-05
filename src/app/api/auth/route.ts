// Auth API - two-stage facility access + personnel authentication (ADR 0011).
// Single entry, action-dispatched. Every stage is server-verified; the facility
// credential never confers permissions and the staff identity is mandatory.
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { ok, fail, parseBody, AppError } from "@/lib/api";
import {
  createSession, createGateSession, destroySession, destroyGateSession, destroyUserSessions,
  getAuth, getGate, verifyPassword, hashPassword, passwordPolicyError, setActiveFacility,
  accessibleFacilityIds,
} from "@/lib/auth";
import { canAuthenticate } from "@/lib/rbac";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { registerOrganization, registerSchema } from "@/modules/org";
import { resolveTerminology } from "@/lib/service-profiles";

const loginSchema = z.object({
  email: z.string().email().max(120),
  password: z.string().min(1).max(100),
});

const switchFacilitySchema = z.object({ facilityId: z.string().min(5) });

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function findToken(token: string, kind: string) {
  return db.passwordToken.findFirst({ where: { tokenHash: tokenHash(token), kind } });
}

export async function GET() {
  try {
    const ctx = await getAuth();
    if (!ctx) {
      // No staff session - but a facility gate context may exist (personnel screen).
      const gate = await getGate();
      if (gate) {
        const [facility, credential] = await Promise.all([
          db.facility.findFirst({ where: { orgId: gate.orgId }, orderBy: { createdAt: "asc" } }),
          db.facilityCredential.findUnique({ where: { orgId: gate.orgId } }),
        ]);
        return ok({
          authenticated: false,
          gate: {
            orgId: gate.orgId,
            orgName: gate.orgName,
            facilityName: facility?.name ?? gate.orgName,
            logoData: facility?.logoData ?? null,
            credentialEmail: credential?.email ?? null,
            expiresAt: gate.expiresAt.toISOString(),
          },
        });
      }
      return ok({ authenticated: false });
    }

    const allowed = await accessibleFacilityIds(ctx.orgId, ctx.role, ctx.userId);
    const facilities = await db.facility.findMany({
      where: { orgId: ctx.orgId, id: { in: allowed } },
      select: { id: true, name: true, serviceProfileKey: true, type: true },
      orderBy: { createdAt: "asc" },
    });
    const activeFacility = await db.facility.findUnique({ where: { id: ctx.facilityId } });
    const userRow = await db.user.findUnique({
      where: { id: ctx.userId },
      select: { dashboardPrefs: true, photoData: true, firstName: true, lastName: true, staffCode: true },
    });
    return ok({
      authenticated: true,
      user: {
        id: ctx.userId, name: ctx.userName, email: ctx.email, role: ctx.role,
        orgId: ctx.orgId, orgName: ctx.orgName,
        facilityId: ctx.facilityId, facilityName: ctx.facilityName,
        serviceProfileKey: ctx.serviceProfileKey,
        currency: ctx.currency, timezone: ctx.timezone,
        permissions: ctx.permissions,
        status: ctx.status,
        mustChangePassword: ctx.mustChangePassword,
        department: ctx.department,
        serviceLine: ctx.serviceLine,
        staffCode: ctx.staffCode,
        designation: ctx.designation,
        customRoleId: ctx.customRoleId,
        photoData: userRow?.photoData ?? null,
        dashboardPrefs: userRow?.dashboardPrefs ?? null,
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
      // Facility-wide terminology (profile defaults merged with the facility's overrides)
      terminology: resolveTerminology(ctx.serviceProfileKey, activeFacility?.termOverrides ?? null),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody(
      request,
      z.object({
        action: z.enum([
          "register", "facility-login", "staff-login", "logout", "exit-facility",
          "invite-accept", "forgot-password", "reset-password", "change-password",
          "switch-facility", "update-prefs",
        ]),
      }).and(z.record(z.string(), z.unknown()))
    );
    const ip = clientIp(request);

    if (body.action === "register") {
      const input = registerSchema.parse(body);
      const result = await registerOrganization(input);
      await createGateSession(result.orgId);
      await createSession(result.userId, result.orgId);
      await setActiveFacility(result.userId, result.orgId, result.facilityId);
      return ok({ ok: true }, 201);
    }

    // ── Stage 1: facility access gate ──────────────────────────────────────
    if (body.action === "facility-login") {
      const input = loginSchema.parse(body);
      if (!rateLimit(`gate:${ip}:${input.email}`, 30, 5 * 60_000)) {
        throw new AppError(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.");
      }
      const credential = await db.facilityCredential.findUnique({ where: { email: input.email.toLowerCase() } });
      if (!credential || !verifyPassword(input.password, credential.passwordHash)) {
        throw new AppError(401, "invalid_credentials", "Invalid facility email or password.");
      }
      await createGateSession(credential.orgId);
      const org = await db.organization.findUnique({ where: { id: credential.orgId } });
      const facility = await db.facility.findFirst({ where: { orgId: credential.orgId }, orderBy: { createdAt: "asc" } });
      await audit({
        orgId: credential.orgId, facilityId: facility?.id ?? null,
        action: "facility.gate_login", entityType: "FacilityCredential", entityId: credential.id,
        summary: "Facility access gate passed.",
      });
      return ok({
        ok: true,
        facility: {
          orgId: credential.orgId,
          orgName: org?.name ?? "",
          facilityName: facility?.name ?? org?.name ?? "",
          logoData: facility?.logoData ?? null,
        },
      });
    }

    // ── Stage 2: personnel authentication (requires the facility gate) ─────
    if (body.action === "staff-login") {
      const input = loginSchema.parse(body);
      if (!rateLimit(`staff:${ip}:${input.email}`, 30, 5 * 60_000)) {
        throw new AppError(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.");
      }
      const gate = await getGate();
      if (!gate) {
        throw new AppError(401, "gate_required", "Pass the facility access gate before signing in.");
      }
      const user = await db.user.findUnique({ where: { email: input.email.toLowerCase() } });
      const membership = user
        ? await db.membership.findFirst({ where: { userId: user.id, orgId: gate.orgId, active: true } })
        : null;
      if (!user || !membership || !verifyPassword(input.password, user.passwordHash)) {
        if (user && membership) {
          const failed = user.failedLoginCount + 1;
          const lockNow = failed >= 5;
          await db.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount: lockNow ? 0 : failed,
              lockedUntil: lockNow ? new Date(Date.now() + 15 * 60_000) : user.lockedUntil,
              status: lockNow && user.status === "ACTIVE" ? "LOCKED" : user.status,
            },
          });
          if (lockNow) {
            await audit({
              orgId: gate.orgId, actorUserId: user.id, actorLabel: user.name,
              action: "staff.locked", entityType: "User", entityId: user.id,
              summary: "Account locked for 15 minutes after 5 failed sign-in attempts.",
            });
          }
        }
        throw new AppError(401, "invalid_credentials", "Invalid email or password for this facility.");
      }
      // Account state checks (safe messaging: one generic reason per state class).
      const now = new Date();
      if (user.lockedUntil && user.lockedUntil > now) {
        throw new AppError(423, "account_locked", "This account is temporarily locked. Try again later or contact the facility owner.");
      }
      if (user.status === "LOCKED") {
        if (user.lockedUntil && user.lockedUntil <= now) {
          await db.user.update({ where: { id: user.id }, data: { status: "ACTIVE", lockedUntil: null, failedLoginCount: 0 } });
        } else {
          throw new AppError(423, "account_locked", "This account is locked. Contact the facility owner to unlock it.");
        }
      }
      if (!canAuthenticate(user.status)) {
        throw new AppError(403, "account_inactive", "This account is not active. Contact the facility owner.");
      }

      await db.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      await createSession(user.id, gate.orgId);
      const allowed = await accessibleFacilityIds(gate.orgId, membership.role, user.id);
      if (allowed.length > 0) await setActiveFacility(user.id, gate.orgId, allowed[0]);
      await audit({
        orgId: gate.orgId, actorUserId: user.id, actorLabel: user.name,
        action: "staff.login", entityType: "User", entityId: user.id,
        summary: `Staff sign-in (${membership.role}${membership.customRoleId ? " + custom role" : ""}).`,
      });
      return ok({ ok: true, mustChangePassword: user.mustChangePassword });
    }

    // ── Logout: staff session only. The gate stays for the next shift member. ──
    if (body.action === "logout") {
      const ctx = await getAuth();
      if (ctx) {
        await audit({
          orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
          action: "staff.logout", entityType: "User", entityId: ctx.userId,
          summary: "Staff sign-out.",
        });
      }
      await destroySession();
      return ok({ ok: true });
    }

    // ── Exit Facility: full clear for shared computers (spec §31/§32) ──────
    if (body.action === "exit-facility") {
      const ctx = await getAuth();
      if (ctx) {
        await audit({
          orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
          action: "facility.exit", entityType: "User", entityId: ctx.userId,
          summary: "Facility access context fully cleared.",
        });
      }
      await destroySession();
      await destroyGateSession();
      return ok({ ok: true });
    }

    // ── Invitation acceptance: set own password (no gate needed) ───────────
    if (body.action === "invite-accept") {
      const input = z.object({ token: z.string().min(10).max(200), password: z.string().min(1).max(100) }).parse(body);
      const policy = passwordPolicyError(input.password);
      if (policy) throw new AppError(400, "weak_password", policy);
      const record = await findToken(input.token, "INVITE");
      if (!record || record.usedAt || record.expiresAt < new Date()) {
        throw new AppError(400, "invalid_token", "This invitation link is invalid or has expired. Ask the facility owner to resend it.");
      }
      await db.$transaction([
        db.user.update({
          where: { id: record.userId },
          data: { passwordHash: hashPassword(input.password), status: "ACTIVE", mustChangePassword: false, passwordSetAt: new Date(), failedLoginCount: 0, lockedUntil: null },
        }),
        db.passwordToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      ]);
      const user = await db.user.findUnique({ where: { id: record.userId } });
      await audit({
        orgId: record.orgId, actorUserId: record.userId, actorLabel: user?.name ?? null,
        action: "staff.invitation_accepted", entityType: "User", entityId: record.userId,
        summary: "Invitation accepted and personal password set.",
      });
      return ok({ ok: true });
    }

    // ── Forgot password (staff self-service, secure token flow) ────────────
    if (body.action === "forgot-password") {
      const input = z.object({ email: z.string().email().max(120) }).parse(body);
      if (!rateLimit(`forgot:${ip}:${input.email}`, 10, 5 * 60_000)) {
        throw new AppError(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.");
      }
      const gate = await getGate();
      const generic = { ok: true, message: "If that email belongs to this facility, a reset link has been generated." };
      if (!gate) return ok(generic); // never reveal anything without the gate
      const user = await db.user.findFirst({
        where: { email: input.email.toLowerCase(), memberships: { some: { orgId: gate.orgId } } },
      });
      if (!user || !canAuthenticate(user.status)) return ok(generic);
      const token = randomBytes(24).toString("hex");
      await db.passwordToken.create({
        data: {
          orgId: gate.orgId, userId: user.id, kind: "RESET",
          tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 30 * 60_000),
        },
      });
      await audit({
        orgId: gate.orgId, actorUserId: user.id, actorLabel: user.name,
        action: "staff.password_reset_requested", entityType: "User", entityId: user.id,
        summary: "Password reset requested (single-use token issued).",
      });
      // Sandbox has no SMTP: hand back the link once, like the comms console
      // simulation. Production sends this by email and returns nothing (ADR 0011 §6).
      if (process.env.SANDBOX === "1" || process.env.NODE_ENV !== "production") {
        return ok({ ...generic, resetLink: `/?reset=${token}` });
      }
      return ok(generic);
    }

    // ── Reset password with token ──────────────────────────────────────────
    if (body.action === "reset-password") {
      const input = z.object({ token: z.string().min(10).max(200), password: z.string().min(1).max(100) }).parse(body);
      const policy = passwordPolicyError(input.password);
      if (policy) throw new AppError(400, "weak_password", policy);
      const record = await findToken(input.token, "RESET");
      if (!record || record.usedAt || record.expiresAt < new Date()) {
        throw new AppError(400, "invalid_token", "This reset link is invalid or has expired. Please request a new one.");
      }
      await db.$transaction([
        db.user.update({
          where: { id: record.userId },
          data: {
            passwordHash: hashPassword(input.password), mustChangePassword: false,
            passwordSetAt: new Date(), failedLoginCount: 0, lockedUntil: null,
            status: "ACTIVE",
          },
        }),
        db.passwordToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      ]);
      await destroyUserSessions(record.userId); // every old session dies with the password
      const user = await db.user.findUnique({ where: { id: record.userId } });
      await audit({
        orgId: record.orgId, actorUserId: record.userId, actorLabel: user?.name ?? null,
        action: "staff.password_reset_completed", entityType: "User", entityId: record.userId,
        summary: "Password reset completed with a single-use token; all sessions invalidated.",
      });
      return ok({ ok: true });
    }

    // ── Change password (self-service; also clears mustChangePassword) ─────
    if (body.action === "change-password") {
      const ctx = await getAuth();
      if (!ctx) throw new AppError(401, "unauthorized", "Authentication required.");
      const input = z.object({ currentPassword: z.string().min(1).max(100), newPassword: z.string().min(1).max(100) }).parse(body);
      const user = await db.user.findUnique({ where: { id: ctx.userId } });
      if (!user || !verifyPassword(input.currentPassword, user.passwordHash)) {
        throw new AppError(400, "invalid_credentials", "Your current password is incorrect.");
      }
      const policy = passwordPolicyError(input.newPassword);
      if (policy) throw new AppError(400, "weak_password", policy);
      await db.user.update({
        where: { id: ctx.userId },
        data: { passwordHash: hashPassword(input.newPassword), mustChangePassword: false, passwordSetAt: new Date() },
      });
      // Keep this device's session; kill every other one.
      await db.session.deleteMany({ where: { userId: ctx.userId, id: { not: ctx.sessionId } } });
      await audit({
        orgId: ctx.orgId, actorUserId: ctx.userId, actorLabel: ctx.userName,
        action: "staff.password_changed", entityType: "User", entityId: ctx.userId,
        summary: "Password changed by the account owner; other sessions signed out.",
      });
      return ok({ ok: true });
    }

    if (body.action === "switch-facility") {
      const ctx = await getAuth();
      if (!ctx) throw new AppError(401, "unauthorized", "Authentication required.");
      const input = switchFacilitySchema.parse(body);
      const success = await setActiveFacility(ctx.userId, ctx.orgId, input.facilityId);
      if (!success) throw new AppError(403, "forbidden", "You are not assigned to that facility.");
      return ok({ ok: true });
    }

    // ── Dashboard personalization (self-service, within permitted widgets) ──
    if (body.action === "update-prefs") {
      const ctx = await getAuth();
      if (!ctx) throw new AppError(401, "unauthorized", "Authentication required.");
      const input = z.object({ dashboardPrefs: z.string().max(4000) }).parse(body);
      JSON.parse(input.dashboardPrefs); // must be valid JSON
      await db.user.update({ where: { id: ctx.userId }, data: { dashboardPrefs: input.dashboardPrefs } });
      return ok({ ok: true });
    }

    throw new AppError(400, "bad_request", "Unknown action.");
  } catch (error) {
    return fail(error);
  }
}
