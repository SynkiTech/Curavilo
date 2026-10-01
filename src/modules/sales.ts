// Sales (POS) module - transactional sale + payment + stock deduction + receipt (spec §21, §69)
// Extended: returns/refunds with restock + credit notes, held (parked) sales,
// sales search, and today's till summary. All writes serialized per org via
// withWriteLock so concurrent "Complete Sale" clicks can never collide on the
// SQLite single-writer lock.
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFound, AppError } from "@/lib/api";
import { nextDocNumber } from "@/lib/numbering";
import { withWriteLock } from "@/lib/tx-lock";
import type { AuthContext } from "@/lib/auth";

const TX_OPTS = { timeout: 15_000, maxWait: 5_000 };

/** Retry a closure on transient SQLite contention (socket timeout, tx conflict). */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string })?.code;
      const msg = error instanceof Error ? error.message : String(error);
      const transient =
        code === "P2024" || code === "P2034" ||
        msg.includes("Socket timeout") || msg.includes("database is locked");
      if (!transient || attempt === attempts) throw error;
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
  throw lastError;
}

export const saleSchema = z.object({
  patientId: z.string().optional().nullable(),
  customerName: z.string().max(120).optional().nullable(),
  items: z
    .array(
      z.object({
        itemId: z.string().min(5),
        quantity: z.number().int().min(1).max(10_000),
        unitPriceMinor: z.number().int().min(0),
      })
    )
    .min(1)
    .max(60),
  discountMinor: z.number().int().min(0).default(0),
  method: z.enum(["CASH", "TRANSFER", "CARD", "MOBILE"]).default("CASH"),
  reference: z.string().max(80).optional().nullable(),
  amountTenderedMinor: z.number().int().min(0).optional().nullable(),
  idempotencyKey: z.string().min(8).max(80).optional().nullable(),
});

async function doCreateSale(ctx: AuthContext, input: z.infer<typeof saleSchema>) {
  const sale = await db.$transaction(async (tx) => {
    const number = await nextDocNumber(tx, ctx.orgId, "SALE");
    const sale = await tx.sale.create({
      data: {
        orgId: ctx.orgId,
        facilityId: ctx.facilityId,
        number,
        patientId: input.patientId || null,
        customerName: input.customerName || null,
        status: "COMPLETED",
        subtotalMinor: 0,
        discountMinor: input.discountMinor,
        totalMinor: 0,
        amountPaidMinor: 0,
        method: input.method,
        reference: input.idempotencyKey || input.reference || null,
        createdById: ctx.userId,
      },
    });
    for (const line of input.items) {
      const item = await tx.inventoryItem.findFirst({ where: { id: line.itemId, orgId: ctx.orgId, active: true } });
      if (!item) throw NotFound(`Inventory item ${line.itemId} not found.`);
      await tx.saleItem.create({
        data: {
          orgId: ctx.orgId,
          saleId: sale.id,
          itemId: line.itemId,
          name: item.name,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
          totalMinor: line.quantity * line.unitPriceMinor,
        },
      });
      await deductStockForSale(tx, ctx, line.itemId, line.quantity, sale.id);
    }
    const agg = await tx.saleItem.aggregate({
      where: { saleId: sale.id },
      _sum: { totalMinor: true },
    });
    const subtotalMinor = agg._sum.totalMinor ?? 0;
    if (input.discountMinor > subtotalMinor) throw new AppError(400, "bad_request", "Discount cannot exceed subtotal.");
    const totalMinor = subtotalMinor - input.discountMinor;
    return tx.sale.update({
      where: { id: sale.id },
      data: {
        subtotalMinor,
        totalMinor,
        amountPaidMinor: input.amountTenderedMinor && input.amountTenderedMinor > 0 ? input.amountTenderedMinor : totalMinor,
      },
      include: { items: true },
    });
  }, TX_OPTS);

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "sale.completed", entityType: "Sale", entityId: sale.id,
    summary: `POS sale ${sale.number} completed (${input.method}, ${sale.totalMinor} minor, ${input.items.length} lines).`,
  });
  return sale;
}

