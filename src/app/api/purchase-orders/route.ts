// Purchase orders API - create, list, submit/cancel, receive (partial supported)
import { ok, fail, requireAuth, parseBody, parseQuery } from "@/lib/api";
import { z } from "zod";
import {
  listPurchaseOrders, createPurchaseOrder, poCreateSchema,
  updatePurchaseOrderStatus, receivePurchaseOrder, poReceiveSchema,
} from "@/modules/inventory";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("inventory:read");
    const query = parseQuery(request, z.object({
      status: z.enum(["DRAFT", "SUBMITTED", "PARTIAL", "RECEIVED", "CANCELLED"]).optional(),
    }));
    const orders = await listPurchaseOrders(ctx, { status: query.status });
    return ok({ orders });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("inventory:write");
    const input = await parseBody(request, poCreateSchema);
    const order = await createPurchaseOrder(ctx, input);
    return ok({ order }, 201);
  } catch (error) {
    return fail(error);
  }
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SET_STATUS"), purchaseOrderId: z.string().min(5), status: z.enum(["SUBMITTED", "CANCELLED"]) }),
  z.object({
    action: z.literal("RECEIVE"),
    purchaseOrderId: z.string().min(5),
    lines: z.array(z.object({
      poItemId: z.string().min(5),
      quantity: z.number().int().min(1).max(1_000_000),
      batchNo: z.string().min(1).max(60),
      expiresAt: z.string().optional().nullable().or(z.literal("")),
    })).min(1).max(100),
  }),
]);

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth("inventory:write");
    const body = await parseBody(request, patchSchema);
    if (body.action === "SET_STATUS") {
      const order = await updatePurchaseOrderStatus(ctx, body.purchaseOrderId, body.status);
      return ok({ order });
    }
    const order = await receivePurchaseOrder(ctx, { purchaseOrderId: body.purchaseOrderId, lines: body.lines });
    return ok({ order });
  } catch (error) {
    return fail(error);
  }
}
