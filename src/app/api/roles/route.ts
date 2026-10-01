// Roles API (ADR 0011) - built-in role catalogue + owner-defined custom roles.
// Custom roles can pick any permission except PROTECTED_PERMISSIONS, which are
// stripped server-side so no custom role can escalate to owner powers.
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, requireAuth, parseBody, parseQuery, BadRequest, NotFound } from "@/lib/api";
import { PERMISSIONS, PROTECTED_PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/rbac";
import { audit } from "@/lib/audit";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "role";
}

export async function GET() {
  try {
    const ctx = await requireAuth("staff:read");
    const custom = await db.customRole.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { memberships: true } } },
    });
    return ok({
      permissions: PERMISSIONS,
      protectedPermissions: [...PROTECTED_PERMISSIONS],
      builtin: Object.entries(ROLE_PERMISSIONS).map(([key, perms]) => ({ key, permissions: perms })),
      custom: custom.map((c) => ({
        id: c.id, name: c.name, key: c.key, active: c.active,
        permissions: JSON.parse(c.permissions || "[]") as string[],
        memberCount: c._count.memberships,
      })),
    });
  } catch (error) {
    return fail(error);
  }
}

const upsert = z.object({
  name: z.string().min(2).max(60),
  permissions: z.array(z.string().max(40)).max(60),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("roles:manage");
    const input = await parseBody(request, upsert);
    // Protected permissions never enter a custom role.
    const perms = [...new Set(input.permissions.filter((p) => (PERMISSIONS as readonly string[]).includes(p) && !PROTECTED_PERMISSIONS.has(p)))];
    const base = slugify(input.name);
    const exists = await db.customRole.findFirst({ where: { orgId: ctx.orgId, key: base } });
    const key = exists ? `${base}-${Date.now().toString(36)}` : base;
    const role = await db.customRole.create({
      data: { orgId: ctx.orgId, name: input.name, key, permissions: JSON.stringify(perms) },
    });
    await audit({
      orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
      action: "staff.role_created", entityType: "CustomRole", entityId: role.id,
      summary: `Custom role "${role.name}" created with ${perms.length} permissions (protected permissions excluded).`,
    });
    return ok({ role: { id: role.id, name: role.name, key: role.key, permissions: perms, active: role.active, memberCount: 0 } }, 201);
  } catch (error) {
    return fail(error);
  }
}

const patchSchema = z.object({
  id: z.string().min(5),
  name: z.string().min(2).max(60).optional(),
  permissions: z.array(z.string().max(40)).max(60).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth("roles:manage");
    const input = await parseBody(request, patchSchema);
    const role = await db.customRole.findFirst({ where: { id: input.id, orgId: ctx.orgId } });
    if (!role) throw NotFound("Custom role not found.");
    const data: Record<string, unknown> = {};
    if (input.name) data.name = input.name;
    if (input.active !== undefined) data.active = input.active;
    if (input.permissions) {
      data.permissions = JSON.stringify([...new Set(input.permissions.filter((p) => (PERMISSIONS as readonly string[]).includes(p) && !PROTECTED_PERMISSIONS.has(p)))]);
    }
    await db.customRole.update({ where: { id: role.id }, data });
    if (input.permissions || input.active === false) {
      // Permission set changed: force re-login so stale sessions cannot keep old powers.
      const members = await db.membership.findMany({ where: { customRoleId: role.id }, select: { userId: true } });
      for (const m of members) await db.session.deleteMany({ where: { userId: m.userId } });
    }
    await audit({
      orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
      action: "staff.role_changed", entityType: "CustomRole", entityId: role.id,
      summary: `Custom role "${role.name}" updated${input.active === false ? " and deactivated" : ""}. Member sessions invalidated.`,
    });
    return ok({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireAuth("roles:manage");
    const { id } = parseQuery(request, z.object({ id: z.string().min(5) }));
    const role = await db.customRole.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!role) throw NotFound("Custom role not found.");
    const inUse = await db.membership.count({ where: { customRoleId: role.id, active: true } });
    if (inUse > 0) throw BadRequest(`This role is assigned to ${inUse} staff member(s). Reassign them first.`);
    await db.customRole.delete({ where: { id: role.id } });
    await audit({
      orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
      action: "staff.role_deleted", entityType: "CustomRole", entityId: role.id,
      summary: `Custom role "${role.name}" deleted.`,
    });
    return ok({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