export async function createSale(ctx: AuthContext, input: z.infer<typeof saleSchema>) {
  if (input.idempotencyKey) {
    const existing = await db.sale.findFirst({
      where: { orgId: ctx.orgId, reference: input.idempotencyKey, status: "COMPLETED" },
      include: { items: true },
    });
    if (existing) return { sale: existing, idempotentReplay: true };
  }

  const subtotalMinor = input.items.reduce((s, i) => s + i.quantity * i.unitPriceMinor, 0);
  if (input.discountMinor > subtotalMinor) throw new AppError(400, "bad_request", "Discount cannot exceed subtotal.");

  // Serialize POS writes per org: no two interactive transactions can fight
  // over the SQLite writer lock (root cause of the "Complete Sale" 500s).
  const sale = await withWriteLock(`org:${ctx.orgId}:pos`, () =>
    withRetry(() => doCreateSale(ctx, input))
  );
  return { sale, idempotentReplay: false };
}

export async function getSaleReceipt(ctx: AuthContext, saleId: string) {
  const sale = await db.sale.findFirst({
    where: { id: saleId, orgId: ctx.orgId, facilityId: ctx.facilityId },
    include: { items: true, patient: true },
  });
  if (!sale) throw NotFound("Sale not found.");
  return sale;
}

export async function listSales(ctx: AuthContext, opts: { limit?: number; q?: string; sinceDays?: number }) {
  const where: Record<string, unknown> = { orgId: ctx.orgId, facilityId: ctx.facilityId };
  if (opts.q) {
    where.OR = [{ number: { contains: opts.q } }, { customerName: { contains: opts.q } }];
  }
  if (opts.sinceDays && opts.sinceDays > 0) {
    where.createdAt = { gte: new Date(Date.now() - opts.sinceDays * 24 * 3600 * 1000) };
  }
  const sales = await db.sale.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 50, 200),
    include: { items: true, returns: { select: { number: true, totalMinor: true } } },
  });
  return sales;
}

/* ─── Voids ─────────────────────────────────────────────────────────────── */

export async function voidSale(ctx: AuthContext, saleId: string, reason: string) {
  const sale = await db.sale.findFirst({ where: { id: saleId, orgId: ctx.orgId, facilityId: ctx.facilityId } });
  if (!sale) throw NotFound("Sale not found.");
  if (sale.status === "VOID") throw new AppError(409, "invalid_state", "Sale is already voided.");

  const voided = await withWriteLock(`org:${ctx.orgId}:pos`, () =>
    withRetry(() =>
      db.$transaction(async (tx) => {
        const items = await tx.saleItem.findMany({ where: { saleId } });
        // Return stock (FEFO-aware: restock into lots sorted by expiry, nulls last)
        for (const line of items) {
          const lots = await tx.stockLot.findMany({
            where: { orgId: ctx.orgId, itemId: line.itemId },
          });
          lots.sort((a, b) => {
            const ax = a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
            const bx = b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
            return ax - bx;
          });
          let remaining = line.quantity;
          for (const lot of lots) {
            if (remaining <= 0) break;
            const back = Math.min(lot.qtyReceived - lot.qtyRemaining, remaining);
            if (back <= 0) continue;
            await tx.stockLot.update({ where: { id: lot.id }, data: { qtyRemaining: lot.qtyRemaining + back } });
            await tx.stockMovement.create({
              data: { orgId: ctx.orgId, itemId: line.itemId, lotId: lot.id, type: "RETURN", quantity: back, reason: `Sale ${sale.number} voided`, refType: "Sale", refId: sale.id, userId: ctx.userId },
            });
            remaining -= back;
          }
        }
        return tx.sale.update({ where: { id: saleId }, data: { status: "VOID", voidedAt: new Date() } });
      }, TX_OPTS)
    )
  );

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "sale.voided", entityType: "Sale", entityId: saleId,
    summary: `POS sale ${sale.number} voided. Reason: ${reason.slice(0, 120)}`,
  });
  return voided;
}

