// Billing module — invoices, payments, receipts (spec §20, §37, §100)
// Deterministic arithmetic only. Payments are append-only; void instead of delete.
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFound, AppError, BadRequest } from "@/lib/api";
import { nextDocNumber } from "@/lib/numbering";
import type { AuthContext } from "@/lib/auth";

export const invoiceCreateSchema = z.object({
  patientId: z.string().min(5),
  encounterId: z.string().optional().nullable(),
  items: z
    .array(
      z.object({
        serviceItemId: z.string().optional().nullable(),
        name: z.string().min(1).max(120),
        quantity: z.number().int().min(1).max(1000),
        unitPriceMinor: z.number().int().min(0).max(10_000_000_000),
      })
    )
    .min(1)
    .max(50),
  discountMinor: z.number().int().min(0).default(0),
  note: z.string().max(300).optional().nullable(),
});

export async function createInvoice(ctx: AuthContext, input: z.infer<typeof invoiceCreateSchema>) {
  const patient = await db.patient.findFirst({ where: { id: input.patientId, orgId: ctx.orgId, active: true } });
  if (!patient) throw NotFound("Patient not found.");

  const subtotalMinor = input.items.reduce((s, i) => s + i.quantity * i.unitPriceMinor, 0);
  if (input.discountMinor > subtotalMinor) throw BadRequest("Discount cannot exceed subtotal.");
  const totalMinor = subtotalMinor - input.discountMinor;

  const invoice = await db.$transaction(async (tx) => {
    const number = await nextDocNumber(tx, ctx.orgId, "INVOICE");
    return tx.invoice.create({
      data: {
        orgId: ctx.orgId,
        facilityId: ctx.facilityId,
        patientId: input.patientId,
        encounterId: input.encounterId || null,
        number,
        status: "ISSUED",
        subtotalMinor,
        discountMinor: input.discountMinor,
        totalMinor,
        amountPaidMinor: 0,
        currency: ctx.currency,
        note: input.note || null,
        issuedAt: new Date(),
        createdById: ctx.userId,
        items: {
          create: input.items.map((i) => ({
            orgId: ctx.orgId,
            serviceItemId: i.serviceItemId || null,
            name: i.name,
            quantity: i.quantity,
            unitPriceMinor: i.unitPriceMinor,
            totalMinor: i.quantity * i.unitPriceMinor,
          })),
        },
      },
      include: { items: true, patient: true },
    });
  });

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "invoice.created", entityType: "Invoice", entityId: invoice.id,
    summary: `Invoice ${invoice.number} issued for ${patient.firstName} ${patient.lastName} (total ${totalMinor} minor).`,
  });
  return invoice;
}

export async function listInvoices(ctx: AuthContext, opts: { status?: string; patientId?: string; q?: string }) {
  const where: Record<string, unknown> = { orgId: ctx.orgId, facilityId: ctx.facilityId };
  if (opts.status) where.status = opts.status;
  if (opts.patientId) where.patientId = opts.patientId;
  if (opts.q) where.number = { contains: opts.q };
  return db.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { patient: true, items: true, payments: true },
  });
}

export async function getInvoice(ctx: AuthContext, id: string) {
  const invoice = await db.invoice.findFirst({
    where: { id, orgId: ctx.orgId, facilityId: ctx.facilityId },
    include: {
      patient: true,
      items: true,
      payments: { orderBy: { createdAt: "asc" } },
      encounter: true,
    },
  });
  if (!invoice) throw NotFound("Invoice not found.");
  return invoice;
}

export const paymentSchema = z.object({
  amountMinor: z.number().int().min(1).max(10_000_000_000),
  method: z.enum(["CASH", "TRANSFER", "CARD", "MOBILE"]).default("CASH"),
  reference: z.string().max(80).optional().nullable(),
  idempotencyKey: z.string().min(8).max(80).optional().nullable(),
});

