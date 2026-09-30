// Webhook integration (spec §134, §140) - outbound event delivery with HMAC
// signatures, retry with exponential backoff, and dead-lettering. Inbound
// custom webhooks enter the platform as outbox events (CUSTOM_WEBHOOK trigger).

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

const MAX_DELIVERY_ATTEMPTS = 5;

export async function createEndpoint(ctx: { orgId: string }, input: { url: string; events: string[]; secret?: string }) {
  const key = `whk_${randomBytes(8).toString("hex")}`;
  const secret = input.secret ?? randomBytes(24).toString("hex");
  const { hashWebhookSecret } = await import("@/lib/comms");
  const ep = await db.webhookEndpoint.create({
    data: {
      orgId: ctx.orgId,
      key,
      url: input.url,
      secretHash: hashWebhookSecret(secret),
      events: input.events.join(","),
      active: true,
    },
  });
  // The raw secret is shown exactly once - callers must persist it.
  return { ...ep, secret };
}

export async function listEndpoints(orgId: string) {
  return db.webhookEndpoint.findMany({
    where: { orgId },
    select: { id: true, key: true, url: true, events: true, active: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function toggleEndpoint(orgId: string, id: string) {
  const ep = await db.webhookEndpoint.findFirst({ where: { id, orgId } });
  if (!ep) throw new Error("Webhook endpoint not found.");
  return db.webhookEndpoint.update({ where: { id }, data: { active: !ep.active } });
}

export async function deleteEndpoint(orgId: string, id: string) {
  await db.webhookEndpoint.deleteMany({ where: { id, orgId } });
  return { ok: true };
}

/** Queue deliveries on every active endpoint subscribed to the event type. */
export async function queueWebhookDeliveries(orgId: string, eventType: string, payload: unknown): Promise<number> {
  const endpoints = await db.webhookEndpoint.findMany({ where: { orgId, active: true } });
  const subscribed = endpoints.filter((e) => e.events.split(",").map((s) => s.trim()).includes(eventType) || e.events.trim() === "*");
  if (subscribed.length === 0) return 0;
  await db.webhookDelivery.createMany({
    data: subscribed.map((ep) => ({
      orgId, endpointId: ep.id, eventType,
      payload: JSON.stringify({ event: eventType, occurredAt: new Date().toISOString(), data: payload }),
      status: "PENDING",
      nextAttemptAt: new Date(),
    })),
  });
  return subscribed.length;
}

function sign(secret: string, body: string, timestamp: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Scheduler pump: attempt PENDING/FAILED deliveries whose nextAttemptAt is due. */
export async function processWebhookDeliveries(orgId: string, limit = 10) {
  const due = await db.webhookDelivery.findMany({
    where: { orgId, status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: new Date() } },
    include: { endpoint: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let delivered = 0;
  for (const d of due) {
    if (!d.endpoint.active) continue;
    const attempts = d.attempts + 1;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    try {
      const sig = sign(d.endpoint.secretHash, d.payload, timestamp);
      const res = await fetch(d.endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Curavilo-Event": d.eventType,
          "X-Curavilo-Signature": `t=${timestamp},v1=${sig}`,
        },
        body: d.payload,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        await db.webhookDelivery.update({
          where: { id: d.id },
          data: { status: "DELIVERED", attempts, responseStatus: res.status, deliveredAt: new Date(), lastError: null },
        });
        delivered++;
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      const dead = attempts >= MAX_DELIVERY_ATTEMPTS;
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: dead ? "DEAD" : "FAILED",
          attempts,
          lastError: e instanceof Error ? e.message : String(e),
          nextAttemptAt: dead ? null : new Date(Date.now() + Math.pow(2, attempts) * 60_000),
        },
      });
    }
  }
  return { attempted: due.length, delivered };
}

/** Verify an inbound webhook signature (for custom integrations posting into Curavilo). */
export function verifyInboundSignature(secret: string, body: string, header: string | null): boolean {
  if (!header) return false;
  const m = /t=(\d+),v1=([a-f0-9]+)/.exec(header);
  if (!m) return false;
  const [, timestamp, sig] = m;
  const expected = sign(secret, body, timestamp);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
