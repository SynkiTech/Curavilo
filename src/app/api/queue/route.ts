// Queue API — live board, walk-in check-in, queue actions
import { ok, fail, requireAuth, parseBody } from "@/lib/api";
import { z } from "zod";
import { listQueue, walkInCheckIn, walkInSchema, queueAction, type QueueAction } from "@/modules/scheduling";

export async function GET() {
  try {
    const ctx = await requireAuth("queue:operate");
    const entries = await listQueue(ctx);
    return ok({ entries });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("queue:operate");
    const input = await parseBody(request, walkInSchema);
    const entry = await walkInCheckIn(ctx, input);
    return ok({ entry }, 201);
  } catch (error) {
    return fail(error);
  }
}

const actionSchema = z.object({ entryId: z.string().min(5), action: z.enum(["CALL", "SKIP", "COMPLETE"]) });

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth("queue:operate");
    const { entryId, action } = await parseBody(request, actionSchema);
    const entry = await queueAction(ctx, entryId, action as QueueAction);
    return ok({ entry });
  } catch (error) {
    return fail(error);
  }
}