/** Record a payment against an invoice. Idempotent when idempotencyKey repeats. */
export async function recordPayment(ctx: AuthContext, invoiceId: string, input: z.infer<typeof paymentSchema>) {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, orgId: ctx.orgId, facilityId: ctx.facilityId },
    include: { patient: true },
  });
  if (!invoice) throw NotFound("Invoice not found.");
  if (invoice.status === "VOID") throw new AppError(409, "invalid_state", "Cannot pay a voided invoice.");
  if (invoice.status === "PAID") throw new AppError(409, "invalid_state", "Invoice is already fully paid.");

  if (input.idempotencyKey) {
    const existing = await db.payment.findFirst({
      where: {
        orgId: ctx.orgId,
        invoiceId,
        reference: input.idempotencyKey,
      },
    });
    if (existing) return { payment: existing, invoice, idempotentReplay: true };
  }

  const outstanding = invoice.totalMinor - invoice.amountPaidMinor;
  if (input.amountMinor > outstanding) {
    throw BadRequest(`Amount exceeds outstanding balance (${outstanding} minor units).`);
  }

  const result = await db.$transaction(async (tx) => {
    const number = await nextDocNumber(tx, ctx.orgId, "PAYMENT");
    const payment = await tx.payment.create({
      data: {
        orgId: ctx.orgId,
        facilityId: ctx.facilityId,
        invoiceId,
        number,
        method: input.method,
        amountMinor: input.amountMinor,
        currency: invoice.currency,
        reference: input.reference || input.idempotencyKey || null,
        createdById: ctx.userId,
      },
    });
    const amountPaidMinor = invoice.amountPaidMinor + input.amountMinor;
    const status = amountPaidMinor >= invoice.totalMinor ? "PAID" : "PARTIALLY_PAID";
    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: { amountPaidMinor, status },
    });
    // Transactional outbox: payment events drive workflows/webhooks (spec §70, §134)
    await tx.outboxEvent.create({
      data: {
        orgId: ctx.orgId,
        type: "PAYMENT_RECEIVED",
        payload: JSON.stringify({
          refId: payment.id, paymentId: payment.id, invoiceId, invoiceNumber: invoice.number,
          patientId: invoice.patientId, facilityId: ctx.facilityId,
          amountMinor: input.amountMinor, currency: invoice.currency, method: input.method,
          invoiceStatus: status,
        }),
      },
    });
    return { payment, invoice: updated, idempotentReplay: false };
  });

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "payment.recorded", entityType: "Payment", entityId: result.payment.id,
    summary: `Payment ${result.payment.number} (${input.method}, ${input.amountMinor} minor) on invoice ${invoice.number}; invoice now ${result.invoice.status}.`,
  });
  return result;
}

export async function voidPayment(ctx: AuthContext, paymentId: string, reason: string) {
  const payment = await db.payment.findFirst({
    where: { id: paymentId, orgId: ctx.orgId, facilityId: ctx.facilityId },
  });
  if (!payment) throw NotFound("Payment not found.");
  if (payment.voidedAt) throw new AppError(409, "invalid_state", "Payment is already voided.");

  const result = await db.$transaction(async (tx) => {
    const voided = await tx.payment.update({
      where: { id: payment.id },
      data: { voidedAt: new Date(), voidReason: reason.slice(0, 200) },
    });
    const invoice = await tx.invoice.findUnique({ where: { id: payment.invoiceId } });
    if (invoice) {
      const activePaid = await tx.payment.aggregate({
        where: { invoiceId: invoice.id, voidedAt: null },
        _sum: { amountMinor: true },
      });
      const amountPaidMinor = activePaid._sum.amountMinor ?? 0;
      const status = invoice.status === "VOID" ? "VOID" : amountPaidMinor >= invoice.totalMinor ? "PAID" : amountPaidMinor > 0 ? "PARTIALLY_PAID" : "ISSUED";
      await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaidMinor, status } });
    }
    return voided;
  });

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "payment.voided", entityType: "Payment", entityId: payment.id,
    summary: `Payment ${payment.number} voided. Reason: ${reason.slice(0, 120)}`,
  });
  return result;
}

export async function voidInvoice(ctx: AuthContext, invoiceId: string, reason: string) {
  const invoice = await db.invoice.findFirst({ where: { id: invoiceId, orgId: ctx.orgId, facilityId: ctx.facilityId } });
  if (!invoice) throw NotFound("Invoice not found.");
  if (invoice.amountPaidMinor > 0) throw new AppError(409, "invalid_state", "Cannot void an invoice with payments. Void the payments first.");

  const voided = await db.invoice.update({
    where: { id: invoiceId },
    data: { status: "VOID", voidedAt: new Date() },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "invoice.voided", entityType: "Invoice", entityId: invoiceId,
    summary: `Invoice ${invoice.number} voided. Reason: ${reason.slice(0, 120)}`,
  });
  return voided;
}
