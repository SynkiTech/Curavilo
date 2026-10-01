// Inventory module - auditable movement ledger (spec §22, §23, §69)
// Extended: item edit/archive, dispose/write-off, stocktake, suppliers,
// purchase orders with partial receiving, valuation + expiry reports.
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFound, AppError } from "@/lib/api";
import { nextDocNumber } from "@/lib/numbering";
import { withWriteLock } from "@/lib/tx-lock";
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

export async function listItems(ctx: AuthContext, opts: { category?: string; q?: string; lowStockOnly?: boolean; includeInactive?: boolean }) {
  const where: Record<string, unknown> = { orgId: ctx.orgId, facilityId: ctx.facilityId };
  if (!opts.includeInactive) where.active = true;
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

  const result = await withWriteLock(`org:${ctx.orgId}:inventory`, () =>
    db.$transaction(async (tx) => {
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
  }));

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

  await withWriteLock(`org:${ctx.orgId}:inventory`, () =>
    db.$transaction(async (tx) => {
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
  }));

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

/* ─── Edit / archive items ──────────────────────────────────────────────── */

export const itemUpdateSchema = z.object({
  itemId: z.string().min(5),
  name: z.string().min(2).max(120).optional(),
  genericName: z.string().max(120).optional().nullable(),
  dosageForm: z.string().max(60).optional().nullable(),
  barcode: z.string().max(60).optional().nullable(),
  category: z.enum(["PHARMACEUTICAL", "CONSUMABLE", "LAB", "EQUIPMENT", "OFFICE", "OTHER"]).optional(),
  unit: z.string().max(20).optional(),
  purchasePriceMinor: z.number().int().min(0).optional(),
  sellingPriceMinor: z.number().int().min(0).optional(),
  reorderLevel: z.number().int().min(0).max(1_000_000).optional(),
  supplierId: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

export async function updateItem(ctx: AuthContext, input: z.infer<typeof itemUpdateSchema>) {
  const { itemId, ...patch } = input;
  const item = await db.inventoryItem.findFirst({ where: { id: itemId, orgId: ctx.orgId } });
  if (!item) throw NotFound("Inventory item not found.");
  if (patch.supplierId) {
    const supplier = await db.supplier.findFirst({ where: { id: patch.supplierId, orgId: ctx.orgId } });
    if (!supplier) throw NotFound("Supplier not found.");
  }
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    cleaned[k] = (k === "genericName" || k === "dosageForm" || k === "barcode" || k === "supplierId") && (v === "" || v === null) ? null : v;
  }
  const updated = await db.inventoryItem.update({ where: { id: itemId }, data: cleaned });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "inventory.item_updated", entityType: "InventoryItem", entityId: itemId,
    summary: `Updated item ${updated.name} (${Object.keys(cleaned).join(", ") || "no changes"}).`,
  });
  return updated;
}

/* ─── Dispose / write-off (damage, expiry) ──────────────────────────────── */

export const disposeSchema = z.object({
  itemId: z.string().min(5),
  lotId: z.string().min(5),
  quantity: z.number().int().min(1).max(1_000_000),
  reason: z.string().min(3).max(200),
  type: z.enum(["DAMAGE", "EXPIRED"]).default("DAMAGE"),
});

export async function disposeStock(ctx: AuthContext, input: z.infer<typeof disposeSchema>) {
  const lot = await db.stockLot.findFirst({ where: { id: input.lotId, orgId: ctx.orgId, itemId: input.itemId } });
  if (!lot) throw NotFound("Stock lot not found.");
  if (input.quantity > lot.qtyRemaining) {
    throw new AppError(400, "bad_request", `Cannot dispose ${input.quantity}: lot holds ${lot.qtyRemaining}.`);
  }
  const result = await withWriteLock(`org:${ctx.orgId}:inventory`, () =>
    db.$transaction(async (tx) => {
      await tx.stockLot.update({ where: { id: lot.id }, data: { qtyRemaining: lot.qtyRemaining - input.quantity } });
      await tx.stockMovement.create({
        data: {
          orgId: ctx.orgId,
          itemId: input.itemId,
          lotId: lot.id,
          type: input.type,
          quantity: -input.quantity,
          reason: input.reason,
          userId: ctx.userId,
        },
      });
      return { ok: true };
    })
  );
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "inventory.disposed", entityType: "StockLot", entityId: lot.id,
    summary: `Wrote off ${input.quantity} units (${input.type}): ${input.reason.slice(0, 120)}`,
  });
  return result;
}

/* ─── Stocktake (physical count) ────────────────────────────────────────── */

export const stocktakeSchema = z.object({
  reason: z.string().min(3).max(200).default("Physical stock count"),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(5),
        countedQty: z.number().int().min(0).max(1_000_000),
      })
    )
    .min(1)
    .max(300),
});