/* ─── Returns / refunds (drug returns, credit notes) ────────────────────── */

export const returnSchema = z.object({
  saleId: z.string().min(5),
  reason: z.string().min(3).max(200),
  method: z.enum(["CASH", "TRANSFER", "CARD", "MOBILE", "CREDIT"]).default("CASH"),
  restock: z.boolean().default(true),
  lines: z
    .array(
      z.object({
        saleItemId: z.string().min(5),
        quantity: z.number().int().min(1).max(10_000),
      })
    )
    .min(1)
    .max(60),
});

/** Returnable quantity per sale line: sold minus already returned. */
export async function getSaleForReturn(ctx: AuthContext, saleId: string) {
  const sale = await db.sale.findFirst({
    where: { id: saleId, orgId: ctx.orgId, facilityId: ctx.facilityId },
    include: { items: true, returns: { include: { items: true } } },
  });
  if (!sale) throw NotFound("Sale not found.");
  if (sale.status !== "COMPLETED") throw new AppError(409, "invalid_state", "Only completed sales can be returned.");
  const returned = new Map<string, number>();
  for (const ret of sale.returns) {
    for (const line of ret.items) {
      if (line.saleItemId) returned.set(line.saleItemId, (returned.get(line.saleItemId) ?? 0) + line.quantity);
    }
  }
  const lines = sale.items.map((i) => ({
    id: i.id,
    itemId: i.itemId,
    name: i.name,
    quantity: i.quantity,
    unitPriceMinor: i.unitPriceMinor,
    totalMinor: i.totalMinor,
    alreadyReturned: returned.get(i.id) ?? 0,
    returnable: Math.max(0, i.quantity - (returned.get(i.id) ?? 0)),
  }));
  return { sale: { id: sale.id, number: sale.number, customerName: sale.customerName, method: sale.method, createdAt: sale.createdAt, status: sale.status }, lines };
}

export async function createReturn(ctx: AuthContext, input: z.infer<typeof returnSchema>) {
  const sale = await db.sale.findFirst({
    where: { id: input.saleId, orgId: ctx.orgId, facilityId: ctx.facilityId },
    include: { items: true, returns: { include: { items: true } } },
  });
  if (!sale) throw NotFound("Sale not found.");
  if (sale.status !== "COMPLETED") throw new AppError(409, "invalid_state", "Only completed sales can be returned.");

  const soldMap = new Map(sale.items.map((i) => [i.id, i]));
  const returned = new Map<string, number>();
  for (const ret of sale.returns) {
    for (const line of ret.items) {
      if (line.saleItemId) returned.set(line.saleItemId, (returned.get(line.saleItemId) ?? 0) + line.quantity);
    }
  }
  for (const line of input.lines) {
    const sold = soldMap.get(line.saleItemId);
    if (!sold) throw NotFound(`Sale line ${line.saleItemId} not found on this sale.`);
    const already = returned.get(line.saleItemId) ?? 0;
    if (line.quantity > sold.quantity - already) {
      throw new AppError(400, "bad_request", `Cannot return ${line.quantity} x ${sold.name}: only ${sold.quantity - already} returnable.`);
    }
  }

  const creditNote = await withWriteLock(`org:${ctx.orgId}:pos`, () =>
    withRetry(() =>
      db.$transaction(async (tx) => {
        const number = await nextDocNumber(tx, ctx.orgId, "RETURN");
        const ret = await tx.saleReturn.create({
          data: {
            orgId: ctx.orgId,
            facilityId: ctx.facilityId,
            number,
            saleId: sale.id,
            saleNumber: sale.number,
            reason: input.reason,
            method: input.method,
            totalMinor: 0,
            restocked: input.restock,
            createdById: ctx.userId,
          },
        });
        let totalMinor = 0;
        for (const line of input.lines) {
          const sold = soldMap.get(line.saleItemId)!;
          const lineTotal = sold.unitPriceMinor * line.quantity;
          totalMinor += lineTotal;
          await tx.saleReturnItem.create({
            data: {
              orgId: ctx.orgId,
              saleReturnId: ret.id,
              saleItemId: sold.id,
              itemId: sold.itemId,
              name: sold.name,
              quantity: line.quantity,
              unitPriceMinor: sold.unitPriceMinor,
              totalMinor: lineTotal,
            },
          });
          if (input.restock) {
            await restockForReturn(tx, ctx, sold.itemId, line.quantity, ret.id);
          }
        }
        const updated = await tx.saleReturn.update({
          where: { id: ret.id },
          data: { totalMinor },
          include: { items: true },
        });
        return updated;
      }, TX_OPTS)
    )
  );

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "sale.returned", entityType: "SaleReturn", entityId: creditNote.id,
    summary: `Return ${creditNote.number} on sale ${sale.number}: ${creditNote.totalMinor} minor refunded via ${input.method} (restock=${input.restock}).`,
  });
  return creditNote;
}

