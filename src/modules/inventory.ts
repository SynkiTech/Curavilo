// Inventory module — auditable movement ledger (spec §22, §23, §69)
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFound, AppError } from "@/lib/api";
import type { AuthContext } from "@/lib/auth";

export const itemSchema = z.object({
  category: z.enum(["PHARMACEUTICAL", "CONSUMABLE", "LAB", "EQUIPMENT", "OFFICE", "OTHER"]).default("PHARMACEUTICAL"),
  sku: z.string().min(2).max(40),
  barcode: z.string().max(60).optional().nullable(),
  name: z.string().min(2).max(120),
  genericName: z.string().max(120).optional().nullable(),
  dosageForm: z.string().max(60).optional().nullable(),
  unit: z.string().max(20).default("unit"),
  purchasePriceMinor: z.number().int().min(0).default(0),
  sellingPriceMinor: z.number().int().min(0).default(0),
  reorderLevel: z.number().int().min(0).max(1_000_000).default(10),
});

export async function createItem(ctx: AuthContext, input: z.infer<typeof itemSchema>) {
  const existing = await db.inventoryItem.findFirst({ where: { orgId: ctx.orgId, sku: input.sku } });
  if (existing) throw new AppError(409, "duplicate", `SKU ${input.sku} already exists.`);
  const item = await db.inventoryItem.create({
    data: { ...input, orgId: ctx.orgId, facilityId: ctx.facilityId, barcode: input.barcode || null, genericName: input.genericName || null, dosageForm: input.dosageForm || null },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "inventory.item_created", entityType: "InventoryItem", entityId: item.id,
    summary: `Created inventory item ${item.name} (${item.sku}).`,
  });
  return item;
}

export async function listItems(ctx: AuthContext, opts: { category?: string; q?: string; lowStockOnly?: boolean }) {
  const where: Record<string, unknown> = { orgId: ctx.orgId, facilityId: ctx.facilityId, active: true };
  if (opts.category) where.category = opts.category;
  if (opts.q) where.OR = [{ name: { contains: opts.q } }, { sku: { contains: opts.q } }, { barcode: { contains: opts.q } }, { genericName: { contains: opts.q } }];
  const items = await db.inventoryItem.findMany({
    where,
    orderBy: { name: "asc" },
    take: 300,
    include: { lots: true },
  });
  const withStock = items.map((item) => ({
    ...item,
    stockOnHand: item.lots.reduce((s, lot) => s + lot.qtyRemaining, 0),
    nextExpiry: item.lots.filter((l) => l.qtyRemaining > 0 && l.expiresAt).sort((a, b) => (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0))[0]?.expiresAt ?? null,
  }));
  return opts.lowStockOnly ? withStock.filter((i) => i.stockOnHand <= i.reorderLevel) : withStock;
}

export const receiveSchema = z.object({
  batchNo: z.string().min(1).max(60),
  quantity: z.number().int().min(1).max(1_000_000),
  expiresAt: z.string().optional().nullable().or(z.literal("")),
  reason: z.string().max(200).optional().nullable(),
});

export async function receiveStock(ctx: AuthContext, itemId: string, input: z.infer<typeof receiveSchema>) {
  const item = await db.inventoryItem.findFirst({ where: { id: itemId, orgId: ctx.orgId, facilityId: ctx.facilityId } });
  if (!item) throw NotFound("Inventory item not found.");

  const result = await db.$transaction(async (tx) => {
    const lot = await tx.stockLot.create({
      data: {
        orgId: ctx.orgId,
        itemId,
        batchNo: input.batchNo,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        qtyReceived: input.quantity,
        qtyRemaining: input.quantity,
      },
    });
    await tx.stockMovement.create({
      data: {
        orgId: ctx.orgId,
        itemId,
        lotId: lot.id,
        type: "RECEIPT",
        quantity: input.quantity,
        reason: input.reason || "Stock received",
        refType: "StockLot",
        refId: lot.id,
        userId: ctx.userId,
      },
    });
    return lot;
  });

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "inventory.received", entityType: "InventoryItem", entityId: itemId,
    summary: `Received ${input.quantity} × ${item.name} (batch ${input.batchNo}).`,
  });
  return result;
}

export const adjustSchema = z.object({
  lotId: z.string().min(5),
  newQty: z.number().int().min(0).max(1_000_000),
  reason: z.string().min(3).max(200),
});

export async function adjustStock(ctx: AuthContext, itemId: string, input: z.infer<typeof adjustSchema>) {
  const lot = await db.stockLot.findFirst({ where: { id: input.lotId, orgId: ctx.orgId, itemId } });
  if (!lot) throw NotFound("Stock lot not found.");
  const delta = input.newQty - lot.qtyRemaining;

  await db.$transaction(async (tx) => {
    await tx.stockLot.update({ where: { id: lot.id }, data: { qtyRemaining: input.newQty } });
    await tx.stockMovement.create({
      data: {
        orgId: ctx.orgId,
        itemId,
        lotId: lot.id,
        type: "ADJUSTMENT",
        quantity: delta,
        reason: input.reason,
        userId: ctx.userId,
      },
    });
  });

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "inventory.adjusted", entityType: "StockLot", entityId: lot.id,
    summary: `Adjusted stock by ${delta} (${input.reason}).`,
  });
  return { ok: true, delta };
}

export async function listMovements(ctx: AuthContext, itemId: string) {
  return db.stockMovement.findMany({
    where: { orgId: ctx.orgId, itemId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

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
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
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
