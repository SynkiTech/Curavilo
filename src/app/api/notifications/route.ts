// Notifications API - the signed-in staff member's inbox.
// Delivers AI-relayed staff messages (send_staff_message) and system alerts.
// Every authenticated user can read ONLY their own inbox: rows addressed to
// their userId plus rows addressed to their platform role (userId = null).
import { z } from "zod";
import { ok, fail, parseBody, requireAuth } from "@/lib/api";
import { db } from "@/lib/db";

function inboxWhere(orgId: string, userId: string, role: string) {
  return {
    orgId,
    OR: [{ userId }, { userId: null, role }],
  };
}

export async function GET() {
  try {
    const ctx = await requireAuth();
    const where = inboxWhere(ctx.orgId, ctx.userId, ctx.role);
    const [items, unread] = await Promise.all([
      db.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 25 }),
      db.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return ok({
      notifications: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
      })),
      unread,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth();
    const body = await parseBody(
      request,
      z.object({
        action: z.enum(["MARK_READ", "MARK_ALL_READ"]),
        id: z.string().min(5).max(40).optional(),
      })
    );
    const where = inboxWhere(ctx.orgId, ctx.userId, ctx.role);
    if (body.action === "MARK_READ") {
      if (!body.id) return ok({ error: "id is required for MARK_READ." }, 400);
      await db.notification.updateMany({
        where: { ...where, id: body.id, readAt: null },
        data: { readAt: new Date() },
      });
    } else {
      await db.notification.updateMany({
        where: { ...where, readAt: null },
        data: { readAt: new Date() },
      });
    }
    return ok({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
