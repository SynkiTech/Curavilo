// Diagnostics — laboratory + radiology orders (spec §137).
// State machine: ORDERED → SPECIMEN_COLLECTED → RESULT_ENTERED → VERIFIED → RELEASED
// (or CANCELLED). Release emits LAB_RESULT_RELEASED on the outbox and generates
// a printable lab report document. Turnaround time is computed at release.

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, NotFound } from "@/lib/api";
import { nextDocNumber } from "@/lib/numbering";
import { emitEvent } from "@/modules/automation";
import type { AuthContext } from "@/lib/auth";

const MODALITIES = ["XRAY", "ULTRASOUND", "CT", "MRI"] as const;

export const orderSchema = z.object({
  patientId: z.string().min(5),
  encounterId: z.string().min(5).optional().nullable(),
  kind: z.enum(["LAB", "IMAGING"]).default("LAB"),
  serviceItemId: z.string().min(5).optional().nullable(),
  testName: z.string().min(2).max(120),
  modality: z.enum(MODALITIES).optional().nullable(),
  priority: z.enum(["ROUTINE", "URGENT"]).default("ROUTINE"),
  clinicalNotes: z.string().max(600).optional().nullable(),
});

export const resultSchema = z.object({
  results: z.array(z.object({
    name: z.string().min(1).max(80),
    value: z.string().min(1).max(120),
    unit: z.string().max(30).optional().nullable(),
    refRange: z.string().max(60).optional().nullable(),
    flag: z.enum(["NORMAL", "LOW", "HIGH", "CRITICAL"]).optional(),
  })).min(1).max(30),
  impression: z.string().max(1000).optional().nullable(),
});

export async function createOrder(ctx: AuthContext, input: z.infer<typeof orderSchema>) {
  const patient = await db.patient.findFirst({ where: { id: input.patientId, orgId: ctx.orgId, facilityId: ctx.facilityId } });
  if (!patient) throw NotFound("Patient not found.");
  const order = await db.diagnosticOrder.create({
    data: {
      orgId: ctx.orgId,
      facilityId: ctx.facilityId,
      patientId: input.patientId,
      encounterId: input.encounterId ?? null,
      kind: input.kind,
      serviceItemId: input.serviceItemId ?? null,
      testName: input.testName,
      modality: input.kind === "IMAGING" ? input.modality ?? "XRAY" : null,
      priority: input.priority,
      clinicalNotes: input.clinicalNotes ?? null,
      orderedById: ctx.userId,
    },
    include: { patient: true },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "diagnostic.ordered", entityType: "DiagnosticOrder", entityId: order.id,
    summary: `${input.kind === "LAB" ? "Lab" : "Imaging"} order "${input.testName}" created for ${patient.firstName} ${patient.lastName} (${input.priority}).`,
  });
  return order;
}

async function loadOrder(ctx: AuthContext, id: string) {
  const order = await db.diagnosticOrder.findFirst({ where: { id, orgId: ctx.orgId, facilityId: ctx.facilityId }, include: { patient: true } });
  if (!order) throw NotFound("Order not found.");
  return order;
}

/** Specimen collection / imaging attendance (LAB role). */
export async function collectSpecimen(ctx: AuthContext, id: string, input: { site?: string }) {
  const order = await loadOrder(ctx, id);
  if (order.status !== "ORDERED") throw new AppError(409, "invalid_state", `Order is ${order.status}; expected ORDERED.`);
  const updated = await db.diagnosticOrder.update({
    where: { id },
    data: {
      status: "SPECIMEN_COLLECTED",
      specimenSite: input.site?.slice(0, 120) ?? null,
      specimenCollectedById: ctx.userId,
      specimenCollectedAt: new Date(),
    },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "diagnostic.specimen_collected", entityType: "DiagnosticOrder", entityId: id,
    summary: `Specimen collected for "${order.testName}" (${order.patient.firstName} ${order.patient.lastName}).`,
  });
  return updated;
}

/** Result entry (LAB/doctor). */
export async function enterResults(ctx: AuthContext, id: string, input: z.infer<typeof resultSchema>) {
  const order = await loadOrder(ctx, id);
  if (!["SPECIMEN_COLLECTED", "ORDERED"].includes(order.status)) {
    throw new AppError(409, "invalid_state", `Order is ${order.status}; results already entered or released.`);
  }
  const updated = await db.diagnosticOrder.update({
    where: { id },
    data: {
      status: "RESULT_ENTERED",
      resultsJson: JSON.stringify(input.results),
      impression: input.impression ?? null,
    },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "diagnostic.results_entered", entityType: "DiagnosticOrder", entityId: id,
    summary: `${input.results.length} result(s) entered for "${order.testName}".`,
  });
  return updated;
}

