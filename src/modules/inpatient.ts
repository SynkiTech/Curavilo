// Inpatient foundation — wards, beds, admissions, discharge (spec §137).
// Bed occupancy is derived from Admission status; beds transition through the
// admission transaction so FREE/OCCUPIED can never drift from reality.

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, NotFound } from "@/lib/api";
import { nextDocNumber } from "@/lib/numbering";
import type { AuthContext } from "@/lib/auth";

export const wardSchema = z.object({
  name: z.string().min(2).max(80),
  genderPolicy: z.enum(["MALE", "FEMALE", "MIXED"]).default("MIXED"),
  bedLabels: z.array(z.string().min(1).max(20)).min(1).max(40),
});

export const admitSchema = z.object({
  patientId: z.string().min(5),
  bedId: z.string().min(5),
  encounterId: z.string().min(5).optional().nullable(),
  reason: z.string().min(2).max(300),
});

export const dischargeSchema = z.object({
  summary: z.string().min(5).max(4000),
});

export async function createWard(ctx: AuthContext, input: z.infer<typeof wardSchema>) {
  const ward = await db.ward.create({
    data: {
      orgId: ctx.orgId, facilityId: ctx.facilityId,
      name: input.name, genderPolicy: input.genderPolicy,
      beds: { create: input.bedLabels.map((label) => ({ orgId: ctx.orgId, label, status: "FREE" })) },
    },
    include: { beds: true },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "inpatient.ward_created", entityType: "Ward", entityId: ward.id,
    summary: `Ward "${input.name}" created with ${input.bedLabels.length} beds.`,
  });
  return ward;
}

export async function listWards(ctx: AuthContext) {
  return db.ward.findMany({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, active: true },
    include: { beds: { orderBy: { label: "asc" } } },
    orderBy: { name: "asc" },
  });
}

export async function setBedStatus(ctx: AuthContext, bedId: string, status: "FREE" | "MAINTENANCE") {
  const bed = await db.bed.findFirst({ where: { id: bedId, orgId: ctx.orgId } });
  if (!bed) throw NotFound("Bed not found.");
  if (bed.status === "OCCUPIED") throw new AppError(409, "invalid_state", "Bed is occupied — discharge the patient first.");
  return db.bed.update({ where: { id: bedId }, data: { status } });
}

export async function admitPatient(ctx: AuthContext, input: z.infer<typeof admitSchema>) {
  const patient = await db.patient.findFirst({ where: { id: input.patientId, orgId: ctx.orgId, facilityId: ctx.facilityId } });
  if (!patient) throw NotFound("Patient not found.");
  const bed = await db.bed.findFirst({ where: { id: input.bedId, orgId: ctx.orgId }, include: { ward: true } });
  if (!bed || bed.ward.facilityId !== ctx.facilityId) throw NotFound("Bed not found in this facility.");
  if (bed.status !== "FREE") throw new AppError(409, "invalid_state", `Bed ${bed.label} is ${bed.status.toLowerCase()}.`);

  const result = await db.$transaction(async (tx) => {
    const number = await nextDocNumber(tx, ctx.orgId, "ADMISSION");
    const admission = await tx.admission.create({
      data: {
        orgId: ctx.orgId, facilityId: ctx.facilityId,
        patientId: input.patientId, wardId: bed.wardId, bedId: bed.id,
        encounterId: input.encounterId ?? null,
        reason: input.reason, admittedById: ctx.userId,
      },
    });
    await tx.bed.update({ where: { id: bed.id }, data: { status: "OCCUPIED" } });
    return { admission, number };
  });

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "inpatient.admitted", entityType: "Admission", entityId: result.admission.id,
    summary: `${patient.firstName} ${patient.lastName} admitted to ${bed.ward.name} / bed ${bed.label}: ${input.reason.slice(0, 100)}`,
  });
  return { ...result.admission, number: result.number };
}