/** Restock returned units into existing lots (most-expiry-last preference = put back into the lot that still has room). Caller runs inside a transaction. */
async function restockForReturn(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  ctx: AuthContext,
  itemId: string,
  quantity: number,
  returnId: string
) {
  const lots = await tx.stockLot.findMany({ where: { orgId: ctx.orgId, itemId } });
  // Prefer lots with the latest expiry (best chance they are still sellable), then most remaining capacity.
  lots.sort((a, b) => {
    const ax = a.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bx = b.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (ax !== bx) return bx - ax;
    return b.qtyReceived - a.qtyReceived;
  });
  let remaining = quantity;
  // If there are no lots at all (e.g. item received without lots historically), create an anonymous return lot.
  if (lots.length === 0) {
    const lot = await tx.stockLot.create({
      data: { orgId: ctx.orgId, itemId, batchNo: `RET-${returnId.slice(-6).toUpperCase()}`, qtyReceived: quantity, qtyRemaining: quantity },
    });
    await tx.stockMovement.create({
      data: { orgId: ctx.orgId, itemId, lotId: lot.id, type: "RETURN", quantity, reason: "Customer return (new lot)", refType: "SaleReturn", refId: returnId, userId: ctx.userId },
    });
    return;
  }
  for (const lot of lots) {
    if (remaining <= 0) break;
    const room = Math.max(0, lot.qtyReceived - lot.qtyRemaining);
    const back = Math.min(room, remaining);
    if (back <= 0) continue;
    await tx.stockLot.update({ where: { id: lot.id }, data: { qtyRemaining: lot.qtyRemaining + back } });
    await tx.stockMovement.create({
      data: { orgId: ctx.orgId, itemId, lotId: lot.id, type: "RETURN", quantity: back, reason: "Customer return", refType: "SaleReturn", refId: returnId, userId: ctx.userId },
    });
    remaining -= back;
  }
  if (remaining > 0) {
    // Lots were full relative to receipts; spill into the first lot anyway (oversell correction).
    const lot = lots[0];
    await tx.stockLot.update({ where: { id: lot.id }, data: { qtyRemaining: lot.qtyRemaining + remaining } });
    await tx.stockMovement.create({
      data: { orgId: ctx.orgId, itemId, lotId: lot.id, type: "RETURN", quantity: remaining, reason: "Customer return (lot overflow)", refType: "SaleReturn", refId: returnId, userId: ctx.userId },
    });
  }
}

export async function listReturns(ctx: AuthContext, opts: { limit?: number; q?: string }) {
  const where: Record<string, unknown> = { orgId: ctx.orgId, facilityId: ctx.facilityId };
  if (opts.q) where.OR = [{ number: { contains: opts.q } }, { saleNumber: { contains: opts.q } }];
  return db.saleReturn.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 50, 200),
    include: { items: true },
  });
}

/* ─── Held / parked sales (invoice recovery) ────────────────────────────── */

export const holdSchema = z.object({
  label: z.string().max(80).optional().nullable(),
  customerName: z.string().max(120).optional().nullable(),
  patientId: z.string().optional().nullable(),
  discountMinor: z.number().int().min(0).default(0),
  items: z
    .array(
      z.object({
        itemId: z.string().min(5),
        name: z.string().max(160),
        sku: z.string().max(60).optional().nullable(),
        quantity: z.number().int().min(1).max(10_000),
        unitPriceMinor: z.number().int().min(0),
      })
    )
    .min(1)
    .max(60),
});