/** Verification by an authorized user (doctor/owner) — release flows to the patient. */
export async function verifyOrder(ctx: AuthContext, id: string) {
  const order = await loadOrder(ctx, id);
  if (order.status !== "RESULT_ENTERED") throw new AppError(409, "invalid_state", `Order is ${order.status}; expected RESULT_ENTERED.`);
  const updated = await db.diagnosticOrder.update({
    where: { id },
    data: { status: "VERIFIED", verifiedById: ctx.userId, verifiedAt: new Date() },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "diagnostic.verified", entityType: "DiagnosticOrder", entityId: id,
    summary: `Results verified for "${order.testName}" (${order.patient.firstName} ${order.patient.lastName}).`,
  });
  return updated;
}

export async function releaseOrder(ctx: AuthContext, id: string) {
  const order = await loadOrder(ctx, id);
  if (order.status !== "VERIFIED") throw new AppError(409, "invalid_state", `Order is ${order.status}; verify before release.`);
  const turnaroundMin = Math.max(0, Math.round((Date.now() - order.orderedAt.getTime()) / 60_000));
  const number = await nextDocNumberTx(ctx.orgId, order.kind === "LAB" ? "LABREPORT" : "IMAGEREPORT");
  const updated = await db.diagnosticOrder.update({
    where: { id },
    data: {
      status: "RELEASED",
      releasedById: ctx.userId,
      releasedAt: new Date(),
      turnaroundMin,
      reportNumber: number,
    },
  });
  await db.generatedDocument.create({
    data: {
      orgId: ctx.orgId, facilityId: ctx.facilityId,
      kind: "LAB_REPORT",
      title: `${order.kind === "LAB" ? "Laboratory" : "Imaging"} report — ${order.testName}`,
      contentJson: JSON.stringify({
        reportNumber: number,
        patient: { mrn: order.patient.mrn, name: `${order.patient.firstName} ${order.patient.lastName}` },
        testName: order.testName,
        modality: order.modality,
        results: JSON.parse(order.resultsJson ?? "[]"),
        impression: order.impression,
        verifiedAt: order.verifiedAt,
        turnaroundMin,
      }),
      sourceId: order.id,
      createdById: ctx.userId,
    },
  });
  await emitEvent(ctx.orgId, "LAB_RESULT_RELEASED", {
    refId: order.id, orderId: order.id, facilityId: ctx.facilityId, patientId: order.patientId,
    testName: order.testName, kind: order.kind, reportNumber: number,
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "diagnostic.released", entityType: "DiagnosticOrder", entityId: id,
    summary: `Report ${number} released for "${order.testName}" (TAT ${turnaroundMin} min).`,
  });
  return updated;
}

export async function cancelOrder(ctx: AuthContext, id: string, reason: string) {
  const order = await loadOrder(ctx, id);
  if (["VERIFIED", "RELEASED"].includes(order.status)) {
    throw new AppError(409, "invalid_state", "Verified/released reports cannot be cancelled.");
  }
  const updated = await db.diagnosticOrder.update({
    where: { id },
    data: { status: "CANCELLED", cancelReason: reason.slice(0, 200) },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "diagnostic.cancelled", entityType: "DiagnosticOrder", entityId: id,
    summary: `Order "${order.testName}" cancelled: ${reason.slice(0, 120)}`,
  });
  return updated;
}

export async function listOrders(ctx: AuthContext, opts: { kind?: string; status?: string; patientId?: string }) {
  const where: Record<string, unknown> = { orgId: ctx.orgId, facilityId: ctx.facilityId };
  if (opts.kind) where.kind = opts.kind;
  if (opts.status) where.status = opts.status;
  if (opts.patientId) where.patientId = opts.patientId;
  return db.diagnosticOrder.findMany({
    where,
    orderBy: { orderedAt: "desc" },
    take: 120,
    include: { patient: { select: { mrn: true, firstName: true, lastName: true, sex: true, dateOfBirth: true } } },
  });
}

export async function getOrder(ctx: AuthContext, id: string) {
  const order = await db.diagnosticOrder.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { patient: true },
  });
  if (!order) throw NotFound("Order not found.");
  return order;
}

async function nextDocNumberTx(orgId: string, type: string): Promise<string> {
  const { nextDocNumber } = await import("@/lib/numbering");
  return nextDocNumber(db as never, orgId, type);
}
