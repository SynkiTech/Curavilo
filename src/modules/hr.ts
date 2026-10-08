// HR module - people operations: directory, leave approvals, certifications,
// attendance, performance reviews and facility announcements. Facility-scoped.
// Reuses StaffMember / LeaveRequest / StaffCertification; adds PerformanceReview
// and AttendanceLog. All decisions audited.
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFound, AppError } from "@/lib/api";
import type { AuthContext } from "@/lib/auth";

const base = (ctx: AuthContext) => ({ orgId: ctx.orgId, facilityId: ctx.facilityId });

export const reviewSchema = z.object({
  staffId: z.string().min(5),
  period: z.string().min(2).max(60),
  overallScore: z.number().int().min(1).max(5),
  strengths: z.string().max(1200).optional().nullable(),
  improvements: z.string().max(1200).optional().nullable(),
  goals: z.string().max(1200).optional().nullable(),
});

export const attendanceSchema = z.object({
  staffId: z.string().min(5),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["PRESENT", "ABSENT", "LATE", "LEAVE", "OFF_DUTY"]),
  checkInAt: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  checkOutAt: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  note: z.string().max(300).optional().nullable(),
});

export const hrCertificationSchema = z.object({
  staffId: z.string().min(5),
  name: z.string().min(2).max(120),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const announcementSchema = z.object({
  title: z.string().min(2).max(160),
  body: z.string().min(2).max(2000),
  role: z.string().max(30).optional().nullable(), // target a role team, or null = everyone
  urgency: z.enum(["NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
});

/** Wide HR overview powering the HR dashboard page. */
export async function hrOverview(ctx: AuthContext) {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
  const in30 = new Date(now.getTime() + 30 * 86_400_000);

  const [staff, pendingLeave, recentDecisions, expiringCerts, todayAttendance, recentReviews] = await Promise.all([
    db.staffMember.findMany({
      where: base(ctx),
      orderBy: [{ name: "asc" }],
      include: {
        certifications: { orderBy: { expiresAt: "asc" }, take: 4 },
        _count: { select: { leaveRequests: true, performanceReviews: true } },
      },
    }),
    db.leaveRequest.findMany({
      where: { orgId: ctx.orgId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 30,
      include: { staff: { select: { id: true, name: true, designation: true, department: true } } },
    }),
    db.leaveRequest.findMany({
      where: { orgId: ctx.orgId, status: { in: ["APPROVED", "REJECTED"] } },
      orderBy: { decidedAt: "desc" },
      take: 8,
      include: { staff: { select: { name: true } } },
    }),
    db.staffCertification.findMany({
      where: { orgId: ctx.orgId, expiresAt: { lte: in30, gte: now } },
      orderBy: { expiresAt: "asc" },
      take: 12,
      include: { staff: { select: { name: true, designation: true } } },
    }),
    db.attendanceLog.findMany({
      where: { orgId: ctx.orgId, facilityId: ctx.facilityId, date: { gte: todayStart, lt: todayEnd } },
      include: { staff: { select: { name: true, designation: true } } },
    }),
    db.performanceReview.findMany({
      where: base(ctx),
      orderBy: { reviewedAt: "desc" },
      take: 8,
      include: { staff: { select: { name: true, designation: true } } },
    }),
  ]);

  // On leave right now = approved leave covering today.
  const onLeaveNow = await db.leaveRequest.findMany({
    where: { orgId: ctx.orgId, status: "APPROVED", fromAt: { lte: now }, toAt: { gte: todayStart } },
    include: { staff: { select: { name: true, designation: true } } },
    take: 20,
  });

  const byDepartment = new Map<string, number>();
  const byDesignation = new Map<string, number>();
  for (const s of staff) {
    const dept = s.department?.trim() || "Unassigned";
    byDepartment.set(dept, (byDepartment.get(dept) ?? 0) + 1);
    byDesignation.set(s.designation, (byDesignation.get(s.designation) ?? 0) + 1);
  }

  return {
    headcount: {
      total: staff.length,
      active: staff.filter((s) => s.active).length,
      inactive: staff.filter((s) => !s.active).length,
    },
    byDepartment: [...byDepartment.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    byDesignation: [...byDesignation.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    staff: staff.map((s) => ({
      id: s.id,
      name: s.name,
      designation: s.designation,
      department: s.department,
      active: s.active,
      certifications: s.certifications.map((c) => ({ id: c.id, name: c.name, expiresAt: c.expiresAt.toISOString() })),
      leaveRequests: s._count.leaveRequests,
      reviews: s._count.performanceReviews,
    })),
    pendingLeave: pendingLeave.map((l) => ({
      id: l.id,
      staffId: l.staffId,
      staffName: l.staff?.name ?? "Staff",
      designation: l.staff?.designation ?? null,
      department: l.staff?.department ?? null,
      fromAt: l.fromAt.toISOString(),
      toAt: l.toAt.toISOString(),
      reason: l.reason,
      createdAt: l.createdAt.toISOString(),
    })),
    recentDecisions: recentDecisions.map((l) => ({
      id: l.id, staffName: l.staff?.name ?? "Staff", status: l.status,
      fromAt: l.fromAt.toISOString(), toAt: l.toAt.toISOString(), decidedAt: l.decidedAt?.toISOString() ?? null,
    })),
    onLeaveNow: onLeaveNow.map((l) => ({
      id: l.id, staffName: l.staff?.name ?? "Staff", designation: l.staff?.designation ?? null,
      toAt: l.toAt.toISOString(),
    })),
    expiringCertifications: expiringCerts.map((c) => ({
      id: c.id, staffName: c.staff?.name ?? "Staff", designation: c.staff?.designation ?? null,
      name: c.name, expiresAt: c.expiresAt.toISOString(),
    })),
    todayAttendance: todayAttendance.map((a) => ({
      id: a.id, staffId: a.staffId, staffName: a.staff?.name ?? "Staff",
      designation: a.staff?.designation ?? null,
      status: a.status, checkInAt: a.checkInAt ?? null, checkOutAt: a.checkOutAt ?? null, note: a.note,
    })),
    recentReviews: recentReviews.map((r) => ({
      id: r.id, staffName: r.staff?.name ?? "Staff", designation: r.staff?.designation ?? null,
      period: r.period, overallScore: r.overallScore, strengths: r.strengths,
      improvements: r.improvements, goals: r.goals, status: r.status,
      reviewedAt: r.reviewedAt.toISOString(),
    })),
  };
}

/** Approve/reject a leave request (HR authority). Notifies the requester. */
export async function decideLeaveHr(ctx: AuthContext, id: string, decision: "APPROVED" | "REJECTED") {
  const leave = await db.leaveRequest.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { staff: { select: { name: true, userId: true } } },
  });
  if (!leave) throw NotFound("Leave request not found.");
  if (leave.status !== "PENDING") throw new AppError(409, "invalid_state", "Leave request already decided.");

  const updated = await db.leaveRequest.update({
    where: { id: leave.id },
    data: { status: decision, decidedById: ctx.userId, decidedAt: new Date() },
  });

  // Notify the requester (if they have a user account) on their dashboard.
  if (leave.staff?.userId) {
    await db.notification.create({
      data: {
        orgId: ctx.orgId,
        userId: leave.staff.userId,
        type: decision === "APPROVED" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
        title: `Leave ${decision.toLowerCase()}`,
        body: `Your leave (${leave.fromAt.toISOString().slice(0, 10)} to ${leave.toAt.toISOString().slice(0, 10)}) was ${decision.toLowerCase()} by ${ctx.userName}.`,
      },
    });
  }

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "hr.leave_decided", entityType: "LeaveRequest", entityId: leave.id,
    summary: `Leave for ${leave.staff?.name ?? "staff"} ${decision.toLowerCase()}.`,
  });
  return { id: updated.id, status: updated.status };
}

/** Mark attendance for one staff member on one day (upsert). */
export async function markAttendance(ctx: AuthContext, input: z.infer<typeof attendanceSchema>) {
  const staff = await db.staffMember.findFirst({ where: { id: input.staffId, ...base(ctx) } });
  if (!staff) throw NotFound("Staff member not found in this facility.");

  const dayStart = new Date(`${input.date}T00:00:00.000Z`);
  const parseTime = (t?: string | null) =>
    t ? new Date(`${input.date}T${t}:00.000Z`) : null;

  const log = await db.attendanceLog.upsert({
    where: { staffId_date: { staffId: staff.id, date: dayStart } },
    create: {
      orgId: ctx.orgId, facilityId: ctx.facilityId, staffId: staff.id, date: dayStart,
      status: input.status, checkInAt: parseTime(input.checkInAt), checkOutAt: parseTime(input.checkOutAt),
      note: input.note ?? null,
    },
    update: {
      status: input.status,
      checkInAt: parseTime(input.checkInAt),
      checkOutAt: parseTime(input.checkOutAt),
      note: input.note ?? null,
    },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "hr.attendance_marked", entityType: "AttendanceLog", entityId: log.id,
    summary: `Attendance for ${staff.name} on ${input.date}: ${input.status}.`,
  });
  return { id: log.id, status: log.status };
}

/** Create a performance review. */
export async function createReview(ctx: AuthContext, input: z.infer<typeof reviewSchema>) {
  const staff = await db.staffMember.findFirst({ where: { id: input.staffId, ...base(ctx) } });
  if (!staff) throw NotFound("Staff member not found in this facility.");
  const review = await db.performanceReview.create({
    data: {
      orgId: ctx.orgId, facilityId: ctx.facilityId, staffId: staff.id,
      period: input.period, reviewerName: ctx.userName, overallScore: input.overallScore,
      strengths: input.strengths ?? null, improvements: input.improvements ?? null, goals: input.goals ?? null,
    },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "hr.review_created", entityType: "PerformanceReview", entityId: review.id,
    summary: `Performance review for ${staff.name} (${input.period}, score ${input.overallScore}/5).`,
  });
  return { id: review.id };
}

/** Record a certification for any staff member (HR authority). */
export async function addCertificationHr(ctx: AuthContext, input: z.infer<typeof hrCertificationSchema>) {
  const staff = await db.staffMember.findFirst({ where: { id: input.staffId, ...base(ctx) } });
  if (!staff) throw NotFound("Staff member not found in this facility.");
  const cert = await db.staffCertification.create({
    data: { orgId: ctx.orgId, staffId: staff.id, name: input.name, expiresAt: new Date(`${input.expiresAt}T00:00:00.000Z`) },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "hr.certification_added", entityType: "StaffCertification", entityId: cert.id,
    summary: `Certification "${input.name}" recorded for ${staff.name}.`,
  });
  return { id: cert.id };
}

/** Facility-wide or role-targeted announcement delivered to dashboard inboxes. */
export async function announce(ctx: AuthContext, input: z.infer<typeof announcementSchema>) {
  const membershipWhere: Record<string, unknown> = {
    orgId: ctx.orgId,
    active: true,
    user: { status: "ACTIVE", facilityMemberships: { some: { facilityId: ctx.facilityId } } },
  };
  if (input.role) membershipWhere.role = input.role;

  const members = await db.membership.findMany({ where: membershipWhere, select: { userId: true } });
  const userIds = [...new Set(members.map((m) => m.userId))];
  if (userIds.length === 0) throw NotFound("No active staff matched the announcement target.");

  const type = input.urgency === "NORMAL" ? "ANNOUNCEMENT" : `ANNOUNCEMENT_${input.urgency}`;
  await db.notification.createMany({
    data: userIds.map((userId) => ({
      orgId: ctx.orgId, userId, type, title: input.title, body: input.body,
    })),
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "hr.announcement", entityType: "Notification", entityId: null,
    summary: `Announcement "${input.title}" sent to ${userIds.length} staff member(s)${input.role ? ` (${input.role})` : ""}.`,
  });
  return { delivered: userIds.length };
}
