// Diagnostics API - lab + imaging orders lifecycle (spec §137)
import { z } from "zod";
import { ok, fail, parseBody, parseQuery, requireAuth } from "@/lib/api";
import {
  createOrder, collectSpecimen, enterResults, verifyOrder, releaseOrder, cancelOrder,
  listOrders, getOrder, orderSchema, resultSchema,
} from "@/modules/diagnostics";

const query = z.object({
  kind: z.enum(["LAB", "IMAGING"]).optional(),
  status: z.string().max(30).optional(),
  patientId: z.string().min(5).optional(),
  id: z.string().min(5).optional(),
});

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("lab:operate");
    const q = parseQuery(request, query);
    if (q.id) return ok({ order: await getOrder(ctx, q.id) });
    return ok({ orders: await listOrders(ctx, q) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("lab:operate");
    const body = await parseBody(request, z.object({
      action: z.enum(["ORDER", "COLLECT", "RESULTS", "VERIFY", "RELEASE", "CANCEL"]),
      orderId: z.string().min(5).optional(),
      order: orderSchema.optional(),
      results: resultSchema.optional(),
      site: z.string().max(120).optional(),
      reason: z.string().max(200).optional(),
    }));
    switch (body.action) {
      case "ORDER": {
        if (!body.order) return ok({ error: "order is required." }, 400);
        return ok({ order: await createOrder(ctx, body.order) }, 201);
      }
      case "COLLECT": {
        if (!body.orderId) return ok({ error: "orderId is required." }, 400);
        return ok({ order: await collectSpecimen(ctx, body.orderId, { site: body.site }) });
      }
      case "RESULTS": {
        if (!body.orderId || !body.results) return ok({ error: "orderId and results are required." }, 400);
        return ok({ order: await enterResults(ctx, body.orderId, body.results) });
      }
      case "VERIFY": {
        if (!body.orderId) return ok({ error: "orderId is required." }, 400);
        return ok({ order: await verifyOrder(ctx, body.orderId) });
      }
      case "RELEASE": {
        if (!body.orderId) return ok({ error: "orderId is required." }, 400);
        return ok({ order: await releaseOrder(ctx, body.orderId) });
      }
      case "CANCEL": {
        if (!body.orderId || !body.reason) return ok({ error: "orderId and reason are required." }, 400);
        return ok({ order: await cancelOrder(ctx, body.orderId, body.reason) });
      }
    }
  } catch (error) {
    return fail(error);
  }
}
