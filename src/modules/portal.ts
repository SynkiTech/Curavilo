// Portals (spec §141): staff "My Day" data + a token-scoped patient portal.
// Portal access uses a single-use display code whose SHA-256 hash is stored;
// sessions are separate from staff session cookies and read-only by design.

import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, NotFound } from "@/lib/api";
import type { AuthContext } from "@/lib/auth";

export const PORTAL_COOKIE = "curavilo_portal";
const PORTAL_TTL_MS = 7 * 24 * 3600 * 1000;

function hash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

// ─── Staff token management (auth'd) ────────────────────────────────────────

export async function createPortalToken(ctx: AuthContext, patientId: string, label?: string) {
  if (!ctx.permissions.includes("portals:manage")) throw new AppError(403, "forbidden", "Not permitted to manage portal access.");
  const patient = await db.patient.findFirst({ where: { id: patientId, orgId: ctx.orgId, facilityId: ctx.facilityId } });
  if (!patient) throw NotFound("Patient not found.");
  const raw = `cv-${randomBytes(6).toString("hex")}`; // 12-char display code (~48 bits)
  const token = await db.portalToken.create({
    data: {
      orgId: ctx.orgId, facilityId: ctx.facilityId, patientId,
      tokenHash: hash(raw),
      label: label?.slice(0, 80) ?? null,
      expiresAt: new Date(Date.now() + PORTAL_TTL_MS),
      createdById: ctx.userId,
    },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "portal.token_created", entityType: "PortalToken", entityId: token.id,
    summary: `Portal access code created for ${patient.firstName} ${patient.lastName} (expires in 7 days).`,
  });
  return { code: raw, expiresAt: token.expiresAt }; // raw code shown once
}

export async function listPortalTokens(ctx: AuthContext) {
  // Listing portal tokens (which patients have portal access) is sensitive.
  if (!ctx.permissions.includes("portals:manage")) throw new AppError(403, "forbidden", "Not permitted to view portal access.");
  return db.portalToken.findMany({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, patientId: true, label: true, expiresAt: true, lastUsedAt: true, createdAt: true, patient: { select: { mrn: true, firstName: true, lastName: true } } },
  });
}

export async function revokePortalToken(ctx: AuthContext, id: string) {
  if (!ctx.permissions.includes("portals:manage")) throw new AppError(403, "forbidden", "Not permitted to manage portal access.");
  const updated = await db.portalToken.updateMany({ where: { id, orgId: ctx.orgId }, data: { revokedAt: new Date() } });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "portal.token_revoked", entityType: "PortalToken", entityId: id,
    summary: "Portal access code revoked.",
  });
  return { ok: updated.count > 0 };
}

// ─── Patient portal session (unauthenticated, code-gated) ───────────────────

const loginAttempts = new Map<string, number[]>();
const MAX_LOGIN_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

export function portalRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = (loginAttempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  loginAttempts.set(key, bucket);
  return bucket.length >= MAX_LOGIN_ATTEMPTS;
}
export function recordLoginAttempt(key: string) {
  const bucket = loginAttempts.get(key) ?? [];
  bucket.push(Date.now());
  loginAttempts.set(key, bucket);
}

export async function portalLogin(mrn: string, code: string) {
  const token = await db.portalToken.findUnique({ where: { tokenHash: hash(code) }, include: { patient: true } });
  // One generic message for both wrong-code and wrong-MRN so the endpoint cannot
  // be used to enumerate valid access codes (account-enumeration defense).
  const invalid = new AppError(401, "invalid_code", "Invalid access code or MRN.");
  if (!token || token.revokedAt || token.expiresAt < new Date()) throw invalid;
  if (token.patient.mrn.toLowerCase() !== mrn.trim().toLowerCase()) throw invalid;
  await db.portalToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
  await audit({
    orgId: token.orgId, facilityId: token.facilityId, actorUserId: null, actorLabel: `Portal:${token.patient.mrn}`,
    action: "portal.login", entityType: "PortalToken", entityId: token.id,
    summary: `Patient portal session started for ${token.patient.firstName} ${token.patient.lastName}.`,
  });
  return { tokenHash: token.tokenHash, patientId: token.patientId, orgId: token.orgId, facilityId: token.facilityId };
}

