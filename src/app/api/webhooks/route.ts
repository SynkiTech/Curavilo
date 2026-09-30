// Webhooks API - endpoint registry + delivery log (spec §134, §140)
import { z } from "zod";
import { ok, fail, parseBody, requireAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { createEndpoint, listEndpoints, toggleEndpoint, deleteEndpoint } from "@/modules/webhooks";

export async function GET() {
  try {
    const ctx = await requireAuth("settings:manage");
    const endpoints = await listEndpoints(ctx.orgId);
    const deliveries = await db.webhookDelivery.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, endpointId: true, eventType: true, status: true, attempts: true, responseStatus: true, lastError: true, createdAt: true, deliveredAt: true },
    });
    return ok({ endpoints, deliveries });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("settings:manage");
    const body = await parseBody(request, z.object({
      action: z.enum(["CREATE", "TOGGLE", "DELETE"]),
      url: z.string().url().max(500).optional(),
      events: z.array(z.string().min(2).max(40)).min(1).max(12).optional(),
      secret: z.string().min(16).max(200).optional(),
      endpointId: z.string().min(5).optional(),
    }));
    if (body.action === "CREATE") {
      if (!body.url || !body.events) return ok({ error: "url and events are required." }, 400);
      const ep = await createEndpoint(ctx, { url: body.url, events: body.events, secret: body.secret });
      return ok({ endpoint: { id: ep.id, key: ep.key, url: ep.url, events: ep.events, active: ep.active }, secret: ep.secret }, 201);
    }
    if (!body.endpointId) return ok({ error: "endpointId is required." }, 400);
    if (body.action === "TOGGLE") return ok({ endpoint: await toggleEndpoint(ctx.orgId, body.endpointId) });
    return ok(await deleteEndpoint(ctx.orgId, body.endpointId));
  } catch (error) {
    return fail(error);
  }
}