/**
 * Apply a physical count. Variance is applied to lots:
 * shrinkage deducts FEFO (soonest expiry loses units first); surplus is added
 * to the lot with the latest expiry (or created as a count lot when none).
 */
export async function stocktake(ctx: AuthContext, input: z.infer<typeof stocktakeSchema>) {
  const items = await db.inventoryItem.findMany({
    where: { orgId: ctx.orgId, id: { in: input.lines.map((l) => l.itemId) } },
    include: { lots: true },
  });
  const itemMap = new Map(items.map((i) => [i.id, i]));

  const applied = await withWriteLock(`org:${ctx.orgId}:inventory`, () =>
    db.$transaction(async (tx) => {
      const results: { itemId: string; name: string; systemQty: number; countedQty: number; variance: number }[] = [];
      for (const line of input.lines) {
        const item = itemMap.get(line.itemId);
        if (!item) throw NotFound(`Inventory item ${line.itemId} not found.`);
        const systemQty = item.lots.reduce((s, l) => s + l.qtyRemaining, 0);
        const variance = line.countedQty - systemQty;
        if (variance === 0) {
          results.push({ itemId: item.id, name: item.name, systemQty, countedQty: line.countedQty, variance: 0 });
          continue;
        }
        const lots = [...item.lots].sort((a, b) => {
          const ax = a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
          const bx = b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
          return ax - bx;
        });
        if (variance < 0) {
          let remaining = -variance;
          for (const lot of lots) {
            if (remaining <= 0) break;
            const take = Math.min(lot.qtyRemaining, remaining);
            if (take <= 0) continue;
            await tx.stockLot.update({ where: { id: lot.id }, data: { qtyRemaining: lot.qtyRemaining - take } });
            await tx.stockMovement.create({
              data: { orgId: ctx.orgId, itemId: item.id, lotId: lot.id, type: "ADJUSTMENT", quantity: -take, reason: input.reason, userId: ctx.userId },
            });
            remaining -= take;
          }
        } else {
          const target = [...lots].sort((a, b) => {
            const ax = a.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
            const bx = b.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
            return bx - ax;
          })[0];
          if (target) {
            await tx.stockLot.update({ where: { id: target.id }, data: { qtyRemaining: target.qtyRemaining + variance } });
            await tx.stockMovement.create({
              data: { orgId: ctx.orgId, itemId: item.id, lotId: target.id, type: "ADJUSTMENT", quantity: variance, reason: input.reason, userId: ctx.userId },
            });
          } else {
            const lot = await tx.stockLot.create({
              data: { orgId: ctx.orgId, itemId: item.id, batchNo: "STOCKTAKE", qtyReceived: variance, qtyRemaining: variance },
            });
            await tx.stockMovement.create({
              data: { orgId: ctx.orgId, itemId: item.id, lotId: lot.id, type: "ADJUSTMENT", quantity: variance, reason: input.reason, userId: ctx.userId },
            });
          }
        }
        results.push({ itemId: item.id, name: item.name, systemQty, countedQty: line.countedQty, variance });
      }
      return results;
    })
  );

  const changed = applied.filter((r) => r.variance !== 0);
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "inventory.stocktake", entityType: "InventoryItem", entityId: input.lines[0]?.itemId ?? "-",
    summary: `Stocktake applied: ${changed.length} item(s) adjusted of ${applied.length} counted.`,
  });
  return applied;
}

/* ─── Suppliers ─────────────────────────────────────────────────────────── */

export const supplierSchema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().max(120).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  notes: z.string().max(300).optional().nullable(),
});

export async function listSuppliers(ctx: AuthContext, opts: { includeInactive?: boolean } = {}) {
  const where: Record<string, unknown> = { orgId: ctx.orgId };
  if (!opts.includeInactive) where.active = true;
  return db.supplier.findMany({ where, orderBy: { name: "asc" }, take: 200 });
}

export async function createSupplier(ctx: AuthContext, input: z.infer<typeof supplierSchema>) {
  const supplier = await db.supplier.create({
    data: {
      orgId: ctx.orgId,
      name: input.name,
      phone: input.phone || null,
      email: input.email || null,
      address: input.address || null,
      notes: input.notes || null,
    },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "inventory.supplier_created", entityType: "Supplier", entityId: supplier.id,
    summary: `Created supplier ${supplier.name}.`,
  });
  return supplier;
}