/** Read-only, strictly patient-scoped portal data. */
export async function portalData(tokenHash: string) {
  const token = await db.portalToken.findUnique({ where: { tokenHash }, include: { patient: true } });
  if (!token || token.revokedAt || token.expiresAt < new Date()) {
    throw new AppError(401, "invalid_session", "Portal session expired. Please sign in again.");
  }
  const pid = token.patientId;
  const [appointments, invoices, followUps, releasedResults, encounterNotes] = await Promise.all([
    db.appointment.findMany({
      where: { orgId: token.orgId, patientId: pid, scheduledAt: { gte: new Date() } },
      orderBy: { scheduledAt: "asc" }, take: 10,
      select: { id: true, scheduledAt: true, durationMin: true, status: true },
    }),
    db.invoice.findMany({
      where: { orgId: token.orgId, patientId: pid, voidedAt: null },
      orderBy: { createdAt: "desc" }, take: 15,
      select: { number: true, status: true, totalMinor: true, amountPaidMinor: true, currency: true, createdAt: true },
    }),
    db.followUp.findMany({
      where: { orgId: token.orgId, patientId: pid },
      orderBy: { dueAt: "asc" }, take: 10,
      select: { title: true, dueAt: true, status: true },
    }),
    db.diagnosticOrder.findMany({
      where: { orgId: token.orgId, patientId: pid, status: "RELEASED" },
      orderBy: { releasedAt: "desc" }, take: 10,
      select: { reportNumber: true, testName: true, kind: true, releasedAt: true, impression: true, resultsJson: true },
    }),
    db.encounter.findMany({
      where: { orgId: token.orgId, patientId: pid, status: "COMPLETED" },
      orderBy: { completedAt: "desc" }, take: 5,
      select: { startedAt: true, diagnosis: true, plan: true },
    }),
  ]);
  return {
    patient: {
      mrn: token.patient.mrn,
      name: `${token.patient.firstName} ${token.patient.lastName}`,
      nextOfKinName: token.patient.nextOfKinName,
    },
    appointments,
    invoices: invoices.map((i) => ({ ...i, outstandingMinor: i.totalMinor - i.amountPaidMinor })),
    followUps,
    results: releasedResults.map((r) => ({ ...r, results: JSON.parse(r.resultsJson ?? "[]") as unknown, resultsJson: undefined })),
    recentVisits: encounterNotes,
    facility: { name: "Your facility", phone: null, email: null },
  };
}

// ─── Staff "My Day" (spec §141 staff portal) ────────────────────────────────

export async function myDay(ctx: AuthContext) {
  const now = new Date();
  const todayFrom = new Date(now); todayFrom.setHours(0, 0, 0, 0);
  const todayTo = new Date(now); todayTo.setHours(23, 59, 59, 999);
  const staffProfile = await db.staffMember.findFirst({
    where: { orgId: ctx.orgId, facilityId: ctx.facilityId, userId: ctx.userId },
  });
  const [appointments, tasks, notifications, certifications, leave] = await Promise.all([
    staffProfile
      ? db.appointment.findMany({
          where: { orgId: ctx.orgId, staffMemberId: staffProfile.id, scheduledAt: { gte: todayFrom, lte: todayTo } },
          orderBy: { scheduledAt: "asc" },
          include: { patient: { select: { mrn: true, firstName: true, lastName: true } } },
        })
      : Promise.resolve([]),
    db.task.findMany({ where: { orgId: ctx.orgId, status: "OPEN", OR: [{ assigneeUserId: ctx.userId }, { role: ctx.role }] }, orderBy: { dueAt: "asc" }, take: 20 }),
    db.notification.findMany({ where: { orgId: ctx.orgId, OR: [{ userId: ctx.userId }, { role: ctx.role }], readAt: null }, orderBy: { createdAt: "desc" }, take: 15 }),
    staffProfile
      ? db.staffCertification.findMany({ where: { orgId: ctx.orgId, staffId: staffProfile.id }, orderBy: { expiresAt: "asc" } })
      : Promise.resolve([]),
    staffProfile
      ? db.leaveRequest.findMany({ where: { orgId: ctx.orgId, staffId: staffProfile.id }, orderBy: { createdAt: "desc" }, take: 10 })
      : Promise.resolve([]),
  ]);
  return { staffProfile, appointments, tasks, notifications, certifications, leave };
}

