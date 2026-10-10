// Staff accounts API (ADR 0011) - personnel identity administration.
// List/create/update staff users, account status lifecycle, owner password resets,
// per-user permission overrides. Role/permission changes require roles:manage
// (platform-protected, OWNER by default). All writes are audited.
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { ok, fail, requireAuth, parseBody, parseQuery, AppError, NotFound, BadRequest } from "@/lib/api";
import { hashPassword, passwordPolicyError, destroyUserSessions } from "@/lib/auth";
import { PROTECTED_PERMISSIONS, isBuiltinRole } from "@/lib/rbac";
import { audit } from "@/lib/audit";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const listQuery = z.object({
  q: z.string().max(80).optional(),
  role: z.string().max(30).optional(),
  status: z.string().max(15).optional(),
  departmentId: z.string().max(30).optional(),
  userId: z.string().max(30).optional(),
});

const userSelect = {
  id: true, email: true, name: true, status: true, firstName: true, lastName: true,
  phone: true, staffCode: true, designation: true, employmentStatus: true,
  serviceLine: true, photoData: true, departmentId: true, mustChangePassword: true,
  lockedUntil: true, lastLoginAt: true, createdAt: true,
} as const;

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("staff:read");
    const q = parseQuery(request, listQuery);

    if (q.userId) {
      // Detail view: profile + permissions + login history + recent activity.
      const target = await db.user.findFirst({
        where: { id: q.userId, memberships: { some: { orgId: ctx.orgId } } },
        select: userSelect,
      });
      if (!target) throw NotFound("Staff member not found.");
      const membership = await db.membership.findFirst({
        where: { userId: target.id, orgId: ctx.orgId, active: true },
        include: { customRole: true },
      });
      const [overrides, facilityIds, departments, history, activity, openTasks] = await Promise.all([
        db.permissionOverride.findMany({ where: { userId: target.id } }),
        db.facilityMembership.findMany({ where: { userId: target.id }, select: { facilityId: true } }),
        db.department.findMany({ where: { orgId: ctx.orgId, active: true }, orderBy: { name: "asc" } }),
        db.auditEvent.findMany({
          where: { orgId: ctx.orgId, actorUserId: target.id, action: { in: ["staff.login", "staff.logout", "facility.exit", "staff.locked"] } },
          orderBy: { createdAt: "desc" }, take: 15,
        }),
        db.auditEvent.findMany({
          where: { orgId: ctx.orgId, actorUserId: target.id },
          orderBy: { createdAt: "desc" }, take: 20,
        }),
        db.task.findMany({
          where: { orgId: ctx.orgId, status: { not: "COMPLETED" }, OR: [{ role: membership?.role }, { role: null }] },
          orderBy: { createdAt: "desc" }, take: 8,
        }),
      ]);
      const facilities = await db.facility.findMany({
        where: { orgId: ctx.orgId, id: { in: facilityIds.map((f) => f.facilityId) } },
        select: { id: true, name: true },
      });
      return ok({
        staff: target,
        membership: membership
          ? { role: membership.role, customRoleId: membership.customRoleId, customRole: membership.customRole ? { id: membership.customRole.id, name: membership.customRole.name, permissions: JSON.parse(membership.customRole.permissions || "[]") } : null }
          : null,
        overrides, facilities, departments, history, activity, openTasks,
      });
    }

    const memberships = await db.membership.findMany({
      where: { orgId: ctx.orgId, active: true },
      include: {
        user: {
          select: { ...userSelect, department: { select: { name: true } }, facilityMemberships: { select: { facilityId: true } } },
        },
        customRole: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    let rows = memberships.map((m) => ({
      id: m.user.id,
      email: m.user.email,
      name: m.user.name,
      status: m.user.status,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      phone: m.user.phone,
      staffCode: m.user.staffCode,
      designation: m.user.designation,
      employmentStatus: m.user.employmentStatus,
      serviceLine: m.user.serviceLine,
      department: m.user.department?.name ?? null,
      departmentId: m.user.departmentId,
      photoData: m.user.photoData,
      mustChangePassword: m.user.mustChangePassword,
      lockedUntil: m.user.lockedUntil,
      lastLoginAt: m.user.lastLoginAt,
      createdAt: m.user.createdAt,
      role: m.role,
      customRoleId: m.customRoleId,
      customRoleName: m.customRole?.name ?? null,
      facilityIds: m.user.facilityMemberships.map((f) => f.facilityId),
    }));

    if (q.q) {
      const needle = q.q.toLowerCase();
      rows = rows.filter((r) =>
        r.name.toLowerCase().includes(needle) ||
        r.email.toLowerCase().includes(needle) ||
        (r.staffCode ?? "").toLowerCase().includes(needle)
      );
    }
    if (q.role) rows = rows.filter((r) => r.role === q.role || r.customRoleId === q.role);
    if (q.status) rows = rows.filter((r) => r.status === q.status);
    if (q.departmentId) rows = rows.filter((r) => r.departmentId === q.departmentId);

    const facilityList = await db.facility.findMany({
      where: { orgId: ctx.orgId },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    return ok({ staff: rows, facilities: facilityList });
  } catch (error) {
    return fail(error);
  }
}

const namePart = z.string().min(1).max(60);
const createSchema = z.object({
  firstName: namePart,
  lastName: namePart,
  email: z.string().email().max(120),
  phone: z.string().max(30).optional().nullable().or(z.literal("")),
  staffCode: z.string().max(30).optional().nullable().or(z.literal("")),
  designation: z.string().max(60).optional().nullable().or(z.literal("")),
  employmentStatus: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "LOCUM"]).optional().nullable(),
  role: z.string().max(30),
  customRoleId: z.string().max(30).optional().nullable(),
  departmentId: z.string().max(30).optional().nullable(),
  serviceLine: z.string().max(40).optional().nullable(),
  facilityIds: z.array(z.string().min(5)).max(20).default([]),
  access: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("INVITE") }),
    z.object({ mode: z.literal("TEMP_PASSWORD"), tempPassword: z.string().min(1).max(100) }),
  ]),
  photoData: z.string().max(400_000).optional().nullable().refine((v) => !v || /^data:image\/(png|jpeg|jpg|webp);base64,/.test(v), "Photo must be a PNG, JPEG or WebP data URL"),
});

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("UPDATE"),
    userId: z.string().min(5),
    firstName: namePart.optional(),
    lastName: namePart.optional(),
    phone: z.string().max(30).optional().nullable(),
    staffCode: z.string().max(30).optional().nullable(),
    designation: z.string().max(60).optional().nullable(),
    employmentStatus: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "LOCUM"]).optional().nullable(),
    departmentId: z.string().max(30).optional().nullable(),
    serviceLine: z.string().max(40).optional().nullable(),
    photoData: z.string().max(400_000).optional().nullable().refine((v) => !v || /^data:image\/(png|jpeg|jpg|webp);base64,/.test(v), "Photo must be a PNG, JPEG or WebP data URL"),
    facilityIds: z.array(z.string().min(5)).min(1).max(20).optional(),
  }),
  z.object({
    action: z.literal("SET_ROLE"),
    userId: z.string().min(5),
    role: z.string().max(30).optional(),
    customRoleId: z.string().max(30).optional().nullable(),
  }),
  z.object({
    action: z.literal("SET_STATUS"),
    userId: z.string().min(5),
    value: z.enum(["ACTIVATE", "DEACTIVATE", "SUSPEND", "TERMINATE", "UNLOCK"]),
    reason: z.string().max(200).optional(),
  }),
  z.object({
    action: z.literal("RESET_PASSWORD"),
    userId: z.string().min(5),
    tempPassword: z.string().min(1).max(100).optional(),
  }),
  z.object({
    action: z.literal("SET_PERMISSIONS"),
    userId: z.string().min(5),
    overrides: z.array(z.object({
      permission: z.string().max(40),
      effect: z.enum(["GRANT", "DENY"]).nullable(),
    })).max(60),
  }),
]);

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("staff:manage");
    const input = await parseBody(request, createSchema);
    const email = input.email.toLowerCase();

    if (!isBuiltinRole(input.role) && !input.customRoleId) {
      throw BadRequest("Unknown built-in role. Use a custom role id for owner-defined roles.");
    }
    if (input.role === "OWNER") {
      throw new AppError(403, "forbidden", "The OWNER role belongs to the organization owner account only.");
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      const inOrg = await db.membership.findFirst({ where: { userId: existing.id, orgId: ctx.orgId, active: true } });
      throw new AppError(409, inOrg ? "already_staff" : "email_taken",
        inOrg ? "This person already has an account in your facility." : "An account with this email already exists on another workspace.");
    }

    // Empty assignment defaults to every facility in the organization.
    const requestedFacilities = input.facilityIds.length > 0
      ? input.facilityIds
      : (await db.facility.findMany({ where: { orgId: ctx.orgId }, select: { id: true } })).map((f) => f.id);
    const allowedFacilities = await db.facility.findMany({
      where: { orgId: ctx.orgId, id: { in: requestedFacilities } }, select: { id: true },
    });
    if (allowedFacilities.length !== requestedFacilities.length) {
      throw BadRequest("One of the selected facilities does not belong to your organization.");
    }

    if (input.customRoleId) {
      const cr = await db.customRole.findFirst({ where: { id: input.customRoleId, orgId: ctx.orgId, active: true } });
      if (!cr) throw BadRequest("Custom role not found or inactive.");
    }

    const tempPassword = input.access.mode === "TEMP_PASSWORD" ? input.access.tempPassword : null;
    if (tempPassword) {
      const policy = passwordPolicyError(tempPassword);
      if (policy) throw new AppError(400, "weak_password", `Temporary password: ${policy}`);
    }

    const displayName = `${input.firstName} ${input.lastName}`.trim();
    const inviteToken = input.access.mode === "INVITE" ? randomBytes(24).toString("hex") : null;

    const user = await db.user.create({
      data: {
        email,
        name: displayName,
        passwordHash: hashPassword(tempPassword ?? randomBytes(24).toString("hex")), // random placeholder when invited
        status: input.access.mode === "INVITE" ? "INVITED" : "ACTIVE",
        mustChangePassword: input.access.mode === "TEMP_PASSWORD",
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone || null,
        staffCode: input.staffCode || null,
        designation: input.designation || null,
        employmentStatus: input.employmentStatus ?? null,
        serviceLine: input.serviceLine || null,
        departmentId: input.departmentId || null,
        photoData: input.photoData || null,
        memberships: { create: { orgId: ctx.orgId, role: input.role, customRoleId: input.customRoleId ?? null } },
        facilityMemberships: { create: requestedFacilities.map((fid) => ({ facilityId: fid })) },
        ...(inviteToken
          ? { passwordTokens: { create: { orgId: ctx.orgId, kind: "INVITE", tokenHash: tokenHash(inviteToken), expiresAt: new Date(Date.now() + 7 * 24 * 3600_000) } } }
          : {}),
      },
    });

    await audit({
      orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
      action: input.access.mode === "INVITE" ? "staff.invited" : "staff.created",
      entityType: "User", entityId: user.id,
      summary: `Staff account created for ${displayName} (${input.role}${input.customRoleId ? " + custom role" : ""}, ${input.access.mode === "INVITE" ? "invitation" : "temporary password"}).`,
    });
    await audit({
      orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
      action: "staff.role_assigned", entityType: "User", entityId: user.id,
      summary: `Role ${input.role} assigned to ${displayName}.`,
    });

    // One-time secrets: never stored in plaintext, never shown again.
    const sandbox = process.env.SANDBOX === "1" || process.env.NODE_ENV === "development";
    return ok({
      staff: { id: user.id, name: user.name, email: user.email, status: user.status },
      inviteLink: inviteToken && sandbox ? `/?invite=${inviteToken}` : null,
      tempPassword: tempPassword && sandbox ? tempPassword : null,
    }, 201);
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth("staff:manage");
    const input = await parseBody(request, patchSchema);

    const membership = await db.membership.findFirst({
      where: { userId: input.userId, orgId: ctx.orgId, active: true },
      include: { user: { select: userSelect } },
    });
    if (!membership || !membership.user) throw NotFound("Staff member not found in your facility.");
    const target = membership.user;
    const targetIsOwner = membership.role === "OWNER";
    const self = input.userId === ctx.userId;

    // Role + permission administration requires the protected roles:manage permission.
    const needsRolesManage = input.action === "SET_ROLE" || input.action === "SET_PERMISSIONS";
    if (needsRolesManage && !ctx.permissions.includes("roles:manage")) {
      throw new AppError(403, "forbidden", "Role and permission management is restricted to the facility owner.");
    }
    if (targetIsOwner && input.action === "SET_STATUS") {
      throw new AppError(403, "forbidden", "The owner account cannot be deactivated.");
    }
    if (targetIsOwner && input.action === "SET_ROLE") {
      throw new AppError(403, "forbidden", "The owner role cannot be changed.");
    }
    if (self && input.action === "SET_STATUS") {
      throw new AppError(403, "forbidden", "You cannot change your own account status.");
    }

    switch (input.action) {
      case "UPDATE": {
        const firstName = input.firstName ?? target.firstName ?? target.name.split(" ")[0] ?? "";
        const lastName = input.lastName ?? target.lastName ?? target.name.split(" ").slice(1).join(" ") ?? "";
        const data: Record<string, unknown> = {
          firstName, lastName,
          name: `${firstName} ${lastName}`.trim(),
        };
        if (input.phone !== undefined) data.phone = input.phone || null;
        if (input.staffCode !== undefined) data.staffCode = input.staffCode || null;
        if (input.designation !== undefined) data.designation = input.designation || null;
        if (input.employmentStatus !== undefined) data.employmentStatus = input.employmentStatus;
        if (input.departmentId !== undefined) data.departmentId = input.departmentId || null;
        if (input.serviceLine !== undefined) data.serviceLine = input.serviceLine || null;
        if (input.photoData !== undefined) data.photoData = input.photoData || null;
        await db.user.update({ where: { id: target.id }, data });
        if (input.facilityIds) {
          const allowed = await db.facility.findMany({ where: { orgId: ctx.orgId, id: { in: input.facilityIds } }, select: { id: true } });
          if (allowed.length !== input.facilityIds.length) throw BadRequest("One of the selected facilities does not belong to your organization.");
          await db.$transaction([
            db.facilityMembership.deleteMany({ where: { userId: target.id } }),
            db.facilityMembership.createMany({ data: input.facilityIds.map((fid) => ({ userId: target.id, facilityId: fid })) }),
          ]);
          await destroyUserSessions(target.id); // facility scope changed - re-login
        }
        await audit({
          orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
          action: "staff.updated", entityType: "User", entityId: target.id,
          summary: `Profile updated for ${target.name}${input.facilityIds ? " including facility assignments" : ""}.`,
        });
        return ok({ ok: true });
      }

      case "SET_ROLE": {
        if (input.role !== undefined) {
          if (!isBuiltinRole(input.role)) throw BadRequest("Unknown built-in role.");
          if (input.role === "OWNER") throw new AppError(403, "forbidden", "The OWNER role cannot be granted to another account.");
        }
        if (input.customRoleId) {
          const cr = await db.customRole.findFirst({ where: { id: input.customRoleId, orgId: ctx.orgId, active: true } });
          if (!cr) throw BadRequest("Custom role not found or inactive.");
        }
        await db.membership.update({
          where: { id: membership.id },
          data: { role: input.role ?? membership.role, customRoleId: input.customRoleId ?? null },
        });
        await destroyUserSessions(target.id); // permissions changed - re-login
        await audit({
          orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
          action: "staff.role_changed", entityType: "User", entityId: target.id,
          summary: `Role changed for ${target.name}: ${input.role ?? membership.role}${input.customRoleId ? " (custom role)" : ""}.`,
        });
        return ok({ ok: true });
      }

      case "SET_STATUS": {
        const statusMap: Record<string, string> = {
          ACTIVATE: "ACTIVE", DEACTIVATE: "INACTIVE", SUSPEND: "SUSPENDED", TERMINATE: "TERMINATED",
        };
        if (input.value === "UNLOCK") {
          await db.user.update({
            where: { id: target.id },
            data: { lockedUntil: null, failedLoginCount: 0, status: target.status === "LOCKED" ? "ACTIVE" : target.status },
          });
          await audit({
            orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
            action: "staff.unlocked", entityType: "User", entityId: target.id,
            summary: `Account unlocked for ${target.name}.`,
          });
          return ok({ ok: true });
        }
        const newStatus = statusMap[input.value];
        await db.user.update({ where: { id: target.id }, data: { status: newStatus, lockedUntil: null, failedLoginCount: 0 } });
        if (newStatus !== "ACTIVE") await destroyUserSessions(target.id); // old sessions die immediately
        await audit({
          orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
          action: newStatus === "ACTIVE" ? "staff.activated" : "staff.deactivated",
          entityType: "User", entityId: target.id,
          summary: `Account status for ${target.name} set to ${newStatus}${input.reason ? ` - ${input.reason}` : ""}. Sessions invalidated.`,
        });
        return ok({ ok: true });
      }

      case "RESET_PASSWORD": {
        if (!["ACTIVE", "INVITED", "LOCKED"].includes(target.status)) {
          throw BadRequest("Reactivate the account before resetting its password.");
        }
        const temp = input.tempPassword ?? `Cu-${randomBytes(4).toString("hex")}-24`;
        const policy = passwordPolicyError(temp);
        if (policy) throw new AppError(400, "weak_password", `Temporary password: ${policy}`);
        await db.user.update({
          where: { id: target.id },
          data: {
            passwordHash: hashPassword(temp), mustChangePassword: true, passwordSetAt: new Date(),
            failedLoginCount: 0, lockedUntil: null,
            status: target.status === "LOCKED" ? "ACTIVE" : target.status,
          },
        });
        await destroyUserSessions(target.id);
        await audit({
          orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
          action: "staff.password_reset_by_owner", entityType: "User", entityId: target.id,
          summary: `Password reset by the owner for ${target.name}; a temporary password was issued (never logged).`,
        });
        const sandbox = process.env.SANDBOX === "1" || process.env.NODE_ENV === "development";
        return ok({ ok: true, tempPassword: sandbox ? temp : null });
      }

      case "SET_PERMISSIONS": {
        // Protected permissions are stripped server-side: no escalation path to OWNER powers.
        const clean = input.overrides.filter((o) => !PROTECTED_PERMISSIONS.has(o.permission));
        await db.$transaction([
          db.permissionOverride.deleteMany({ where: { userId: target.id } }),
          db.permissionOverride.createMany({
            data: clean
              .filter((o) => o.effect !== null)
              .map((o) => ({ orgId: ctx.orgId, userId: target.id, permission: o.permission, effect: o.effect as string })),
          }),
        ]);
        await destroyUserSessions(target.id);
        await audit({
          orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
          action: "staff.permission_changed", entityType: "User", entityId: target.id,
          summary: `Permission overrides updated for ${target.name} (${clean.length} entries, protected permissions excluded).`,
        });
        return ok({ ok: true });
      }
    }
  } catch (error) {
    return fail(error);
  }
}
