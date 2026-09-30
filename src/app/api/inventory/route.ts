// Inventory API — items CRUD (create/list), receive/adjust, movements
import { ok, fail, requireAuth, parseBody, parseQuery } from "@/lib/api";
import { z } from "zod";
import { createItem, itemSchema, listItems, receiveStock, receiveSchema, adjustStock, adjustSchema, listMovements } from "@/modules/inventory";

const listQuery = z.object({
  category: z.string().max(20).optional(),
  q: z.string().max(80).optional(),
  lowStockOnly: z.enum(["true", "false"]).optional(),
});

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("inventory:read");
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get("itemId");
    if (itemId) {
      const movements = await listMovements(ctx, itemId);
      return ok({ movements });
    }
    const query = parseQuery(request, listQuery);
    const items = await listItems(ctx, { ...query, lowStockOnly: query.lowStockOnly === "true" });
    return ok({ items });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("inventory:write");
    const input = await parseBody(request, itemSchema);
    const item = await createItem(ctx, input);
    return ok({ item }, 201);
  } catch (error) {
    return fail(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("RECEIVE"),
    itemId: z.string().min(5),
    batchNo: z.string().min(1).max(60),
    quantity: z.number().int().min(1).max(1_000_000),
    expiresAt: z.string().optional().nullable().or(z.literal("")),
    reason: z.string().max(200).optional().nullable(),
  }),
  z.object({
    action: z.literal("ADJUST"),
    itemId: z.string().min(5),
    lotId: z.string().min(5),
    newQty: z.number().int().min(0).max(1_000_000),
    reason: z.string().min(3).max(200),
  }),
]);

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth("inventory:write");
    const body = await parseBody(request, actionSchema);
    if (body.action === "RECEIVE") {
      const lot = await receiveStock(ctx, body.itemId, {
        batchNo: body.batchNo,
        quantity: body.quantity,
        expiresAt: body.expiresAt ?? null,
        reason: body.reason ?? null,
      });
      return ok({ lot });
    }
    const result = await adjustStock(ctx, body.itemId, { lotId: body.lotId, newQty: body.newQty, reason: body.reason });
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