export async function updateSupplier(ctx: AuthContext, supplierId: string, input: Partial<z.infer<typeof supplierSchema>> & { active?: boolean }) {
  const supplier = await db.supplier.findFirst({ where: { id: supplierId, orgId: ctx.orgId } });
  if (!supplier) throw NotFound("Supplier not found.");
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    patch[k] = (k === "phone" || k === "email" || k === "address" || k === "notes") && v === "" ? null : v;
  }
  const updated = await db.supplier.update({ where: { id: supplierId }, data: patch });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "inventory.supplier_updated", entityType: "Supplier", entityId: supplierId,
    summary: `Updated supplier ${updated.name}.`,
  });
  return updated;
}

/* ─── Purchase orders ───────────────────────────────────────────────────── */

export const poCreateSchema = z.object({
  supplierId: z.string().min(5),
  expectedAt: z.string().optional().nullable().or(z.literal("")),
  notes: z.string().max(300).optional().nullable(),
  items: z
    .array(
      z.object({
        itemId: z.string().min(5),
        quantity: z.number().int().min(1).max(1_000_000),
        unitCostMinor: z.number().int().min(0).default(0),
      })
    )
    .min(1)
    .max(100),
});

export async function listPurchaseOrders(ctx: AuthContext, opts: { status?: string; limit?: number } = {}) {
  const where: Record<string, unknown> = { orgId: ctx.orgId, facilityId: ctx.facilityId };
  if (opts.status) where.status = opts.status;
  return db.purchaseOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 50, 200),
    include: { supplier: { select: { name: true } }, items: { include: { item: { select: { name: true, sku: true, unit: true } } } } },
  });
}

export async function createPurchaseOrder(ctx: AuthContext, input: z.infer<typeof poCreateSchema>) {
  const supplier = await db.supplier.findFirst({ where: { id: input.supplierId, orgId: ctx.orgId } });
  if (!supplier) throw NotFound("Supplier not found.");
  const validItems = await db.inventoryItem.findMany({
    where: { orgId: ctx.orgId, id: { in: input.items.map((i) => i.itemId) } },
  });
  if (validItems.length !== new Set(input.items.map((i) => i.itemId)).size) {
    throw NotFound("One or more inventory items were not found.");
  }
  const po = await db.$transaction(async (tx) => {
    const number = await nextDocNumber(tx, ctx.orgId, "PO");
    return tx.purchaseOrder.create({
      data: {
        orgId: ctx.orgId,
        facilityId: ctx.facilityId,
        number,
        supplierId: input.supplierId,
        status: "DRAFT",
        expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
        notes: input.notes || null,
        createdById: ctx.userId,
        items: {
          create: input.items.map((i) => ({
            orgId: ctx.orgId,
            itemId: i.itemId,
            quantity: i.quantity,
            unitCostMinor: i.unitCostMinor,
          })),
        },
      },
      include: { supplier: { select: { name: true } }, items: { include: { item: { select: { name: true, sku: true, unit: true } } } } },
    });
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "inventory.po_created", entityType: "PurchaseOrder", entityId: po.id,
    summary: `Created purchase order ${po.number} for ${supplier.name} (${po.items.length} lines).`,
  });
  return po;
}

export async function updatePurchaseOrderStatus(ctx: AuthContext, poId: string, status: "SUBMITTED" | "CANCELLED") {
  const po = await db.purchaseOrder.findFirst({ where: { id: poId, orgId: ctx.orgId, facilityId: ctx.facilityId } });
  if (!po) throw NotFound("Purchase order not found.");
  if (po.status === "RECEIVED") throw new AppError(409, "invalid_state", "A received order cannot change status.");
  if (po.status === "CANCELLED") throw new AppError(409, "invalid_state", "This order is cancelled.");
  const updated = await db.purchaseOrder.update({ where: { id: poId }, data: { status } });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "inventory.po_updated", entityType: "PurchaseOrder", entityId: poId,
    summary: `Purchase order ${po.number} set to ${status}.`,
  });
  return updated;
}

export const poReceiveSchema = z.object({
  purchaseOrderId: z.string().min(5),
  lines: z
    .array(
      z.object({
        poItemId: z.string().min(5),
        quantity: z.number().int().min(1).max(1_000_000),
        batchNo: z.string().min(1).max(60),
        expiresAt: z.string().optional().nullable().or(z.literal("")),
      })
    )
    .min(1)
    .max(100),
});

