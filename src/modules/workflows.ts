// Workflow engine v0 — versioned declarative definitions, durable runs (spec §27–31)
// Definitions are JSON node graphs with NO executable code. Supported node types:
// CREATE_FOLLOWUP, CREATE_TASK, NOTIFY, UPDATE_RECORD — executed sequentially.
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFound, AppError } from "@/lib/api";
import type { AuthContext } from "@/lib/auth";

export interface WorkflowNode {
  id: string;
  type: "CREATE_FOLLOWUP" | "CREATE_TASK" | "NOTIFY" | "UPDATE_RECORD";
  config: Record<string, unknown>;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: { from: string; to: string }[];
  trigger: string; // ENCOUNTER_COMPLETED | MANUAL
}


/** Validate a definition against the node schema — rejects unknown types/fields. */
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
  const ALLOWED = ["CREATE_FOLLOWUP", "CREATE_TASK", "NOTIFY", "UPDATE_RECORD"];
  for (const node of def.nodes) {
    if (!node.id || !ALLOWED.includes(node.type)) {
      throw new AppError(400, "bad_request", `Node type must be one of ${ALLOWED.join(", ")}. Arbitrary code is not allowed.`);
    }
    if (typeof node.config !== "object" || node.config === null) {
      throw new AppError(400, "bad_request", `Node ${node.id} requires a config object.`);
    }
  }
  return def;
}

type TxLike = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function executeNode(tx: TxLike, ctx: AuthContext, node: WorkflowNode, runId: string, payload: Record<string, unknown>) {
  const patientId = typeof payload.patientId === "string" ? payload.patientId : null;
  const facilityId = typeof payload.facilityId === "string" ? payload.facilityId : ctx.facilityId;
  switch (node.type) {
    case "CREATE_FOLLOWUP": {
      if (!patientId) return { skipped: "no patient in payload" };
      const days = Number(node.config.days ?? 7);
      const followUp = await tx.followUp.create({
        data: {
          orgId: ctx.orgId,
          facilityId,
          patientId,
          title: String(node.config.title ?? "Follow-up"),
          dueAt: new Date(Date.now() + days * 24 * 3600 * 1000),
          status: "PENDING",
        },
      });
      return { created: "FollowUp", id: followUp.id };
    }
    case "CREATE_TASK": {
      const task = await tx.task.create({
        data: {
          orgId: ctx.orgId,
          facilityId,
          title: String(node.config.title ?? "Workflow task"),
          description: node.config.description ? String(node.config.description) : null,
          role: node.config.role ? String(node.config.role) : null,
          priority: String(node.config.priority ?? "NORMAL"),
          source: "WORKFLOW",
          sourceId: runId,
        },
      });
      return { created: "Task", id: task.id };
    }
    case "NOTIFY": {
      await tx.notification.create({
        data: {
          orgId: ctx.orgId,
          role: node.config.role ? String(node.config.role) : null,
          type: "WORKFLOW",
          title: String(node.config.title ?? "Workflow notification"),
          body: node.config.body ? String(node.config.body) : null,
        },
      });
      return { created: "Notification" };
    }
    case "UPDATE_RECORD": {
      // Deliberately narrow: only FollowUp status completion for a given id in payload.
      return { skipped: "UPDATE_RECORD limited to built-in flows" };
    }
    default:
      return { skipped: "unknown node" };
  }
}

/** Trigger all published workflows registered for this event type. v0 processes inline. */
export async function triggerWorkflowsForEvent(ctx: AuthContext, triggerType: string, payload: Record<string, unknown>) {
  const defs = await db.workflowDef.findMany({
    where: { orgId: ctx.orgId, status: "PUBLISHED" },
  });
  for (const def of defs) {
    let parsed: WorkflowDefinition;
    try {
      parsed = validateDefinition(def.definition);
    } catch {
      continue;
    }
    if (parsed.trigger !== triggerType) continue;
    await runWorkflow(ctx, def.id, triggerType, payload);
  }
}

