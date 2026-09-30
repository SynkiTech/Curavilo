// Sales (POS) API — create sale, list, receipt, void
import { ok, fail, requireAuth, parseBody, parseQuery } from "@/lib/api";
import { z } from "zod";
import { createSale, saleSchema, getSaleReceipt, voidSale } from "@/modules/sales";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("pos:sell");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (id) {
      const sale = await getSaleReceipt(ctx, id);
      return ok({ sale });
    }
    const query = parseQuery(request, z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }));
    const sales = await db.sale.findMany({
      where: { orgId: ctx.orgId, facilityId: ctx.facilityId },
      orderBy: { createdAt: "desc" },
      take: query.limit ?? 30,
      include: { items: true },
    });
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

const voidSchema = z.object({ saleId: z.string().min(5), reason: z.string().min(3).max(200) });

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth("pos:sell");
    const body = await parseBody(request, voidSchema);
    const sale = await voidSale(ctx, body.saleId, body.reason);
    return ok({ sale });
  } catch (error) {
    return fail(error);
  }
}
