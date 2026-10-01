// Workflow engine v2 - durable, declarative, no executable code (spec §29–31, §133).
//
// Architecture (ADR 0006):
// - Definitions are versioned JSON graphs; only whitelisted node types with
//   typed configs are allowed. Arbitrary code never runs.
// - Every node execution is persisted as a WorkflowRunNode row (durable state,
//   attempts, idempotency key, output) so crashes resume exactly where they
//   stopped - the DB, not setTimeout, is the source of truth.
// - Transient waits (DELAY nodes, retry backoff, approvals) park the run and
//   are woken by the durable scheduler (src/lib/scheduler.ts).
// - Failures retry up to 3 attempts with exponential backoff, then dead-letter
//   the node and fail the run with the error recorded.
// - DRY-RUN executes the full graph with all side effects suppressed and every
//   action recorded as "would …" - used by the builder before publishing.
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, NotFound } from "@/lib/api";
import { sendCommunication } from "@/lib/comms";
import type { AuthContext } from "@/lib/auth";

export const NODE_TYPES = [
  "CREATE_FOLLOWUP", "CREATE_TASK", "NOTIFY", "SEND_EMAIL", "SEND_SMS", "SEND_WHATSAPP",
  "CREATE_APPOINTMENT", "GENERATE_REPORT", "GENERATE_DOCUMENT", "INVOKE_WEBHOOK",
  "DELAY", "CONDITION", "APPROVAL", "UPDATE_RECORD",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const TRIGGERS = [
  "MANUAL", "ENCOUNTER_COMPLETED", "PATIENT_REGISTERED", "APPOINTMENT_MISSED",
  "PAYMENT_RECEIVED", "INVOICE_OVERDUE", "FOLLOWUP_DUE", "STOCK_BELOW_THRESHOLD",
  "STOCK_EXPIRING", "LAB_RESULT_RELEASED", "CUSTOM_WEBHOOK", "SCHEDULED",
] as const;

export type TriggerType = (typeof TRIGGERS)[number];

export interface WorkflowNode {
  id: string;
  type: NodeType;
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  label?: "true" | "false"; // CONDITION branches
}

export interface WorkflowDefinition {
  trigger: TriggerType;
  schedule?: { everyMinutes?: number; dailyAt?: string };
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

const MAX_NODE_ATTEMPTS = 3;

type TxLike = Parameters<Parameters<typeof db.$transaction>[0]>[0];

// ─── Validation ─────────────────────────────────────────────────────────────

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/** Config requirements per node type - validated at save/publish/run time. */
function configIssues(node: WorkflowNode): string[] {
  const c = node.config ?? {};
  const issues: string[] = [];
  const needStr = (key: string) => { if (!asString(c[key])) issues.push(`${node.id}: ${key} is required`); };
  switch (node.type) {
    case "CREATE_FOLLOWUP": needStr("title"); break;
    case "CREATE_TASK": needStr("title"); break;
    case "NOTIFY": needStr("title"); break;
    case "SEND_EMAIL": needStr("to"); needStr("subject"); needStr("body"); break;
    case "SEND_SMS":
    case "SEND_WHATSAPP": needStr("to"); needStr("body"); break;
    case "CREATE_APPOINTMENT": needStr("patientId"); break;
    case "GENERATE_REPORT": needStr("reportKey"); break;
    case "GENERATE_DOCUMENT": needStr("template"); needStr("title"); break;
    case "INVOKE_WEBHOOK": needStr("event"); break;
    case "DELAY": {
      const m = Number(c.minutes);
      if (!Number.isFinite(m) || m <= 0) issues.push(`${node.id}: minutes must be > 0`);
      break;
    }
    case "CONDITION": needStr("field"); needStr("operator"); break;
    case "APPROVAL": needStr("title"); break;
    case "UPDATE_RECORD": break;
    default: issues.push(`${node.id}: unknown type`);
  }
  return issues;
}

export function validateDefinition(raw: string): WorkflowDefinition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError(400, "bad_request", "Workflow definition must be valid JSON.");
  }
  const def = parsed as WorkflowDefinition;
  if (!def || !Array.isArray(def.nodes) || !Array.isArray(def.edges)) {
    throw new AppError(400, "bad_request", "Workflow definition requires nodes and edges arrays.");
  }
  if (!TRIGGERS.includes(def.trigger)) {
    throw new AppError(400, "bad_request", `Trigger must be one of ${TRIGGERS.join(", ")}.`);
  }
  if (def.nodes.length === 0 || def.nodes.length > 50) {
    throw new AppError(400, "bad_request", "Workflow must contain 1–50 nodes.");
  }
  const ids = new Set<string>();
  for (const node of def.nodes) {
    if (!node.id || typeof node.id !== "string" || ids.has(node.id)) {
      throw new AppError(400, "bad_request", "Node ids must be unique non-empty strings.");
    }
    ids.add(node.id);
    if (!NODE_TYPES.includes(node.type)) {
      throw new AppError(400, "bad_request", `Node type "${node.type}" is not allowed. Arbitrary code is not permitted.`);
    }
    const issues = configIssues(node);
    if (issues.length) throw new AppError(400, "bad_request", issues.join("; "));
  }
  for (const edge of def.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new AppError(400, "bad_request", "Edges must reference existing nodes.");
    }
  }
  // CONDITION nodes must have true/false branches; all nodes reachable except detached tails.
  for (const node of def.nodes.filter((n) => n.type === "CONDITION")) {
    const out = def.edges.filter((e) => e.from === node.id);
    if (!out.some((e) => e.label === "true") || !out.some((e) => e.label === "false")) {
      throw new AppError(400, "bad_request", `Condition node ${node.id} needs labeled true/false edges.`);
    }
  }
  if (def.trigger === "SCHEDULED") {
    const s = def.schedule ?? {};
    if (!s.everyMinutes && !s.dailyAt) {
      throw new AppError(400, "bad_request", "Scheduled workflows need schedule.everyMinutes or schedule.dailyAt (HH:MM).");
    }
    if (s.dailyAt && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.dailyAt)) {
      throw new AppError(400, "bad_request", "schedule.dailyAt must be HH:MM.");
    }
  }
  return def;
}