export async function holdSale(ctx: AuthContext, input: z.infer<typeof holdSchema>) {
  const totalMinor = input.items.reduce((s, i) => s + i.quantity * i.unitPriceMinor, 0) - input.discountMinor;
  const held = await db.heldSale.create({
    data: {
      orgId: ctx.orgId,
      facilityId: ctx.facilityId,
      label: input.label || input.customerName || null,
      customerName: input.customerName || null,
      patientId: input.patientId || null,
      itemsJson: JSON.stringify(input.items),
      discountMinor: input.discountMinor,
      totalMinor,
      createdById: ctx.userId,
    },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "sale.held", entityType: "HeldSale", entityId: held.id,
    summary: `Sale parked (${held.totalMinor} minor, ${input.items.length} lines).`,
  });
  return held;
}

export async function listHeldSales(ctx: AuthContext) {
  return db.heldSale.findMany({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function discardHeldSale(ctx: AuthContext, heldId: string) {
  const held = await db.heldSale.findFirst({ where: { id: heldId, orgId: ctx.orgId, facilityId: ctx.facilityId } });
  if (!held) throw NotFound("Held sale not found.");
  await db.heldSale.delete({ where: { id: heldId } });
  return { ok: true };
}

/* ─── Today's till summary (Z-report style) ─────────────────────────────── */

export async function todaySummary(ctx: AuthContext) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const sales = await db.sale.findMany({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, createdAt: { gte: start } },
    include: { items: false },
  });
  const returns = await db.saleReturn.findMany({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, createdAt: { gte: start } },
  });
  const byMethod: Record<string, { count: number; totalMinor: number }> = {};
  let grossMinor = 0;
  let count = 0;
  for (const s of sales) {
    if (s.status === "VOID") continue;
    count += 1;
    grossMinor += s.totalMinor;
    const bucket = (byMethod[s.method] ??= { count: 0, totalMinor: 0 });
    bucket.count += 1;
    bucket.totalMinor += s.totalMinor;
  }
  let returnsMinor = 0;
  let returnsCount = 0;
  for (const r of returns) {
    returnsCount += 1;
    returnsMinor += r.totalMinor;
  }
  return { count, grossMinor, returnsCount, returnsMinor, netMinor: grossMinor - returnsMinor, byMethod, voidedCount: sales.length - count };
}

/* ─── Stock deduction (FEFO) ────────────────────────────────────────────── */

/** Deduct stock for a sale, FEFO (first-expiring-first-out). Caller runs inside a transaction. */
export async function deductStockForSale(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  ctx: AuthContext,
  itemId: string,
  quantity: number,
  saleId: string
) {
  const lots = await tx.stockLot.findMany({
    where: { orgId: ctx.orgId, itemId, qtyRemaining: { gt: 0 } },
  });
  // SQLite sorts NULL first on ASC; sort in JS so no-expiry lots are consumed last.
  lots.sort((a, b) => {
    const ax = a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const bx = b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return ax - bx || a.createdAt.getTime() - b.createdAt.getTime();
  });
  const total = lots.reduce((s, l) => s + l.qtyRemaining, 0);
  if (total < quantity) {
    throw new AppError(409, "insufficient_stock", `Insufficient stock for item (${total} available, ${quantity} requested).`);
  }
  let remaining = quantity;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qtyRemaining, remaining);
    await tx.stockLot.update({ where: { id: lot.id }, data: { qtyRemaining: lot.qtyRemaining - take } });
    await tx.stockMovement.create({
      data: {
        orgId: ctx.orgId,
        itemId,
        lotId: lot.id,
        type: "SALE",
        quantity: -take,
        reason: "POS sale",
        refType: "Sale",
        refId: saleId,
        userId: ctx.userId,
      },
    });
    remaining -= take;
  }
  return quantity - remaining;
}