/** Receive purchase order lines: creates stock lots + movements, updates PO status. */
export async function receivePurchaseOrder(ctx: AuthContext, input: z.infer<typeof poReceiveSchema>) {
  const po = await db.purchaseOrder.findFirst({
    where: { id: input.purchaseOrderId, orgId: ctx.orgId, facilityId: ctx.facilityId },
    include: { items: true },
  });
  if (!po) throw NotFound("Purchase order not found.");
  if (po.status === "RECEIVED") throw new AppError(409, "invalid_state", "This order is fully received.");
  if (po.status === "CANCELLED") throw new AppError(409, "invalid_state", "This order is cancelled.");
  const lineMap = new Map(po.items.map((l) => [l.id, l]));
  for (const line of input.lines) {
    const poLine = lineMap.get(line.poItemId);
    if (!poLine) throw NotFound(`Purchase order line ${line.poItemId} not found.`);
    const already = poLine.quantityReceived;
    if (already + line.quantity > poLine.quantity) {
      throw new AppError(400, "bad_request", `Line ${poLine.itemId}: receiving ${line.quantity} exceeds ordered balance (${poLine.quantity - already}).`);
    }
  }

  const result = await withWriteLock(`org:${ctx.orgId}:inventory`, () =>
    db.$transaction(async (tx) => {
      for (const line of input.lines) {
        const poLine = lineMap.get(line.poItemId)!;
        const lot = await tx.stockLot.create({
          data: {
            orgId: ctx.orgId,
            itemId: poLine.itemId,
            batchNo: line.batchNo,
            expiresAt: line.expiresAt ? new Date(line.expiresAt) : null,
            qtyReceived: line.quantity,
            qtyRemaining: line.quantity,
          },
        });
        await tx.stockMovement.create({
          data: {
            orgId: ctx.orgId,
            itemId: poLine.itemId,
            lotId: lot.id,
            type: "RECEIPT",
            quantity: line.quantity,
            reason: `Received against ${po.number}`,
            refType: "PurchaseOrder",
            refId: po.id,
            userId: ctx.userId,
          },
        });
        await tx.purchaseOrderItem.update({ where: { id: poLine.id }, data: { quantityReceived: poLine.quantityReceived + line.quantity } });
      }
      const refreshed = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id } });
      const totalQty = refreshed.reduce((s, l) => s + l.quantity, 0);
      const receivedQty = refreshed.reduce((s, l) => s + l.quantityReceived, 0);
      const status = receivedQty === 0 ? "SUBMITTED" : receivedQty >= totalQty ? "RECEIVED" : "PARTIAL";
      return tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status, receivedAt: status === "RECEIVED" ? new Date() : po.receivedAt },
        include: { supplier: { select: { name: true } }, items: { include: { item: { select: { name: true, sku: true, unit: true } } } } },
      });
    })
  );

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "inventory.po_received", entityType: "PurchaseOrder", entityId: po.id,
    summary: `Received ${input.lines.length} line(s) on ${po.number} (status ${result.status}).`,
  });
  return result;
}

/* ─── Reports: valuation, expiring, expired ─────────────────────────────── */

export async function inventorySummary(ctx: AuthContext) {
  const items = await db.inventoryItem.findMany({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, active: true },
    include: { lots: true },
  });
  let purchaseValueMinor = 0;
  let retailValueMinor = 0;
  let lowStock = 0;
  let outOfStock = 0;
  let expiredQty = 0;
  let expiredValueMinor = 0;
  let expiringSoonQty = 0;
  const in30 = Date.now() + 30 * 24 * 3600 * 1000;
  const now = Date.now();
  const categoryValue: Record<string, number> = {};
  for (const item of items) {
    const onHand = item.lots.reduce((s, l) => s + l.qtyRemaining, 0);
    purchaseValueMinor += onHand * item.purchasePriceMinor;
    retailValueMinor += onHand * item.sellingPriceMinor;
    categoryValue[item.category] = (categoryValue[item.category] ?? 0) + onHand * item.purchasePriceMinor;
    if (onHand === 0) outOfStock += 1;
    else if (onHand <= item.reorderLevel) lowStock += 1;
    for (const lot of item.lots) {
      if (lot.qtyRemaining <= 0) continue;
      if (lot.expiresAt) {
        const t = lot.expiresAt.getTime();
        if (t <= now) {
          expiredQty += lot.qtyRemaining;
          expiredValueMinor += lot.qtyRemaining * item.purchasePriceMinor;
        } else if (t <= in30) {
          expiringSoonQty += lot.qtyRemaining;
        }
      }
    }
  }
  return {
    itemCount: items.length,
    purchaseValueMinor,
    retailValueMinor,
    lowStock,
    outOfStock,
    expiredQty,
    expiredValueMinor,
    expiringSoonQty,
    categoryValue,
  };
}

export async function listExpiring(ctx: AuthContext, days = 90) {
  const cutoff = new Date(Date.now() + Math.max(0, days) * 24 * 3600 * 1000);
  const lots = await db.stockLot.findMany({
    where: { orgId: ctx.orgId, qtyRemaining: { gt: 0 }, expiresAt: { not: null, lte: cutoff } },
    orderBy: { expiresAt: "asc" },
    take: 200,
    include: { item: { select: { name: true, sku: true, purchasePriceMinor: true, sellingPriceMinor: true, unit: true } } },
  });
  return lots;
}
