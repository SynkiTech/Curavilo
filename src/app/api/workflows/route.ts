// Workflows API — list, create, publish toggle, run (manual trigger)
import { ok, fail, requireAuth, parseBody } from "@/lib/api";
import { z } from "zod";
import { db } from "@/lib/db";
import { createWorkflow, publishWorkflow, runWorkflow } from "@/modules/workflows";

export async function GET() {
  try {
    const ctx = await requireAuth("patients:read");
    const [workflows, runs] = await Promise.all([
      db.workflowDef.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" } }),
      db.workflowRun.findMany({
        where: { orgId: ctx.orgId },
        orderBy: { startedAt: "desc" },
        take: 30,
        include: { workflowDef: { select: { name: true } } },
      }),
    ]);
    return ok({ workflows, runs });
  } catch (error) {
    return fail(error);
  }
}

const createSchema = z.object({
  key: z.string().min(2).max(40).regex(/^[A-Z_]+$/, "Key must be UPPER_SNAKE"),
  name: z.string().min(2).max(80),
  description: z.string().max(300).optional().nullable(),
  definition: z.string().min(10).max(20_000),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("PUBLISH_TOGGLE"), workflowId: z.string().min(5) }),
  z.object({ action: z.literal("RUN"), workflowId: z.string().min(5), patientId: z.string().optional().nullable() }),
]);

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("settings:manage");
    const input = await parseBody(request, createSchema);
    const workflow = await createWorkflow(ctx, { ...input, description: input.description ?? undefined });
    return ok({ workflow }, 201);
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await parseBody(request, actionSchema);
    if (body.action === "PUBLISH_TOGGLE") {
      const ctx = await requireAuth("settings:manage");
      const workflow = await publishWorkflow(ctx, body.workflowId);
      return ok({ workflow });
    }
    const ctx = await requireAuth("encounters:write");
    const run = await runWorkflow(ctx, body.workflowId, "MANUAL", { patientId: body.patientId ?? null, facilityId: ctx.facilityId });
    return ok({ run });
  } catch (error) {
    return fail(error);
  }
}
