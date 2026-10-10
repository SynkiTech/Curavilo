// Audit API - append-only event list (audit:read only) + document print events
import { ok, fail, requireAuth, parseBody, parseQuery } from "@/lib/api";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const query = z.object({
  action: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("audit:read");
    const q = parseQuery(request, query);
    const events = await db.auditEvent.findMany({
      where: { orgId: ctx.orgId, ...(q.action ? { action: { contains: q.action } } : {}) },
      orderBy: { createdAt: "desc" },
      take: q.limit ?? 100,
    });
    return ok({ events });
  } catch (error) {
    return fail(error);
  }
}

const printLogSchema = z.object({
  event: z.literal("document.printed"),
  docNumber: z.string().min(3).max(60),
  docType: z.string().max(40).default("DOCUMENT"),
  printProfile: z.string().max(30).default("A4_STANDARD"),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth();
    // Print events are client-reported; cap volume so the audit trail cannot be
    // flooded, and keep actor identity server-derived (never client-supplied).
    if (!rateLimit(`audit:${clientIp(request)}:${ctx.userId}`, 60, 60_000)) {
      return ok({ error: "Too many print events. Try again shortly." }, 429);
    }
    const input = await parseBody(request, printLogSchema);
    await audit({
      orgId: ctx.orgId,
      facilityId: ctx.facilityId,
      actorUserId: ctx.userId,
      actorLabel: ctx.userName,
      action: input.event,
      entityType: input.docType,
      entityId: input.docNumber,
      summary: `Printed ${input.docType} ${input.docNumber} (profile ${input.printProfile}).`,
      metadata: { printProfile: input.printProfile },
    });
    return ok({ ok: true }, 201);
  } catch (error) {
    return fail(error);
  }
}
