// Automation layer (spec §31, §134): event outbox dispatch, workflow +
// webhook fan-out, report/document generation actions, and the scheduled
// trigger library (appointment missed, invoice overdue, stock alerts…).

import { db } from "@/lib/db";
import { systemContext } from "./workflows";
import { queueWebhookDeliveries, processWebhookDeliveries } from "./webhooks";
import { revenueReport } from "./reports";
import type { AuthContext } from "@/lib/auth";

export const EVENT_TYPES = [
  "ENCOUNTER_COMPLETED", "PATIENT_REGISTERED", "APPOINTMENT_MISSED", "PAYMENT_RECEIVED",
  "INVOICE_OVERDUE", "FOLLOWUP_DUE", "STOCK_BELOW_THRESHOLD", "STOCK_EXPIRING",
  "LAB_RESULT_RELEASED", "CUSTOM_WEBHOOK",
] as const;

/** Persist an event to the outbox. Transactional writers call this. */
export async function emitEvent(orgId: string, type: string, payload: Record<string, unknown>) {
  await db.outboxEvent.create({ data: { orgId, type, payload: JSON.stringify(payload) } });
}

/** Process unprocessed outbox events: fan out to workflows + webhooks. */
export async function processOutbox(orgId: string, limit = 25) {
  const events = await db.outboxEvent.findMany({
    where: { orgId, processedAt: null, dispatchAttempts: { lt: 5 } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let handled = 0;
  for (const event of events) {
    try {
      const payload = JSON.parse(event.payload || "{}") as Record<string, unknown>;
      const org = await db.organization.findUnique({
        where: { id: orgId },
        select: { currency: true, timezone: true, facilities: { select: { id: true, serviceProfileKey: true }, orderBy: { createdAt: "asc" }, take: 1 } },
      });
      const ctx = systemContext(orgId, org?.facilities[0]?.id ?? "", org?.currency, org?.timezone, org?.facilities[0]?.serviceProfileKey);
      await triggerWorkflowsSafe(ctx, event.type, payload);
      await queueWebhookDeliveries(orgId, event.type, payload);
      await db.outboxEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), lastError: null } });
      handled++;
    } catch (e) {
      await db.outboxEvent.update({
        where: { id: event.id },
        data: { dispatchAttempts: { increment: 1 }, lastError: e instanceof Error ? e.message : String(e) },
      });
    }
  }
  return { events: events.length, handled };
}

async function triggerWorkflowsSafe(ctx: AuthContext, type: string, payload: Record<string, unknown>) {
  const { triggerWorkflowsForEvent } = await import("./workflows");
  try {
    await triggerWorkflowsForEvent(ctx, type, payload);
  } catch (e) {
    console.error("[automation] workflow trigger failed", type, e);
  }
}

// ─── Report / document generation actions ───────────────────────────────────

const REPORT_KEYS = ["REVENUE_SUMMARY", "PATIENT_VOLUME"] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export async function generateWorkflowReport(
  ctx: AuthContext,
  facilityId: string,
  reportKey: string,
  title: string,
  sourceRunId: string | null,
) {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 3600 * 1000);
  let sections: unknown;
  if (reportKey === "PATIENT_VOLUME") {
    const { patientVolumeReport } = await import("./reports");
    sections = await patientVolumeReport(ctx, from, to);
  } else {
    sections = await revenueReport(ctx, from, to);
  }
  return db.generatedDocument.create({
    data: {
      orgId: ctx.orgId,
      facilityId,
      kind: "REPORT",
      title,
      contentJson: JSON.stringify({ reportKey, from: from.toISOString(), to: to.toISOString(), data: sections }),
      sourceId: sourceRunId,
      createdById: ctx.userId,
    },
  });
}

// ─── Scheduled trigger library (scheduler jobs) ─────────────────────────────

/** Marks no-shows (SCHEDULED in the past beyond grace) and emits events. */
export async function detectMissedAppointments(orgId: string) {
  const grace = new Date(Date.now() - 2 * 3600 * 1000);
  const missed = await db.appointment.findMany({
    where: { orgId, status: "SCHEDULED", scheduledAt: { lt: grace } },
    select: { id: true, orgId: true, facilityId: true, patientId: true, scheduledAt: true },
    take: 100,
  });
  for (const appt of missed) {
    await db.appointment.update({ where: { id: appt.id }, data: { status: "NO_SHOW" } });
    await emitEvent(orgId, "APPOINTMENT_MISSED", {
      refId: appt.id, appointmentId: appt.id, facilityId: appt.facilityId, patientId: appt.patientId,
      scheduledAt: appt.scheduledAt.toISOString(),
    });
  }
  return missed.length;
}