export async function dischargePatient(ctx: AuthContext, admissionId: string, input: z.infer<typeof dischargeSchema>) {
  const admission = await db.admission.findFirst({ where: { id: admissionId, orgId: ctx.orgId }, include: { patient: true, bed: { include: { ward: true } } } });
  if (!admission) throw NotFound("Admission not found.");
  if (admission.status !== "ADMITTED") throw new AppError(409, "invalid_state", "Patient already discharged.");

  const result = await db.$transaction(async (tx) => {
    const dischargedAt = new Date();
    const updated = await tx.admission.update({
      where: { id: admissionId },
      data: { status: "DISCHARGED", dischargedAt, dischargeSummary: input.summary, dischargeById: ctx.userId },
    });
    await tx.bed.update({ where: { id: admission.bedId }, data: { status: "FREE" } });
    await tx.generatedDocument.create({
      data: {
        orgId: ctx.orgId, facilityId: ctx.facilityId,
        kind: "DISCHARGE_SUMMARY",
        title: `Discharge summary — ${admission.patient.firstName} ${admission.patient.lastName}`,
        contentJson: JSON.stringify({
          patient: { mrn: admission.patient.mrn, name: `${admission.patient.firstName} ${admission.patient.lastName}` },
          ward: admission.bed.ward.name, bed: admission.bed.label,
          reason: admission.reason, admittedAt: admission.admittedAt, dischargedAt, summary: input.summary,
        }),
        sourceId: admissionId,
        createdById: ctx.userId,
      },
    });
    return updated;
  });

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "inpatient.discharged", entityType: "Admission", entityId: admissionId,
    summary: `${admission.patient.firstName} ${admission.patient.lastName} discharged from ${admission.bed.ward.name}.`,
  });
  return result;
}

export async function listAdmissions(ctx: AuthContext, opts: { status?: string }) {
  return db.admission.findMany({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, ...(opts.status ? { status: opts.status } : {}) },
    orderBy: { admittedAt: "desc" },
    take: 100,
    include: {
      patient: { select: { mrn: true, firstName: true, lastName: true, sex: true, dateOfBirth: true } },
      bed: { include: { ward: { select: { name: true } } } },
    },
  });
}

// ─── Referrals ──────────────────────────────────────────────────────────────

export const referralSchema = z.object({
  patientId: z.string().min(5),
  encounterId: z.string().min(5).optional().nullable(),
  direction: z.enum(["INTERNAL", "EXTERNAL"]).default("INTERNAL"),
  toServiceLine: z.string().max(60).optional().nullable(),
  toStaffMemberId: z.string().min(5).optional().nullable(),
  externalFacility: z.string().max(160).optional().nullable(),
  notes: z.string().max(600).optional().nullable(),
});

export async function createReferral(ctx: AuthContext, input: z.infer<typeof referralSchema>) {
  const patient = await db.patient.findFirst({ where: { id: input.patientId, orgId: ctx.orgId, facilityId: ctx.facilityId } });
  if (!patient) throw NotFound("Patient not found.");
  if (input.direction === "INTERNAL" && !input.toServiceLine && !input.toStaffMemberId) {
    throw new AppError(400, "bad_request", "Internal referrals need a service line or staff member.");
  }
  if (input.direction === "EXTERNAL" && !input.externalFacility) {
    throw new AppError(400, "bad_request", "External referrals need a facility name.");
  }
  const referral = await db.referral.create({
    data: {
      orgId: ctx.orgId, facilityId: ctx.facilityId,
      patientId: input.patientId, encounterId: input.encounterId ?? null,
      direction: input.direction, toServiceLine: input.toServiceLine ?? null,
      toStaffMemberId: input.toStaffMemberId ?? null, externalFacility: input.externalFacility ?? null,
      notes: input.notes ?? null, createdById: ctx.userId,
    },
    include: { patient: true },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "referral.created", entityType: "Referral", entityId: referral.id,
    summary: `${input.direction === "INTERNAL" ? "Internal" : `External → ${input.externalFacility}`} referral for ${patient.firstName} ${patient.lastName}.`,
  });
  return referral;
}

export async function listReferrals(ctx: AuthContext, status?: string) {
  return db.referral.findMany({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      patient: { select: { mrn: true, firstName: true, lastName: true } },
      toStaffMember: { select: { name: true } },
    },
  });
}

export async function updateReferralStatus(ctx: AuthContext, id: string, status: "ACCEPTED" | "COMPLETED" | "CANCELLED") {
  const referral = await db.referral.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!referral) throw NotFound("Referral not found.");
  const updated = await db.referral.update({
    where: { id },
    data: { status, resolvedAt: new Date() },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "referral.updated", entityType: "Referral", entityId: id,
    summary: `Referral status set to ${status}.`,
  });
  return updated;
}
