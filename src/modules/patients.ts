// Patients module - master index, duplicate detection, patient 360 (spec §14, §15)
import { z } from "zod";
import { db } from "@/lib/db";
import { nextMrn } from "@/lib/numbering";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth";

export const patientSchema = z.object({
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  phone: z.string().min(7).max(20),
  email: z.string().email().max(120).optional().nullable().or(z.literal("")),
  sex: z.enum(["MALE", "FEMALE"]),
  dateOfBirth: z.string().optional().nullable().or(z.literal("")),
  address: z.string().max(300).optional().nullable(),
  nextOfKinName: z.string().max(80).optional().nullable(),
  nextOfKinPhone: z.string().max(20).optional().nullable(),
  bloodGroup: z.string().max(5).optional().nullable(),
  allergies: z.string().max(300).optional().nullable(),
  consentNote: z.string().max(300).optional().nullable(),
});

export interface DuplicateWarning {
  id: string;
  mrn: string;
  name: string;
  phone: string;
  reason: string;
}

/** Configurable duplicate detection: exact phone, or same first+last name (spec §14). */
async function findPotentialDuplicates(orgId: string, input: { phone: string; firstName: string; lastName: string }): Promise<DuplicateWarning[]> {
  const byPhone = await db.patient.findMany({
    where: { orgId, active: true, phone: input.phone },
    take: 5,
  });
  const byName = await db.patient.findMany({
    where: {
      orgId,
      active: true,
      firstName: { equals: input.firstName },
      lastName: { equals: input.lastName },
    },
    take: 5,
  });
  const map = new Map<string, DuplicateWarning>();
  for (const p of [...byPhone, ...byName]) {
    map.set(p.id, {
      id: p.id,
      mrn: p.mrn,
      name: `${p.firstName} ${p.lastName}`,
      phone: p.phone,
      reason: byPhone.some((x) => x.id === p.id) ? "Same phone number" : "Same first and last name",
    });
  }
  return [...map.values()];
}

export async function registerPatient(ctx: AuthContext, input: z.infer<typeof patientSchema>) {
  const duplicates = await findPotentialDuplicates(ctx.orgId, {
    phone: input.phone,
    firstName: input.firstName,
    lastName: input.lastName,
  });

  const patient = await db.$transaction(async (tx) => {
    const mrn = await nextMrn(tx, ctx.orgId);
    return tx.patient.create({
      data: {
        orgId: ctx.orgId,
        facilityId: ctx.facilityId,
        mrn,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        email: input.email || null,
        sex: input.sex,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
        address: input.address || null,
        nextOfKinName: input.nextOfKinName || null,
        nextOfKinPhone: input.nextOfKinPhone || null,
        bloodGroup: input.bloodGroup || null,
        allergies: input.allergies || null,
        consentNote: input.consentNote || null,
      },
    });
  });

  await audit({
    orgId: ctx.orgId,
    facilityId: ctx.facilityId,
    actorUserId: ctx.userId,
    actorLabel: ctx.userName,
    action: "patient.created",
    entityType: "Patient",
    entityId: patient.id,
    summary: `Registered patient ${patient.firstName} ${patient.lastName} (${patient.mrn}).`,
  });

  return { patient, duplicates };
}

export async function searchPatients(ctx: AuthContext, query: string, limit = 50) {
  const q = query.trim();
  const where = q
    ? {
        orgId: ctx.orgId,
        active: true,
        OR: [
          { firstName: { contains: q } },
          { lastName: { contains: q } },
          { mrn: { contains: q } },
          { phone: { contains: q } },
        ],
      }
    : { orgId: ctx.orgId, active: true };

  return db.patient.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
    include: {
      _count: { select: { appointments: true } },
    },
  });
}

export async function getPatient360(ctx: AuthContext, patientId: string) {
  const patient = await db.patient.findFirst({
    where: { id: patientId, orgId: ctx.orgId, active: true },
  });
  if (!patient) return null;

  const [appointments, encounters, invoices, followUps, payments] = await Promise.all([
    db.appointment.findMany({
      where: { orgId: ctx.orgId, patientId },
      orderBy: { scheduledAt: "desc" },
      take: 30,
      include: { staffMember: true, serviceItem: true },
    }),
    db.encounter.findMany({
      where: { orgId: ctx.orgId, patientId },
      orderBy: { startedAt: "desc" },
      take: 30,
      include: { staffMember: true },
    }),
    db.invoice.findMany({
      where: { orgId: ctx.orgId, patientId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { items: true },
    }),
    db.followUp.findMany({
      where: { orgId: ctx.orgId, patientId },
      orderBy: { dueAt: "asc" },
      take: 20,
    }),
    db.payment.findMany({
      where: { orgId: ctx.orgId, invoice: { patientId } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  return { patient, appointments, encounters, invoices, followUps, payments };
}

export async function updatePatient(ctx: AuthContext, patientId: string, input: z.infer<typeof patientSchema>) {
  const existing = await db.patient.findFirst({ where: { id: patientId, orgId: ctx.orgId, active: true } });
  if (!existing) return null;

  const patient = await db.patient.update({
    where: { id: patientId },
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      email: input.email || null,
      sex: input.sex,
      dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
      address: input.address || null,
      nextOfKinName: input.nextOfKinName || null,
      nextOfKinPhone: input.nextOfKinPhone || null,
      bloodGroup: input.bloodGroup || null,
      allergies: input.allergies || null,
      consentNote: input.consentNote || null,
    },
  });

  await audit({
    orgId: ctx.orgId,
    facilityId: ctx.facilityId,
    actorUserId: ctx.userId,
    actorLabel: ctx.userName,
    action: "patient.updated",
    entityType: "Patient",
    entityId: patient.id,
    summary: `Updated patient ${patient.firstName} ${patient.lastName} (${patient.mrn}).`,
  });
  return patient;
}