/** Emits INVOICE_OVERDUE for ISSUED/PARTIALLY_PAID invoices older than 14 days. */
export async function detectOverdueInvoices(orgId: string) {
  const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const overdue = await db.invoice.findMany({
    where: { orgId, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, createdAt: { lt: cutoff }, voidedAt: null },
    select: { id: true, number: true, facilityId: true, patientId: true, totalMinor: true, amountPaidMinor: true, currency: true },
    take: 100,
  });
  for (const inv of overdue) {
    const fingerprint = `INVOICE_OVERDUE:${inv.id}`;
    const existing = await db.outboxEvent.findFirst({ where: { orgId, type: "INVOICE_OVERDUE", payload: { contains: inv.id } } });
    if (existing) continue;
    await emitEvent(orgId, "INVOICE_OVERDUE", {
      refId: inv.id, invoiceId: inv.id, invoiceNumber: inv.number, facilityId: inv.facilityId,
      patientId: inv.patientId, totalMinor: inv.totalMinor, amountPaidMinor: inv.amountPaidMinor, currency: inv.currency,
    });
    void fingerprint;
  }
  return overdue.length;
}

/** Emits STOCK_BELOW_THRESHOLD and STOCK_EXPIRING (within 60 days) events. */
export async function detectInventoryAlerts(orgId: string) {
  const items = await db.inventoryItem.findMany({
    where: { orgId, active: true },
    select: { id: true, name: true, sku: true, facilityId: true, reorderLevel: true, lots: { select: { qtyRemaining: true, expiresAt: true } } },
  });
  let low = 0;
  let expiring = 0;
  for (const item of items) {
    const onHand = item.lots.reduce((sum, lot) => sum + lot.qtyRemaining, 0);
    if (onHand <= item.reorderLevel) {
      const seen = await db.outboxEvent.count({ where: { orgId, type: "STOCK_BELOW_THRESHOLD", createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) }, payload: { contains: item.id } } });
      if (seen === 0) {
        await emitEvent(orgId, "STOCK_BELOW_THRESHOLD", { refId: item.id, itemId: item.id, name: item.name, sku: item.sku, facilityId: item.facilityId, onHand, reorderLevel: item.reorderLevel });
        low++;
      }
    }
    const expSoon = item.lots.some((lot) => lot.expiresAt && lot.expiresAt > new Date() && lot.expiresAt < new Date(Date.now() + 60 * 24 * 3600 * 1000) && lot.qtyRemaining > 0);
    if (expSoon) {
      const seen = await db.outboxEvent.count({ where: { orgId, type: "STOCK_EXPIRING", createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) }, payload: { contains: item.id } } });
      if (seen === 0) {
        await emitEvent(orgId, "STOCK_EXPIRING", { refId: item.id, itemId: item.id, name: item.name, sku: item.sku, facilityId: item.facilityId });
        expiring++;
      }
    }
  }
  return { low, expiring };
}

/** Emits FOLLOWUP_DUE for pending follow-ups due within 24h. */
export async function detectDueFollowUps(orgId: string) {
  const soon = new Date(Date.now() + 24 * 3600 * 1000);
  const due = await db.followUp.findMany({
    where: { orgId, status: "PENDING", dueAt: { lte: soon } },
    select: { id: true, facilityId: true, patientId: true, title: true, dueAt: true },
    take: 100,
  });
  for (const fu of due) {
    const seen = await db.outboxEvent.count({ where: { orgId, type: "FOLLOWUP_DUE", createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) }, payload: { contains: fu.id } } });
    if (seen === 0) {
      await emitEvent(orgId, "FOLLOWUP_DUE", { refId: fu.id, followUpId: fu.id, facilityId: fu.facilityId, patientId: fu.patientId, title: fu.title, dueAt: fu.dueAt.toISOString() });
    }
  }
  return due.length;
}