// ─── Payload helpers ────────────────────────────────────────────────────────

function interpolate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split(".").reduce<unknown>((acc, key) =>
      acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined, payload);
    return value === undefined || value === null ? "" : String(value);
  });
}

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | null {
  const v = payload[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

// ─── Node execution (side effects; suppressed under dryRun) ─────────────────

interface ExecEnv {
  ctx: AuthContext;
  runId: string;
  dryRun: boolean;
  payload: Record<string, unknown>;
  facilityId: string;
}

async function execNode(env: ExecEnv, node: WorkflowNode): Promise<Record<string, unknown>> {
  const { ctx, dryRun, payload, facilityId } = env;
  const c = node.config ?? {};
  const str = (k: string, fallback = "") => interpolate(asString(c[k]) ?? fallback, payload);
  const patientId = payloadString(payload, "patientId");
  const would = (what: string): Record<string, unknown> => ({ would: what });

  switch (node.type) {
    case "CREATE_FOLLOWUP": {
      if (!patientId) return { skipped: "no patient in payload" };
      if (dryRun) return would(`create follow-up "${str("title")}"`);
      const days = Number(c.days ?? 7);
      const fu = await db.followUp.create({
        data: {
          orgId: ctx.orgId, facilityId, patientId,
          title: str("title", "Follow-up"),
          dueAt: new Date(Date.now() + days * 24 * 3600 * 1000),
          status: "PENDING",
        },
      });
      return { created: "FollowUp", id: fu.id };
    }
    case "CREATE_TASK": {
      if (dryRun) return would(`create task "${str("title")}"`);
      const task = await db.task.create({
        data: {
          orgId: ctx.orgId, facilityId,
          title: str("title", "Workflow task"),
          description: asString(c.description) ? str("description") : null,
          role: asString(c.role) ?? null,
          priority: asString(c.priority) ?? "NORMAL",
          dueAt: Number(c.slaMinutes) > 0 ? new Date(Date.now() + Number(c.slaMinutes) * 60_000) : null,
          kind: "GENERAL",
          source: "WORKFLOW",
          sourceId: env.runId,
        },
      });
      return { created: "Task", id: task.id };
    }
    case "NOTIFY": {
      const channels = Array.isArray(c.channels) && c.channels.length
        ? (c.channels as string[]) : ["IN_APP"];
      if (dryRun) return would(`notify (${channels.join(",")}) "${str("title")}"`);
      if (channels.includes("IN_APP")) {
        await db.notification.create({
          data: {
            orgId: ctx.orgId,
            role: asString(c.role) ?? null,
            type: "WORKFLOW",
            title: str("title", "Workflow notification"),
            body: asString(c.body) ? str("body") : null,
          },
        });
      }
      for (const ch of channels.filter((x) => x !== "IN_APP")) {
        await sendCommunication({
          orgId: ctx.orgId, facilityId,
          channel: ch as "EMAIL" | "SMS" | "WHATSAPP",
          type: asString(c.type) ?? "WORKFLOW_NOTIFY",
          recipient: asString(c.role) ?? payloadString(payload, "patientEmail") ?? payloadString(payload, "patientPhone"),
          subject: str("title"), body: str("body", str("title")),
          source: "WORKFLOW", sourceId: env.runId,
        });
      }
      return { notified: channels };
    }
    case "SEND_EMAIL":
    case "SEND_SMS":
    case "SEND_WHATSAPP": {
      const channel = node.type === "SEND_EMAIL" ? "EMAIL" : node.type === "SEND_SMS" ? "SMS" : "WHATSAPP";
      const to = str("to") || payloadString(payload, "patientEmail") || payloadString(payload, "patientPhone") || "";
      if (!to) return { skipped: "no recipient" };
      if (dryRun) return would(`send ${channel} to ${to}`);
      const result = await sendCommunication({
        orgId: ctx.orgId, facilityId, channel,
        type: asString(c.type) ?? "WORKFLOW_MESSAGE",
        recipient: to,
        subject: node.type === "SEND_EMAIL" ? str("subject") : null,
        body: str("body"),
        source: "WORKFLOW", sourceId: env.runId,
      });
      return { channel, status: result.status, providerRef: result.providerRef ?? null };
    }
    case "CREATE_APPOINTMENT": {
      const pid = payloadString(payload, "patientId");
      if (!pid) return { skipped: "no patient in payload" };
      if (dryRun) return would(`create appointment in ${Number(c.daysAhead ?? 1)} day(s)`);
      const daysAhead = Number(c.daysAhead ?? 1);
      const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000);
      start.setHours(Number(c.hour ?? 9), Number(c.minute ?? 0), 0, 0);
      const appt = await db.appointment.create({
        data: {
          orgId: ctx.orgId, facilityId, patientId: pid,
          scheduledAt: start, durationMin: Number(c.durationMin ?? 30),
          status: "SCHEDULED", notes: str("notes", "Created by workflow"),
          createdById: ctx.userId,
        },
      });
      return { created: "Appointment", id: appt.id };
    }
    case "GENERATE_REPORT": {
      const { generateWorkflowReport } = await import("./automation");
      if (dryRun) return would(`generate report ${str("reportKey")}`);
      const doc = await generateWorkflowReport(ctx, facilityId, str("reportKey", "REVENUE_SUMMARY"), str("title", "Workflow report"), env.runId);
      return { created: "GeneratedDocument", id: doc.id };
    }
    case "GENERATE_DOCUMENT": {
      if (dryRun) return would(`generate document "${str("title")}"`);
      const doc = await db.generatedDocument.create({
        data: {
          orgId: ctx.orgId, facilityId,
          kind: "WORKFLOW_DOC",
          title: str("title", "Workflow document"),
          contentJson: JSON.stringify({ template: asString(c.template), body: str("body"), payload }),
          sourceId: env.runId,
          createdById: ctx.userId,
        },
      });
      return { created: "GeneratedDocument", id: doc.id };
    }
    case "INVOKE_WEBHOOK": {
      const { queueWebhookDeliveries } = await import("./webhooks");
      if (dryRun) return would(`invoke webhooks for ${str("event")}`);
      const queued = await queueWebhookDeliveries(ctx.orgId, str("event", "WORKFLOW_EVENT"), {
        runId: env.runId, facilityId, payload,
      });
      return { queued };
    }
    case "DELAY": {
      const minutes = Number(c.minutes ?? 0);
      return { sleeping: true, minutes };
    }
    case "CONDITION": {
      // Actual branch resolution happens in the step machine via edge labels.
      return { evaluated: str("field") };
    }
    case "UPDATE_RECORD": {
      // Deliberately narrow: complete a follow-up supplied in the payload.
      const fuId = payloadString(payload, "followUpId");
      if (!fuId) return { skipped: "no followUpId" };
      if (dryRun) return would(`complete follow-up ${fuId}`);
      await db.followUp.updateMany({ where: { id: fuId, orgId: ctx.orgId }, data: { status: "COMPLETED" } });
      return { updated: "FollowUp", id: fuId };
    }
    default:
      return { skipped: "unknown node" };
  }
}

// ─── Condition evaluation ───────────────────────────────────────────────────

function evaluateCondition(node: WorkflowNode, payload: Record<string, unknown>): boolean {
  const field = asString(node.config.field) ?? "";
  const operator = asString(node.config.operator) ?? "eq";
  const expected = asString(node.config.value) ?? "";
  const actual = field.split(".").reduce<unknown>((acc, k) =>
    acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined, payload);
  switch (operator) {
    case "exists": return actual !== undefined && actual !== null && actual !== "";
    case "eq": return String(actual ?? "") === expected;
    case "neq": return String(actual ?? "") !== expected;
    case "gt": return Number(actual) > Number(expected);
    case "lt": return Number(actual) < Number(expected);
    default: return false;
  }
}

function nextNode(def: WorkflowDefinition, current: WorkflowNode, payload: Record<string, unknown>): string | null {
  const out = def.edges.filter((e) => e.from === current.id);
  if (current.type === "CONDITION") {
    const branch = evaluateCondition(current, payload) ? "true" : "false";
    return out.find((e) => e.label === branch)?.to ?? null;
  }
  if (out.length === 0) return null;
  if (out.length > 1) throw new AppError(400, "bad_request", `Node ${current.id} branches without a CONDITION.`);
  return out[0].to;
}

// ─── Run creation ───────────────────────────────────────────────────────────

export async function runWorkflow(
  ctx: AuthContext,
  workflowDefId: string,
  triggerType: string,
  payload: Record<string, unknown>,
  opts: { dryRun?: boolean; correlationId?: string } = {},
) {
  const def = await db.workflowDef.findFirst({ where: { id: workflowDefId, orgId: ctx.orgId } });
  if (!def) throw NotFound("Workflow not found.");
  if (def.status !== "PUBLISHED" && !opts.dryRun) {
    throw new AppError(409, "invalid_state", "Only published workflows can run.");
  }
  const parsed = validateDefinition(def.definition);

  if (!opts.dryRun && opts.correlationId) {
    const dupe = await db.workflowRun.findFirst({
      where: { orgId: ctx.orgId, workflowDefId: def.id, correlationId: opts.correlationId, status: { in: ["RUNNING", "COMPLETED"] } },
      select: { id: true },
    });
    if (dupe) return { ...dupe, deduped: true as const };
  }

  const run = await db.workflowRun.create({
    data: {
      orgId: ctx.orgId,
      workflowDefId: def.id,
      version: def.version,
      triggerType,
      triggerRefId: payloadString(payload, "encounterId") ?? payloadString(payload, "refId") ?? null,
      correlationId: opts.correlationId ?? null,
      dryRun: opts.dryRun ?? false,
      status: "RUNNING",
      state: JSON.stringify({ payload }),
    },
  });
  await db.workflowRunNode.createMany({
    data: parsed.nodes.map((n) => ({
      orgId: ctx.orgId, runId: run.id, nodeKey: n.id, type: n.type, status: "PENDING",
    })),
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: opts.dryRun ? "workflow.dry_run" : "workflow.started", entityType: "WorkflowRun", entityId: run.id,
    summary: `${opts.dryRun ? "Dry-run" : "Run"} of "${def.name}" v${def.version} (trigger ${triggerType}).`,
  });
  await processRun(ctx, run.id);
  return { id: run.id, deduped: false as const };
}

// ─── Durable step machine ───────────────────────────────────────────────────

/**
 * Advances a run as far as it can go. Pausing states (SLEEPING, WAITING_APPROVAL)
 * return cleanly; the scheduler or an approval decision calls this again.
 */
export async function processRun(ctx: AuthContext, runId: string): Promise<"RUNNING" | "COMPLETED" | "FAILED" | "PARKED"> {
  const run = await db.workflowRun.findFirst({ where: { id: runId, orgId: ctx.orgId }, include: { workflowDef: true } });
  if (!run || run.status !== "RUNNING") return run?.status === "COMPLETED" ? "COMPLETED" : "FAILED";

  let def: WorkflowDefinition;
  try {
    def = validateDefinition(run.workflowDef.definition);
  } catch {
    await db.workflowRun.update({ where: { id: runId }, data: { status: "FAILED", lastError: "definition invalid" } });
    return "FAILED";
  }
  const state = JSON.parse(run.state || "{}") as { payload?: Record<string, unknown> };
  const payload = state.payload ?? {};
  const dryRun = run.dryRun;
  const env: ExecEnv = { ctx, runId, dryRun, payload, facilityId: ctx.facilityId };

  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const nodeRows = await db.workflowRunNode.findMany({ where: { runId } });
  const rowByKey = new Map(nodeRows.map((r) => [r.nodeKey, r]));

  // Entry node = no incoming edge.
  let currentId: string | null = def.nodes.find((n) => !def.edges.some((e) => e.to === n.id))?.id ?? def.nodes[0]?.id ?? null;
  let guard = 0;

  while (currentId && guard++ < 100) {
    const node = byId.get(currentId);
    if (!node) break;
    const row = rowByKey.get(currentId)!;

    if (row.status === "COMPLETED" || row.status === "SKIPPED") {
      currentId = nextNode(def, node, payload);
      continue;
    }
    if (row.status === "SLEEPING") {
      if (row.wakeAt && row.wakeAt > new Date()) return "PARKED";
      // timer elapsed → continue to next node
      await db.workflowRunNode.update({ where: { id: row.id }, data: { status: "COMPLETED", output: JSON.stringify({ timer: "elapsed" }), wakeAt: null } });
      currentId = nextNode(def, node, payload);
      continue;
    }
    if (row.status === "WAITING_APPROVAL") {
      const task = await db.task.findFirst({
        where: { orgId: ctx.orgId, sourceId: runId, kind: "APPROVAL", status: { in: ["OPEN", "COMPLETED"] }, decision: { not: null } },
        orderBy: { createdAt: "desc" },
      });
      if (!task || !task.decision) return "PARKED";
      await db.workflowRunNode.update({
        where: { id: row.id },
        data: { status: "COMPLETED", decidedAt: new Date(), output: JSON.stringify({ decision: task.decision }) },
      });
      if (task.decision === "REJECTED") {
        // Rejection short-circuits: mark remaining nodes skipped and complete the run.
        await db.workflowRunNode.updateMany({ where: { runId, status: "PENDING" }, data: { status: "SKIPPED" } });
        await db.workflowRun.update({ where: { id: runId }, data: { status: "COMPLETED", completedAt: new Date(), state: JSON.stringify({ payload, approval: "REJECTED" }) } });
        return "COMPLETED";
      }
      currentId = nextNode(def, node, payload);
      continue;
    }
    if (row.attempts >= MAX_NODE_ATTEMPTS) {
      await db.workflowRunNode.update({ where: { id: row.id }, data: { status: "FAILED", error: "max attempts reached" } });
      await db.workflowRun.update({ where: { id: runId }, data: { status: "FAILED", lastError: `node ${node.id} dead-lettered`, completedAt: new Date() } });
      return "FAILED";
    }

    const idempotencyKey = `${runId}:${node.id}:${row.attempts}`;
    await db.workflowRunNode.update({ where: { id: row.id }, data: { status: "RUNNING", attempts: { increment: 1 }, idempotencyKey, error: null } });
    try {
      const result = await execNode(env, node);
      if (result.sleeping) {
        const wakeAt = new Date(Date.now() + Number(result.minutes ?? 1) * 60_000);
        await db.workflowRunNode.update({ where: { id: row.id }, data: { status: "SLEEPING", wakeAt, output: JSON.stringify(result) } });
        return "PARKED";
      }
      if (node.type === "APPROVAL") {
        await db.task.create({
          data: {
            orgId: ctx.orgId, facilityId: ctx.facilityId,
            title: interpolate(asString(node.config.title) ?? "Approval required", payload),
            description: asString(node.config.description) ? interpolate(String(node.config.description), payload) : "Created by workflow - approve or reject to continue the run.",
            role: asString(node.config.role) ?? null,
            priority: "HIGH",
            kind: "APPROVAL",
            source: "WORKFLOW", sourceId: runId,
            dueAt: Number(node.config.slaMinutes) > 0 ? new Date(Date.now() + Number(node.config.slaMinutes) * 60_000) : null,
          },
        });
        await db.workflowRunNode.update({ where: { id: row.id }, data: { status: "WAITING_APPROVAL", output: JSON.stringify(result) } });
        return "PARKED";
      }
      await db.workflowRunNode.update({ where: { id: row.id }, data: { status: "COMPLETED", output: JSON.stringify(result) } });
      currentId = nextNode(def, node, payload);
    } catch (err) {
      const attempts = row.attempts + 1;
      const dead = attempts >= MAX_NODE_ATTEMPTS;
      await db.workflowRunNode.update({
        where: { id: row.id },
        data: {
          status: dead ? "FAILED" : "PENDING",
          error: err instanceof Error ? err.message : String(err),
          wakeAt: dead ? null : new Date(Date.now() + Math.pow(2, attempts) * 30_000),
        },
      });
      if (dead) {
        await db.workflowRun.update({ where: { id: runId }, data: { status: "FAILED", lastError: `node ${node.id}: ${String(err)}`, completedAt: new Date() } });
        return "FAILED";
      }
      return "PARKED"; // retry later via scheduler
    }
  }

  await db.workflowRun.update({ where: { id: runId }, data: { status: "COMPLETED", completedAt: new Date(), lastError: null } });
  return "COMPLETED";
}

/** Approval decision endpoint → resumes the parked run. */
export async function resolveApproval(ctx: AuthContext, taskId: string, decision: "APPROVED" | "REJECTED") {
  const task = await db.task.findFirst({ where: { id: taskId, orgId: ctx.orgId, kind: "APPROVAL" } });
  if (!task) throw NotFound("Approval task not found.");
  if (task.status !== "OPEN") throw new AppError(409, "invalid_state", "Approval already decided.");
  await db.task.update({
    where: { id: taskId },
    data: { decision, status: "COMPLETED", decidedById: ctx.userId, decidedAt: new Date(), completedAt: new Date() },
  });
  if (task.source && task.sourceId) {
    await processRun(ctx, task.sourceId);
  }
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "workflow.approval_decided", entityType: "Task", entityId: taskId,
    summary: `Approval "${task.title}" ${decision.toLowerCase()}.`,
  });
  return { ok: true };
}

