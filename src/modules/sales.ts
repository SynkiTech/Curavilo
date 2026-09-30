// Sales (POS) module — transactional sale + payment + stock deduction + receipt (spec §21, §69)
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFound, AppError } from "@/lib/api";
import { nextDocNumber } from "@/lib/numbering";
import { deductStockForSale } from "@/modules/inventory";
import type { AuthContext } from "@/lib/auth";

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
  idempotencyKey: z.string().min(8).max(80).optional().nullable(),
});

export async function createSale(ctx: AuthContext, input: z.infer<typeof saleSchema>) {
  if (input.idempotencyKey) {
    const existing = await db.sale.findFirst({
      where: { orgId: ctx.orgId, reference: input.idempotencyKey, status: "COMPLETED" },
    });
    if (existing) return { sale: existing, idempotentReplay: true };
  }

  const itemIds = input.items.map((i) => i.itemId);
  const catalogue = await db.inventoryItem.findMany({
    where: { orgId: ctx.orgId, id: { in: itemIds }, active: true },
  });
  const catMap = new Map(catalogue.map((c) => [c.id, c]));
  for (const line of input.items) {
    if (!catMap.has(line.itemId)) throw NotFound(`Inventory item ${line.itemId} not found.`);
  }

  const subtotalMinor = input.items.reduce((s, i) => s + i.quantity * i.unitPriceMinor, 0);
  if (input.discountMinor > subtotalMinor) throw new AppError(400, "bad_request", "Discount cannot exceed subtotal.");
  const totalMinor = subtotalMinor - input.discountMinor;

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
        subtotalMinor,
        discountMinor: input.discountMinor,
        totalMinor,
        amountPaidMinor: totalMinor,
        method: input.method,
        reference: input.idempotencyKey || input.reference || null,
        createdById: ctx.userId,
      },
    });
    for (const line of input.items) {
      await tx.saleItem.create({
        data: {
          orgId: ctx.orgId,
          saleId: sale.id,
          itemId: line.itemId,
          name: catMap.get(line.itemId)?.name ?? "Item",
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
          totalMinor: line.quantity * line.unitPriceMinor,
        },
      });
      await deductStockForSale(tx, ctx, line.itemId, line.quantity, sale.id);
    }
    return sale;
  });

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "sale.completed", entityType: "Sale", entityId: sale.id,
    summary: `POS sale ${sale.number} completed (${input.method}, ${totalMinor} minor, ${input.items.length} lines).`,
  });
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

export async function voidSale(ctx: AuthContext, saleId: string, reason: string) {
  const sale = await db.sale.findFirst({ where: { id: saleId, orgId: ctx.orgId, facilityId: ctx.facilityId } });
  if (!sale) throw NotFound("Sale not found.");
  if (sale.status === "VOID") throw new AppError(409, "invalid_state", "Sale is already voided.");

  const voided = await db.$transaction(async (tx) => {
    const items = await tx.saleItem.findMany({ where: { saleId } });
    // Return stock
    for (const line of items) {
      const lots = await tx.stockLot.findMany({
        where: { orgId: ctx.orgId, itemId: line.itemId },
        orderBy: [{ expiresAt: { sort: "asc", nulls: "last" as never } }, { createdAt: "asc" }],
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
  });

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "sale.voided", entityType: "Sale", entityId: saleId,
    summary: `POS sale ${sale.number} voided. Reason: ${reason.slice(0, 120)}`,
  });
  return voided;
}
