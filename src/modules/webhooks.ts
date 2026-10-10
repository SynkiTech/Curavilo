// Webhook integration (spec §134, §140) - outbound event delivery with HMAC
// signatures, retry with exponential backoff, and dead-lettering. Inbound
// custom webhooks enter the platform as outbox events (CUSTOM_WEBHOOK trigger).
// Security: destinations pass SSRF validation (no private/loopback/metadata),
// signatures are keyed on the real secret (AES-GCM encrypted at rest), and
// inbound verification enforces timestamp freshness (anti-replay).

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { validateOutboundUrl } from "@/lib/url-guard";
import { encryptSecret, decryptSecret } from "@/lib/secret-box";

const MAX_DELIVERY_ATTEMPTS = 5;
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60; // inbound replay window

export async function createEndpoint(ctx: { orgId: string }, input: { url: string; events: string[]; secret?: string }) {
  // SSRF guard: reject private/loopback/metadata destinations at registration time.
  const guard = await validateOutboundUrl(input.url, { allowHttp: process.env.NODE_ENV !== "production" });
  if (!guard.ok) throw new AppError(400, "invalid_url", `Webhook URL rejected: ${guard.reason}`);
  const key = `whk_${randomBytes(8).toString("hex")}`;
  const secret = input.secret ?? randomBytes(24).toString("hex");
  const { hashWebhookSecret } = await import("@/lib/comms");
  const ep = await db.webhookEndpoint.create({
    data: {
      orgId: ctx.orgId,
      key,
      url: input.url,
      secretHash: hashWebhookSecret(secret),
      secretEnc: encryptSecret(secret), // read-back copy for HMAC signing (AES-256-GCM)
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
      // Re-validate the destination on every attempt (DNS may have changed;
      // the guard doubles as anti-DNS-rebinding re-check).
      const guard = await validateOutboundUrl(d.endpoint.url, { allowHttp: process.env.NODE_ENV !== "production" });
      if (!guard.ok) throw new Error(`Blocked by SSRF guard: ${guard.reason}`);
      // Sign with the real secret. Legacy endpoints (created before the
      // encrypted copy existed) fall back to the stored hash so they keep
      // delivering; new endpoints always sign with the secret itself.
      const signingKey = decryptSecret(d.endpoint.secretEnc) ?? d.endpoint.secretHash;
      const sig = sign(signingKey, d.payload, timestamp);
      const res = await fetch(d.endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Curavilo-Event": d.eventType,
          "X-Curavilo-Signature": `t=${timestamp},v1=${sig}`,
        },
        body: d.payload,
        redirect: "error", // never follow redirects: they can re-enter private space
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
  // Replay protection: signatures older than the tolerance window are rejected.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = sign(secret, body, timestamp);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
