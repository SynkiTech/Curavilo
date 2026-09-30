// Communications API — message log, provider config, manual send (spec §62)
import { z } from "zod";
import { ok, fail, parseBody, requireAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { sendCommunication } from "@/lib/comms";

export async function GET() {
  try {
    const ctx = await requireAuth("settings:manage");
    const [messages, providers] = await Promise.all([
      db.communicationMessage.findMany({
        where: { orgId: ctx.orgId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      db.providerConfig.findMany({ where: { orgId: ctx.orgId } }),
    ]);
    return ok({ messages, providers });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("settings:manage");
    const body = await parseBody(request, z.object({
      action: z.enum(["SEND", "SET_PROVIDER"]),
      channel: z.enum(["EMAIL", "SMS", "WHATSAPP", "IN_APP"]).optional(),
      type: z.string().max(40).optional(),
      recipient: z.string().max(200).optional(),
      subject: z.string().max(200).optional(),
      body: z.string().max(4000).optional(),
      provider: z.enum(["console", "termii", "twilio", "africastalking", "metacloud"]).optional(),
    }));

    if (body.action === "SET_PROVIDER") {
      if (!body.channel || !body.provider) return ok({ error: "channel and provider are required." }, 400);
      const cfg = await db.providerConfig.upsert({
        where: { orgId_channel: { orgId: ctx.orgId, channel: body.channel } },
        create: { orgId: ctx.orgId, channel: body.channel, provider: body.provider },
        update: { provider: body.provider },
      });
      return ok({ provider: cfg });
    }

    // SEND (manual message through the adapter layer)
    if (!body.channel || !body.body) return ok({ error: "channel and body are required." }, 400);
    const result = await sendCommunication({
      orgId: ctx.orgId,
      facilityId: ctx.facilityId,
      channel: body.channel,
      type: body.type ?? "MANUAL",
      recipient: body.recipient ?? null,
      subject: body.subject ?? null,
      body: body.body,
      source: "MANUAL",
    });
    return ok({ result }, 201);
  } catch (error) {
    return fail(error);
  }
}