/** Runs every scheduler job for an org once per tick. */
export async function schedulerTick(orgId: string) {
  const { schedulerSweep } = await import("./workflows");
  const [woken, outbox, webhooks, missed, overdue, stock, followups] = await Promise.all([
    schedulerSweep(orgId),
    processOutbox(orgId),
    processWebhookDeliveries(orgId),
    detectMissedAppointments(orgId),
    detectOverdueInvoices(orgId),
    detectInventoryAlerts(orgId),
    detectDueFollowUps(orgId),
  ]);
  await runScheduledWorkflows(orgId);
  await slaSweep(orgId);
  return { woken, outbox, webhooks, missed, overdue, stock, followups };
}

/** Fire SCHEDULED workflows that are due (everyMinutes / dailyAt). */
async function runScheduledWorkflows(orgId: string) {
  const defs = await db.workflowDef.findMany({ where: { orgId, status: "PUBLISHED" } });
  const now = new Date();
  for (const def of defs) {
    let parsed: { trigger?: string; schedule?: { everyMinutes?: number; dailyAt?: string } };
    try {
      parsed = JSON.parse(def.definition) as typeof parsed;
    } catch {
      continue;
    }
    if (parsed.trigger !== "SCHEDULED" || !parsed.schedule) continue;
    const lastRun = await db.workflowRun.findFirst({
      where: { orgId, workflowDefId: def.id, dryRun: false },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });
    const { everyMinutes, dailyAt } = parsed.schedule;
    let due = false;
    if (everyMinutes && everyMinutes > 0) {
      due = !lastRun || now.getTime() - lastRun.startedAt.getTime() >= everyMinutes * 60_000;
    } else if (dailyAt) {
      const [h, m] = dailyAt.split(":").map(Number);
      const todayAt = new Date(now);
      todayAt.setHours(h, m, 0, 0);
      due = !lastRun ? now >= todayAt : (lastRun.startedAt < todayAt && now >= todayAt);
    }
    if (!due) continue;
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { currency: true, timezone: true, facilities: { select: { id: true, serviceProfileKey: true }, orderBy: { createdAt: "asc" }, take: 1 } },
    });
    const ctx = systemContext(orgId, org?.facilities[0]?.id ?? "", org?.currency, org?.timezone, org?.facilities[0]?.serviceProfileKey);
    const { runWorkflow } = await import("./workflows");
    await runWorkflow(ctx, def.id, "SCHEDULED", { refId: `sched-${now.getTime()}` }, { correlationId: `${def.id}:sched:${now.toISOString().slice(0, 16)}` });
  }
}

/** SLA sweep: notify once on breach of workflow task SLAs + run-level SLA. */
async function slaSweep(orgId: string) {
  const now = new Date();
  const breached = await db.task.findMany({
    where: { orgId, status: "OPEN", dueAt: { lt: now }, slaNotifiedAt: null, source: { in: ["WORKFLOW", "AI", "USER"] } },
    take: 50,
  });
  for (const task of breached) {
    await db.task.update({ where: { id: task.id }, data: { slaNotifiedAt: now } });
    await db.notification.create({
      data: {
        orgId,
        role: task.role ?? "ADMIN",
        type: "SLA_BREACH",
        title: `SLA breached: ${task.title}`,
        body: `Task was due ${task.dueAt?.toISOString() ?? "earlier"} and is still open.`,
      },
    });
  }
  // Run-level SLA on active runs
  const runs = await db.workflowRun.findMany({
    where: { orgId, status: "RUNNING", slaBreachedAt: null, workflowDef: { slaMinutes: { not: null } } },
    include: { workflowDef: { select: { slaMinutes: true, name: true } } },
    take: 50,
  });
  for (const run of runs) {
    const slaMin = run.workflowDef.slaMinutes ?? 0;
    if (slaMin > 0 && now.getTime() - run.startedAt.getTime() > slaMin * 60_000) {
      await db.workflowRun.update({ where: { id: run.id }, data: { slaBreachedAt: now } });
      await db.notification.create({
        data: { orgId, role: "ADMIN", type: "SLA_BREACH", title: `Workflow SLA breached: ${run.workflowDef.name}`, body: `Run ${run.id} exceeded ${slaMin} minutes.` },
      });
    }
  }
}
