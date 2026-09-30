// Clinical module — encounters (spec §19, §15). Clinical records are versioned-safe:
// completion writes once; afterwards records are archived via status, not hard-deleted.
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFound, AppError } from "@/lib/api";
import { nextDocNumber } from "@/lib/numbering";
import type { AuthContext } from "@/lib/auth";
import { triggerWorkflowsForEvent } from "@/modules/workflows";

export const encounterStartSchema = z.object({
  queueEntryId: z.string().optional().nullable(),
  patientId: z.string().optional().nullable(),
  staffMemberId: z.string().optional().nullable(),
  formKey: z.string().min(3).max(40).optional().nullable(),
});

export async function startEncounter(ctx: AuthContext, input: z.infer<typeof encounterStartSchema>) {
  let patientId = input.patientId ?? null;
  let queueEntryId = input.queueEntryId ?? null;

  if (queueEntryId) {
    const entry = await db.queueEntry.findFirst({
      where: { id: queueEntryId, orgId: ctx.orgId, facilityId: ctx.facilityId },
    });
    if (!entry) throw NotFound("Queue entry not found.");
    patientId = entry.patientId;
    if (entry.status !== "IN_SERVICE") {
      await db.queueEntry.update({ where: { id: entry.id }, data: { status: "IN_SERVICE" } });
    }
  }
  if (!patientId) throw new AppError(400, "bad_request", "patientId or queueEntryId is required.");
  const patient = await db.patient.findFirst({ where: { id: patientId, orgId: ctx.orgId, active: true } });
  if (!patient) throw NotFound("Patient not found.");

  const encounter = await db.encounter.create({
    data: {
      orgId: ctx.orgId,
      facilityId: ctx.facilityId,
      patientId,
      queueEntryId,
      staffMemberId: input.staffMemberId || null,
      serviceLine: ctx.serviceProfileKey,
      formKey: input.formKey || "GENERAL_CONSULT",
      status: "OPEN",
      startedAt: new Date(),
    },
    include: { patient: true },
  });

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "encounter.started", entityType: "Encounter", entityId: encounter.id,
    summary: `Encounter started for ${patient.firstName} ${patient.lastName} (${patient.mrn}).`,
  });
  return encounter;
}

export const encounterCompleteSchema = z.object({
  formData: z.record(z.string(), z.unknown()).default({}),
  diagnosis: z.string().max(500).optional().nullable(),
  plan: z.string().max(500).optional().nullable(),
  chargeItemIds: z.array(z.string()).default([]),
  followUpDays: z.number().int().min(0).max(365).optional().nullable(),
  waitingMinutes: z.number().int().min(0).max(24 * 60).optional().nullable(),
});

export async function completeEncounter(ctx: AuthContext, encounterId: string, input: z.infer<typeof encounterCompleteSchema>) {
  const encounter = await db.encounter.findFirst({
    where: { id: encounterId, orgId: ctx.orgId, facilityId: ctx.facilityId },
    include: { patient: true },
  });
  if (!encounter) throw NotFound("Encounter not found.");
  if (encounter.status === "COMPLETED") throw new AppError(409, "invalid_state", "Encounter is already completed.");

  // Deterministic charge calculation from the service catalogue (no AI here, ever).
  const charges = input.chargeItemIds.length
    ? await db.serviceItem.findMany({ where: { orgId: ctx.orgId, id: { in: input.chargeItemIds }, active: true } })
    : [];
  const subtotalMinor = charges.reduce((sum, c) => sum + c.priceMinor, 0);

  const result = await db.$transaction(async (tx) => {
    const completed = await tx.encounter.update({
      where: { id: encounter.id },
      data: {
        status: "COMPLETED",
        formData: JSON.stringify(input.formData),
        diagnosis: input.diagnosis || null,
        plan: input.plan || null,
        chargeItemIds: charges.map((c) => c.id).join(","),
        completedAt: new Date(),
      },
    });

    if (encounter.queueEntryId) {
      await tx.queueEntry.updateMany({
        where: { id: encounter.queueEntryId, status: { in: ["WAITING", "CALLED", "IN_SERVICE"] } },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }

    let invoice: { id: string; number: string } | null = null;
    if (subtotalMinor > 0) {
      const number = await nextDocNumber(tx, ctx.orgId, "INVOICE");
      invoice = await tx.invoice.create({
        data: {
          orgId: ctx.orgId,
          facilityId: ctx.facilityId,
          patientId: encounter.patientId,
          encounterId: encounter.id,
          number,
          status: "ISSUED",
          subtotalMinor,
          discountMinor: 0,
          totalMinor: subtotalMinor,
          amountPaidMinor: 0,
          currency: ctx.currency,
          issuedAt: new Date(),
          createdById: ctx.userId,
          items: {
            create: charges.map((c) => ({
              orgId: ctx.orgId,
              serviceItemId: c.id,
              name: c.name,
              quantity: 1,
              unitPriceMinor: c.priceMinor,
              totalMinor: c.priceMinor,
            })),
          },
        },
      });
    }

    let followUp: { id: string } | null = null;
    if (input.followUpDays && input.followUpDays > 0) {
      followUp = await tx.followUp.create({
        data: {
          orgId: ctx.orgId,
          facilityId: ctx.facilityId,
          patientId: encounter.patientId,
          encounterId: encounter.id,
          title: "Follow-up visit",
          dueAt: new Date(Date.now() + input.followUpDays * 24 * 3600 * 1000),
          status: "PENDING",
        },
      });
    }

    // Transactional outbox: workflow triggers fire after commit
    await tx.outboxEvent.create({
      data: {
        orgId: ctx.orgId,
        type: "ENCOUNTER_COMPLETED",
        payload: JSON.stringify({
          encounterId: encounter.id,
          patientId: encounter.patientId,
          facilityId: ctx.facilityId,
          followUpDays: input.followUpDays ?? null,
        }),
      },
    });

    return { completed, invoice, followUp };
  });

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "encounter.completed", entityType: "Encounter", entityId: encounter.id,
    summary: `Encounter completed for ${encounter.patient.firstName} ${encounter.patient.lastName}${result.invoice ? `; invoice ${result.invoice.number}` : ""}.`,
  });

  // Fire-and-process workflow triggers (v0: processed inline after commit)
  await triggerWorkflowsForEvent(ctx, "ENCOUNTER_COMPLETED", {
    encounterId: encounter.id,
    patientId: encounter.patientId,
    facilityId: ctx.facilityId,
  });

  return result;
}

export async function listEncounters(ctx: AuthContext, opts: { status?: string; patientId?: string }) {
  const where: Record<string, unknown> = { orgId: ctx.orgId, facilityId: ctx.facilityId };
  if (opts.status) where.status = opts.status;
  if (opts.patientId) where.patientId = opts.patientId;
  return db.encounter.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: 100,
    include: { patient: true, staffMember: true },
  });
}

export async function getEncounter(ctx: AuthContext, id: string) {
  const encounter = await db.encounter.findFirst({
    where: { id, orgId: ctx.orgId, facilityId: ctx.facilityId },
    include: { patient: true, staffMember: true, invoices: { include: { items: true } } },
  });
  if (!encounter) throw NotFound("Encounter not found.");
  const { invoices, ...rest } = encounter;
  return { ...rest, invoice: invoices[0] ?? null };
}
