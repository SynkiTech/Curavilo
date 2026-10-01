// Inventory API - items CRUD (create/list/update/archive), receive/adjust/dispose,
// stocktake, movements, valuation + expiry reports
import { ok, fail, requireAuth, parseBody, parseQuery } from "@/lib/api";
import { z } from "zod";
import {
  createItem, itemSchema, itemUpdateSchema, updateItem,
  listItems, receiveStock, receiveSchema, adjustStock, adjustSchema,
  listMovements, disposeStock, disposeSchema, stocktake, stocktakeSchema,
  inventorySummary, listExpiring,
} from "@/modules/inventory";

const listQuery = z.object({
  category: z.string().max(20).optional(),
  q: z.string().max(80).optional(),
  lowStockOnly: z.enum(["true", "false"]).optional(),
  includeInactive: z.enum(["true", "false"]).optional(),
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
    if (searchParams.get("summary") === "1") {
      const summary = await inventorySummary(ctx);
      return ok({ summary });
    }
    if (searchParams.get("expiringDays")) {
      const days = z.coerce.number().int().min(1).max(365).parse(searchParams.get("expiringDays"));
      const lots = await listExpiring(ctx, days);
      return ok({ lots });
    }
    const query = parseQuery(request, listQuery);
    const items = await listItems(ctx, {
      category: query.category,
      q: query.q,
      lowStockOnly: query.lowStockOnly === "true",
      includeInactive: query.includeInactive === "true",
    });
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
  z.object({
    action: z.literal("DISPOSE"),
    itemId: z.string().min(5),
    lotId: z.string().min(5),
    quantity: z.number().int().min(1).max(1_000_000),
    reason: z.string().min(3).max(200),
    type: z.enum(["DAMAGE", "EXPIRED"]).default("DAMAGE"),
  }),
  z.object({
    action: z.literal("STOCKTAKE"),
    reason: z.string().min(3).max(200).default("Physical stock count"),
    lines: z.array(z.object({
      itemId: z.string().min(5),
      countedQty: z.number().int().min(0).max(1_000_000),
    })).min(1).max(300),
  }),
]);

export async function PATCH(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ctx = await requireAuth("inventory:write");

    if (searchParams.get("action") === "UPDATE_ITEM") {
      const input = await parseBody(request, itemUpdateSchema);
      const item = await updateItem(ctx, input);
      return ok({ item });
    }

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
    if (body.action === "DISPOSE") {
      const result = await disposeStock(ctx, {
        itemId: body.itemId, lotId: body.lotId, quantity: body.quantity, reason: body.reason, type: body.type,
      });
      return ok(result);
    }
    if (body.action === "STOCKTAKE") {
      const results = await stocktake(ctx, { reason: body.reason, lines: body.lines });
      return ok({ results });
    }
    const result = await adjustStock(ctx, body.itemId, { lotId: body.lotId, newQty: body.newQty, reason: body.reason });
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
