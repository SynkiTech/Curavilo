// AI API — grounded data agent (permission-checked server-side)
import { ok, fail, requireAuth, parseBody } from "@/lib/api";
import { z } from "zod";
import { askAgent, listConversations, getConversation } from "@/modules/ai/agent";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("ai:ask");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("conversationId");
    if (id) {
      const conversation = await getConversation(ctx, id);
      return ok({ conversation });
    }
    const conversations = await listConversations(ctx);
    return ok({ conversations });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("ai:ask");
    const input = await parseBody(
      request,
      z.object({
        conversationId: z.string().optional().nullable(),
        message: z.string().min(1).max(1000),
      })
    );
    const reply = await askAgent(ctx, input.conversationId ?? null, input.message);
    return ok(reply, 201);
  } catch (error) {
    return fail(error);
  }
}