export const certificationSchema = z.object({
  staffId: z.string().min(5).optional(),
  name: z.string().min(2).max(120),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function addCertification(ctx: AuthContext, input: z.infer<typeof certificationSchema>) {
  let staffId: string | undefined = input.staffId;
  if (staffId) {
    // Targeting another staff member's record is an HR action, and the target
    // must exist inside the caller's own org (no unscoped staff references).
    const target = await db.staffMember.findFirst({ where: { id: staffId, orgId: ctx.orgId }, select: { id: true, userId: true } });
    if (!target) throw NotFound("Staff member not found.");
    const isSelf = target.userId === ctx.userId;
    if (!isSelf && !ctx.permissions.includes("hr:manage")) {
      throw new AppError(403, "forbidden", "Adding certifications for other staff requires HR permission.");
    }
    staffId = target.id;
  } else {
    staffId = (await db.staffMember.findFirst({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, userId: ctx.userId }, select: { id: true } }))?.id;
  }
  if (!staffId) throw NotFound("Staff profile not found.");
  return db.staffCertification.create({
    data: { orgId: ctx.orgId, staffId, name: input.name, expiresAt: new Date(`${input.expiresAt}T00:00:00.000Z`) },
  });
}

export const leaveSchema = z.object({
  fromAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().min(2).max(300),
});

export async function requestLeave(ctx: AuthContext, input: z.infer<typeof leaveSchema>) {
  const staff = await db.staffMember.findFirst({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, userId: ctx.userId } });
  if (!staff) throw NotFound("Staff profile not found.");
  const from = new Date(`${input.fromAt}T00:00:00.000Z`);
  const to = new Date(`${input.toAt}T23:59:59.999Z`);
  if (to < from) throw new AppError(400, "bad_request", "Leave end date is before start date.");
  return db.leaveRequest.create({
    data: { orgId: ctx.orgId, facilityId: ctx.facilityId, staffId: staff.id, fromAt: from, toAt: to, reason: input.reason },
  });
}

export async function decideLeave(ctx: AuthContext, id: string, decision: "APPROVED" | "REJECTED") {
  if (!ctx.permissions.includes("portals:manage")) throw new AppError(403, "forbidden", "Not permitted to approve leave.");
  const updated = await db.leaveRequest.updateMany({
    where: { id, orgId: ctx.orgId, status: "PENDING" },
    data: { status: decision, decidedById: ctx.userId, decidedAt: new Date() },
  });
  if (updated.count === 0) throw new AppError(409, "invalid_state", "Leave request already decided.");
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "staff.leave_decided", entityType: "LeaveRequest", entityId: id,
    summary: `Leave request ${decision.toLowerCase()}.`,
  });
  return { ok: true };
}

export async function listPendingLeave(ctx: AuthContext) {
  // Pending leave lists staff names - readable by HR users only.
  if (!ctx.permissions.includes("hr:read")) throw new AppError(403, "forbidden", "Not permitted to view leave requests.");
  return db.leaveRequest.findMany({
    where: { orgId: ctx.orgId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { staff: { select: { name: true } } },
  });
}
