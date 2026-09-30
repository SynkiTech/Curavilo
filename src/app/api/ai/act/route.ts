// AI ACT endpoint — executes a human-confirmed LOW-risk action (spec §50–51).
// The proposal always comes from the agent; execution only happens after the
// user explicitly confirms in the UI, and is fully audited.
import { z } from "zod";
import { ok, fail, parseBody, requireAuth } from "@/lib/api";
import { executeAiAction } from "@/modules/ai/agent";

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("ai:ask");
    const body = await parseBody(request, z.object({
      action: z.enum(["create_follow_up", "create_task", "generate_report"]),
      params: z.record(z.string(), z.unknown()).default({}),
    }));
    return ok(await executeAiAction(ctx, body.action, body.params));
  } catch (error) {
    return fail(error);
  }
}
