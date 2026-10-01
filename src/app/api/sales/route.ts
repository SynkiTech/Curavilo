// Sales (POS) API - create sale, list/search, receipt, void, returns, held sales, till summary
import { ok, fail, requireAuth, parseBody, parseQuery } from "@/lib/api";
import { z } from "zod";
import {
  createSale, saleSchema, getSaleReceipt, voidSale,
  listSales, getSaleForReturn, createReturn, returnSchema, listReturns,
  holdSale, holdSchema, listHeldSales, discardHeldSale, todaySummary,
} from "@/modules/sales";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const ctx = await requireAuth("pos:sell");
    if (id) {
      const sale = await getSaleReceipt(ctx, id);
      return ok({ sale });
    }
    if (searchParams.get("summary") === "1") {
      const summary = await todaySummary(ctx);
      return ok({ summary });
    }
    if (searchParams.get("held") === "1") {
      const held = await listHeldSales(ctx);
      return ok({ held });
    }
    if (searchParams.get("returns") === "1") {
      const returns = await listReturns(ctx, { limit: 50 });
      return ok({ returns });
    }
    const forReturnId = searchParams.get("forReturn");
    if (forReturnId && forReturnId.length > 4) {
      const payload = await getSaleForReturn(ctx, forReturnId);
      return ok(payload);
    }
    const query = parseQuery(request, z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
      q: z.string().max(80).optional(),
      sinceDays: z.coerce.number().int().min(1).max(365).optional(),
    }));
    const sales = await listSales(ctx, query);
    return ok({ sales });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("pos:sell");
    const input = await parseBody(request, saleSchema);
    const result = await createSale(ctx, input);
    return ok(result, 201);
  } catch (error) {
    return fail(error);
  }
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("VOID"), saleId: z.string().min(5), reason: z.string().min(3).max(200) }),
  z.object({
    action: z.literal("RETURN"),
    saleId: z.string().min(5),
    reason: z.string().min(3).max(200),
    method: z.enum(["CASH", "TRANSFER", "CARD", "MOBILE", "CREDIT"]).default("CASH"),
    restock: z.boolean().default(true),
    lines: z.array(z.object({ saleItemId: z.string().min(5), quantity: z.number().int().min(1).max(10_000) })).min(1).max(60),
  }),
  z.object({
    action: z.literal("HOLD"),
    label: z.string().max(80).optional().nullable(),
    customerName: z.string().max(120).optional().nullable(),
    patientId: z.string().optional().nullable(),
    discountMinor: z.number().int().min(0).default(0),
    items: z.array(z.object({
      itemId: z.string().min(5),
      name: z.string().max(160),
      sku: z.string().max(60).optional().nullable(),
      quantity: z.number().int().min(1).max(10_000),
      unitPriceMinor: z.number().int().min(0),
    })).min(1).max(60),
  }),
]);

export async function PATCH(request: Request) {
  try {
    const body = await parseBody(request, patchSchema);
    if (body.action === "VOID") {
      const ctx = await requireAuth("pos:refund");
      const sale = await voidSale(ctx, body.saleId, body.reason);
      return ok({ sale });
    }
    if (body.action === "RETURN") {
      const ctx = await requireAuth("pos:refund");
      const ret = await createReturn(ctx, {
        saleId: body.saleId, reason: body.reason, method: body.method, restock: body.restock, lines: body.lines,
      });
      return ok({ return: ret });
    }
    const ctx = await requireAuth("pos:sell");
    const held = await holdSale(ctx, {
      label: body.label ?? null, customerName: body.customerName ?? null, patientId: body.patientId ?? null,
      discountMinor: body.discountMinor, items: body.items,
    });
    return ok({ held }, 201);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireAuth("pos:sell");
    const { searchParams } = new URL(request.url);
    const heldId = searchParams.get("heldId");
    if (!heldId) return fail(new Error("heldId is required."));
    const result = await discardHeldSale(ctx, heldId);
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