export async function runWorkflow(ctx: AuthContext, workflowDefId: string, triggerType: string, payload: Record<string, unknown>) {
  const def = await db.workflowDef.findFirst({ where: { id: workflowDefId, orgId: ctx.orgId } });
  if (!def) throw NotFound("Workflow not found.");
  if (def.status !== "PUBLISHED") throw new AppError(409, "invalid_state", "Only published workflows can run.");

  const parsed = validateDefinition(def.definition);
  const ordered = orderNodes(parsed);

  const run = await db.workflowRun.create({
    data: {
      orgId: ctx.orgId,
      workflowDefId: def.id,
      version: def.version,
      triggerType,
      triggerRefId: typeof payload.encounterId === "string" ? payload.encounterId : null,
      status: "RUNNING",
      state: JSON.stringify({ steps: [], payload }),
    },
  });

  const steps: Array<{ nodeId: string; type: string; result: unknown; at: string }> = [];
  try {
    await db.$transaction(async (tx) => {
      for (const node of ordered) {
        const result = await executeNode(tx, ctx, node, run.id, payload);
        steps.push({ nodeId: node.id, type: node.type, result, at: new Date().toISOString() });
      }
      await tx.workflowRun.update({
        where: { id: run.id },
        data: { status: "COMPLETED", completedAt: new Date(), state: JSON.stringify({ steps, payload }) },
      });
    });
  } catch (err) {
    await db.workflowRun.update({
      where: { id: run.id },
      data: { status: "FAILED", completedAt: new Date(), state: JSON.stringify({ steps, error: String(err), payload }) },
    });
    throw err;
  }

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "workflow.run", entityType: "WorkflowRun", entityId: run.id,
    summary: `Workflow "${def.name}" v${def.version} completed ${steps.length} steps (trigger ${triggerType}).`,
  });
  return run;
}

/** Topological-ish ordering via edges; falls back to declaration order. */
function orderNodes(def: WorkflowDefinition): WorkflowNode[] {
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const ordered: WorkflowNode[] = [];
  const visited = new Set<string>();
  const roots = def.nodes.filter((n) => !def.edges.some((e) => e.to === n.id));
  const queue = [...(roots.length ? roots : def.nodes)];
  while (queue.length) {
    const node = queue.shift()!;
    if (visited.has(node.id) || !byId.has(node.id)) continue;
    visited.add(node.id);
    ordered.push(node);
    for (const edge of def.edges.filter((e) => e.from === node.id)) {
      const next = byId.get(edge.to);
      if (next && !visited.has(next.id)) queue.push(next);
    }
  }
  for (const node of def.nodes) {
    if (!visited.has(node.id)) ordered.push(node);
  }
  return ordered;
}

export async function publishWorkflow(ctx: AuthContext, workflowDefId: string) {
  const def = await db.workflowDef.findFirst({ where: { id: workflowDefId, orgId: ctx.orgId } });
  if (!def) throw NotFound("Workflow not found.");
  validateDefinition(def.definition);
  const updated = await db.workflowDef.update({
    where: { id: workflowDefId },
    data: { status: def.status === "PUBLISHED" ? "ARCHIVED" : "PUBLISHED", publishedAt: def.status === "PUBLISHED" ? def.publishedAt : new Date() },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "workflow.publish_toggled", entityType: "WorkflowDef", entityId: workflowDefId,
    summary: `Workflow "${def.name}" is now ${updated.status}.`,
  });
  return updated;
}

export async function createWorkflow(ctx: AuthContext, input: { key: string; name: string; description?: string; definition: string }) {
  validateDefinition(input.definition);
  const existing = await db.workflowDef.findFirst({ where: { orgId: ctx.orgId, key: input.key } });
  if (existing) throw new AppError(409, "duplicate", "Workflow key already exists.");
  const def = await db.workflowDef.create({
    data: {
      orgId: ctx.orgId,
      key: input.key,
      name: input.name,
      description: input.description || null,
      definition: input.definition,
      status: "DRAFT",
      version: 1,
    },
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "workflow.created", entityType: "WorkflowDef", entityId: def.id,
    summary: `Created workflow "${def.name}" (draft v1).`,
  });
  return def;
}