// ─── Event triggering ───────────────────────────────────────────────────────

/** Trigger all published workflows registered for an event type, with dedupe. */
export async function triggerWorkflowsForEvent(ctx: AuthContext, triggerType: string, payload: Record<string, unknown>) {
  const defs = await db.workflowDef.findMany({ where: { orgId: ctx.orgId, status: "PUBLISHED" } });
  const started: string[] = [];
  for (const def of defs) {
    let parsed: WorkflowDefinition;
    try {
      parsed = validateDefinition(def.definition);
    } catch {
      continue;
    }
    if (parsed.trigger !== triggerType) continue;
    const refId = payloadString(payload, "refId") ?? payloadString(payload, "encounterId") ?? payloadString(payload, "paymentId") ?? payloadString(payload, "orderId") ?? null;
    const result = await runWorkflow(ctx, def.id, triggerType, { ...payload, refId }, {
      correlationId: refId ? `${def.id}:${refId}` : undefined,
    });
    if (!result.deduped) started.push(result.id);
  }
  return started;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function createWorkflow(ctx: AuthContext, input: { key: string; name: string; description?: string; definition: string; slaMinutes?: number }) {
  validateDefinition(input.definition);
  const existing = await db.workflowDef.findFirst({ where: { orgId: ctx.orgId, key: input.key } });
  if (existing) throw new AppError(409, "duplicate", "Workflow key already exists.");
  const def = await db.workflowDef.create({
    data: {
      orgId: ctx.orgId, key: input.key, name: input.name,
      description: input.description || null,
      definition: input.definition,
      slaMinutes: input.slaMinutes ?? null,
      status: "DRAFT", version: 1,
    },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "workflow.created", entityType: "WorkflowDef", entityId: def.id,
    summary: `Created workflow "${def.name}" (draft v1).`,
  });
  return def;
}

export async function updateWorkflow(ctx: AuthContext, id: string, input: { name?: string; description?: string; definition?: string; slaMinutes?: number | null }) {
  const def = await db.workflowDef.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!def) throw NotFound("Workflow not found.");
  if (def.status === "PUBLISHED" && input.definition) {
    // Publishing is immutable: editing a published definition creates version+1 as DRAFT.
    const next = await db.workflowDef.create({
      data: {
        orgId: ctx.orgId, key: def.key, name: input.name ?? def.name,
        description: input.description ?? def.description,
        definition: input.definition!,
        slaMinutes: input.slaMinutes ?? def.slaMinutes,
        status: "DRAFT", version: def.version + 1,
      },
    });
    await audit({
      orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
      action: "workflow.new_version", entityType: "WorkflowDef", entityId: next.id,
      summary: `Draft v${next.version} of "${next.name}" created from published v${def.version}.`,
    });
    return next;
  }
  if (input.definition) validateDefinition(input.definition);
  const updated = await db.workflowDef.update({
    where: { id },
    data: {
      name: input.name ?? def.name,
      description: input.description ?? def.description,
      definition: input.definition ?? def.definition,
      slaMinutes: input.slaMinutes === undefined ? def.slaMinutes : input.slaMinutes,
    },
  });
  return updated;
}

