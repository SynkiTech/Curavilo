// Scheduling module - appointments + queue management (spec §18)
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, NotFound } from "@/lib/api";
import type { AuthContext } from "@/lib/auth";

// ─── Appointments ───────────────────────────────────────────────────────────

export const appointmentCreateSchema = z.object({
  patientId: z.string().min(5),
  staffMemberId: z.string().optional().nullable(),
  serviceItemId: z.string().optional().nullable(),
  scheduledAt: z.string().min(8), // ISO
  durationMin: z.number().int().min(5).max(480).default(30),
  notes: z.string().max(300).optional().nullable(),
});

export async function createAppointment(ctx: AuthContext, input: z.infer<typeof appointmentCreateSchema>) {
  const patient = await db.patient.findFirst({ where: { id: input.patientId, orgId: ctx.orgId, active: true } });
  if (!patient) throw NotFound("Patient not found in this facility.");

  const scheduledAt = new Date(input.scheduledAt);
  if (isNaN(scheduledAt.getTime())) throw new AppError(400, "bad_request", "Invalid appointment date/time.");

  const appointment = await db.appointment.create({
    data: {
      orgId: ctx.orgId,
      facilityId: ctx.facilityId,
      patientId: input.patientId,
      staffMemberId: input.staffMemberId || null,
      serviceItemId: input.serviceItemId || null,
      scheduledAt,
      durationMin: input.durationMin,
      notes: input.notes || null,
      createdById: ctx.userId,
    },
    include: { patient: true, staffMember: true, serviceItem: true },
  });

  await db.outboxEvent.create({
    data: {
      orgId: ctx.orgId,
      type: "APPOINTMENT_CREATED",
      payload: JSON.stringify({ appointmentId: appointment.id, patientId: appointment.patientId }),
    },
  });

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "appointment.created", entityType: "Appointment", entityId: appointment.id,
    summary: `Appointment for ${patient.firstName} ${patient.lastName} at ${scheduledAt.toISOString()}.`,
  });
  return appointment;
}

export async function listAppointments(ctx: AuthContext, opts: { date?: string; status?: string; patientId?: string }) {
  const where: Record<string, unknown> = { orgId: ctx.orgId, facilityId: ctx.facilityId };
  if (opts.status) where.status = opts.status;
  if (opts.patientId) where.patientId = opts.patientId;
  if (opts.date) {
    const dayStart = new Date(`${opts.date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
    where.scheduledAt = { gte: dayStart, lt: dayEnd };
  }
  return db.appointment.findMany({
    where,
    orderBy: { scheduledAt: "asc" },
    take: 200,
    include: { patient: true, staffMember: true, serviceItem: true },
  });
}

export type AppointmentAction = "CHECK_IN" | "CANCEL" | "NO_SHOW" | "COMPLETE";

export async function appointmentAction(ctx: AuthContext, appointmentId: string, action: AppointmentAction) {
  const appt = await db.appointment.findFirst({ where: { id: appointmentId, orgId: ctx.orgId, facilityId: ctx.facilityId } });
  if (!appt) throw NotFound("Appointment not found.");

  if (action === "CHECK_IN") {
    if (appt.status !== "SCHEDULED") throw new AppError(409, "invalid_state", "Only scheduled appointments can be checked in.");
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.appointment.update({ where: { id: appt.id }, data: { status: "CHECKED_IN" } });
      const entry = await checkInQueue(tx, ctx, appt.patientId, appt.id, "GENERAL");
      return { updated, entry };
    });
    await audit({
      orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
      action: "appointment.checked_in", entityType: "Appointment", entityId: appt.id,
      summary: `Appointment checked in; queue #${result.entry.number} assigned.`,
    });
    return result.updated;
  }

  const statusMap: Record<string, string> = { CANCEL: "CANCELLED", NO_SHOW: "NO_SHOW", COMPLETE: "COMPLETED" };
  const updated = await db.appointment.update({ where: { id: appt.id }, data: { status: statusMap[action] } });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: `appointment.${action.toLowerCase()}`, entityType: "Appointment", entityId: appt.id,
    summary: `Appointment marked ${statusMap[action]}.`,
  });
  return updated;
}

// ─── Queue ──────────────────────────────────────────────────────────────────

type TxLike = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** Allocate the next queue number for the facility+department today. */
export async function checkInQueue(tx: TxLike, ctx: AuthContext, patientId: string, appointmentId: string | null, department: string) {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const last = await tx.queueEntry.findFirst({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, department, checkedInAt: { gte: dayStart } },
    orderBy: { number: "desc" },
  });
  return tx.queueEntry.create({
    data: {
      orgId: ctx.orgId,
      facilityId: ctx.facilityId,
      patientId,
      appointmentId,
      department,
      number: (last?.number ?? 0) + 1,
      status: "WAITING",
    },
  });
}

export const walkInSchema = z.object({
  patientId: z.string().min(5),
  department: z.string().min(2).max(40).default("GENERAL"),
});

export async function walkInCheckIn(ctx: AuthContext, input: z.infer<typeof walkInSchema>) {
  const patient = await db.patient.findFirst({ where: { id: input.patientId, orgId: ctx.orgId, active: true } });
  if (!patient) throw NotFound("Patient not found.");

  const entry = await db.$transaction(async (tx) => checkInQueue(tx, ctx, input.patientId, null, input.department));
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "queue.checked_in", entityType: "QueueEntry", entityId: entry.id,
    summary: `Walk-in check-in: ${patient.firstName} ${patient.lastName} → queue #${entry.number} (${entry.department}).`,
  });
  return entry;
}

export async function listQueue(ctx: AuthContext) {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  return db.queueEntry.findMany({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, checkedInAt: { gte: dayStart } },
    orderBy: [{ status: "asc" }, { number: "asc" }],
    include: { patient: true },
    take: 300,
  });
}

export type QueueAction = "CALL" | "SKIP" | "COMPLETE";

export async function queueAction(ctx: AuthContext, entryId: string, action: QueueAction) {
  const entry = await db.queueEntry.findFirst({ where: { id: entryId, orgId: ctx.orgId, facilityId: ctx.facilityId } });
  if (!entry) throw NotFound("Queue entry not found.");

  if (action === "CALL") {
    if (entry.status !== "WAITING") throw new AppError(409, "invalid_state", "Only waiting entries can be called.");
    const updated = await db.queueEntry.update({ where: { id: entry.id }, data: { status: "CALLED", calledAt: new Date() } });
    return updated;
  }
  if (action === "SKIP") {
    if (entry.status !== "WAITING" && entry.status !== "CALLED") throw new AppError(409, "invalid_state", "Only waiting/called entries can be skipped.");
    return db.queueEntry.update({ where: { id: entry.id }, data: { status: "SKIPPED" } });
  }
  // COMPLETE
  if (entry.status !== "COMPLETED") {
    return db.queueEntry.update({ where: { id: entry.id }, data: { status: "COMPLETED", completedAt: new Date() } });
  }
  return entry;
}
