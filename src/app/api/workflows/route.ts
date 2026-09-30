// Workflows API — builder CRUD, publish, dry-run, runs, approvals (spec §133)
import { z } from "zod";
import { ok, fail, parseBody, requireAuth } from "@/lib/api";
import { db } from "@/lib/db";
import {
  createWorkflow, updateWorkflow, publishWorkflow, runWorkflow, resolveApproval,
  NODE_TYPES, TRIGGERS,
} from "@/modules/workflows";

const nodeSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(NODE_TYPES),
  config: z.record(z.string(), z.unknown()).default({}),
});

const edgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.enum(["true", "false"]).optional(),
});

const definitionSchema = z.object({
  trigger: z.enum(TRIGGERS),
  schedule: z.object({ everyMinutes: z.number().int().positive().max(1440).optional(), dailyAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional() }).optional(),
  nodes: z.array(nodeSchema).min(1).max(50),
  edges: z.array(edgeSchema),
});

export async function GET() {
  try {
    const ctx = await requireAuth();
    const defs = await db.workflowDef.findMany({
      where: { orgId: ctx.orgId },
      orderBy: [{ key: "asc" }, { version: "desc" }],
    });
    const runs = await db.workflowRun.findMany({
      where: { orgId: ctx.orgId, dryRun: false },
      include: { workflowDef: { select: { name: true } } },
      orderBy: { startedAt: "desc" },
      take: 30,
    });
    const runNodes = await db.workflowRunNode.findMany({
      where: { orgId: ctx.orgId, runId: { in: runs.map((r) => r.id) } },
      orderBy: { createdAt: "asc" },
    });
    const approvals = await db.task.findMany({
      where: { orgId: ctx.orgId, kind: "APPROVAL" },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return ok({
      nodeTypes: NODE_TYPES,
      triggers: TRIGGERS,
      workflows: defs,
      runs: runs.map((r) => ({ ...r, nodes: runNodes.filter((n) => n.runId === r.id) })),
      approvals,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("workflows:manage");
    const body = await parseBody(request, z.object({
      action: z.enum(["CREATE", "DRY_RUN", "RUN", "UPDATE", "PUBLISH_TOGGLE", "RESOLVE_APPROVAL"]),
      key: z.string().min(2).max(40).regex(/^[a-z0-9_-]+$/).optional(),
      name: z.string().min(2).max(120).optional(),
      description: z.string().max(400).optional(),
      definition: definitionSchema.optional(),
      slaMinutes: z.number().int().positive().max(60 * 24 * 30).nullable().optional(),
      workflowId: z.string().min(5).optional(),
      taskId: z.string().min(5).optional(),
      decision: z.enum(["APPROVED", "REJECTED"]).optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
    }));

    if (body.action === "CREATE") {
      if (!body.key || !body.name || !body.definition) return ok({ error: "key, name and definition are required." }, 400);
      const def = await createWorkflow(ctx, {
        key: body.key, name: body.name, description: body.description,
        definition: JSON.stringify(body.definition), slaMinutes: body.slaMinutes ?? undefined,
      });
      return ok({ workflow: def }, 201);
    }

    if (body.action === "UPDATE") {
      if (!body.workflowId) return ok({ error: "workflowId is required." }, 400);
      const def = await updateWorkflow(ctx, body.workflowId, {
        name: body.name, description: body.description,
        definition: body.definition ? JSON.stringify(body.definition) : undefined,
        slaMinutes: body.slaMinutes ?? undefined,
      });
      return ok({ workflow: def });
    }

    if (body.action === "PUBLISH_TOGGLE") {
      if (!body.workflowId) return ok({ error: "workflowId is required." }, 400);
      const def = await publishWorkflow(ctx, body.workflowId);
      return ok({ workflow: def });
    }

    if (body.action === "DRY_RUN") {
      if (!body.workflowId) return ok({ error: "workflowId is required." }, 400);
      const result = await runWorkflow(ctx, body.workflowId, "MANUAL", body.payload ?? {}, { dryRun: true });
      const run = await db.workflowRun.findUnique({ where: { id: result.id }, include: { nodes: true } });
      return ok({ dryRun: run });
    }

    if (body.action === "RUN") {
      if (!body.workflowId) return ok({ error: "workflowId is required." }, 400);
      const result = await runWorkflow(ctx, body.workflowId, "MANUAL", body.payload ?? {});
      const run = await db.workflowRun.findUnique({ where: { id: result.id }, include: { nodes: true } });
      return ok({ run });
    }

    // RESOLVE_APPROVAL
    if (!body.taskId || !body.decision) return ok({ error: "taskId and decision are required." }, 400);
    return ok(await resolveApproval(ctx, body.taskId, body.decision));
  } catch (error) {
    return fail(error);
  }
}