export async function publishWorkflow(ctx: AuthContext, workflowDefId: string) {
  const def = await db.workflowDef.findFirst({ where: { id: workflowDefId, orgId: ctx.orgId } });
  if (!def) throw NotFound("Workflow not found.");
  validateDefinition(def.definition);
  const updated = await db.workflowDef.update({
    where: { id: workflowDefId },
    data: {
      status: def.status === "PUBLISHED" ? "ARCHIVED" : "PUBLISHED",
      publishedAt: def.status === "PUBLISHED" ? def.publishedAt : new Date(),
    },
  });
  // Archiving a published def keeps the latest published version runnable - archive supersedes older versions.
  if (updated.status === "PUBLISHED") {
    await db.workflowDef.updateMany({
      where: { orgId: ctx.orgId, key: def.key, status: "PUBLISHED", id: { not: def.id } },
      data: { status: "ARCHIVED" },
    });
  }
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "workflow.publish_toggled", entityType: "WorkflowDef", entityId: workflowDefId,
    summary: `Workflow "${def.name}" v${def.version} is now ${updated.status}.`,
  });
  return updated;
}

/** Scheduler: wake SLEEPING/retryable nodes + resolve decided approvals, per org. */
export async function schedulerSweep(orgId: string) {
  const now = new Date();
  const due = await db.workflowRunNode.findMany({
    where: {
      orgId,
      OR: [
        { status: "SLEEPING", wakeAt: { lte: now } },
        { status: "PENDING", wakeAt: { lte: now }, attempts: { gt: 0 } }, // retry backoff elapsed
      ],
    },
    select: { runId: true },
    distinct: ["runId"],
    take: 50,
  });
  if (due.length === 0) return 0;
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { currency: true, timezone: true, facilities: { select: { id: true, serviceProfileKey: true }, orderBy: { createdAt: "asc" }, take: 1 } },
  });
  const ctx = systemContext(
    orgId,
    org?.facilities[0]?.id ?? "",
    org?.currency ?? "NGN",
    org?.timezone ?? "Africa/Lagos",
    org?.facilities[0]?.serviceProfileKey ?? "GENERAL_PRACTICE",
  );
  for (const { runId } of due) {
    const run = await db.workflowRun.findFirst({ where: { id: runId, orgId, status: "RUNNING" } });
    if (!run) continue;
    await processRun(ctx, runId);
  }
  return due.length;
}

/** A minimal AuthContext for scheduler-driven runs (no human actor). */
export function systemContext(orgId: string, facilityId: string, currency = "NGN", timezone = "Africa/Lagos", serviceProfileKey = "GENERAL_PRACTICE"): AuthContext {
  return {
    userId: "system",
    userName: "Scheduler",
    email: "system@curavilo.local",
    orgId,
    orgName: "",
    currency,
    timezone,
    facilityId,
    facilityName: "",
    serviceProfileKey,
    role: "SYSTEM",
    permissions: [],
    sessionId: "system",
    status: "ACTIVE",
    mustChangePassword: false,
    department: null,
    serviceLine: serviceProfileKey,
    staffCode: null,
    designation: null,
    customRoleId: null,
  };
}
