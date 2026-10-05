// Provider-neutral communication layer (spec §62, §134).
// All external providers sit behind MessageAdapter interfaces - the domain layer
// never hard-codes a vendor. In this sandbox the "console" adapters simulate
// delivery deterministically and log it; production adapters (Termii, Africa's
// Talking, Twilio, Meta WhatsApp Cloud) implement the same interface.

import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";

export type Channel = "EMAIL" | "SMS" | "WHATSAPP" | "IN_APP";

export interface OutgoingMessage {
  orgId: string;
  facilityId?: string | null;
  channel: Channel;
  type: string;
  recipient: string | null; // email / phone / role
  recipientUserId?: string | null;
  subject?: string | null;
  body: string;
  source: "WORKFLOW" | "MANUAL" | "SYSTEM" | "SCHEDULER" | "AI";
  sourceId?: string | null;
}

export interface DeliveryResult {
  status: "SENT" | "SIMULATED" | "FAILED";
  provider: string;
  providerRef?: string;
  error?: string;
}

export interface MessageAdapter {
  readonly provider: string;
  send(msg: OutgoingMessage): Promise<DeliveryResult>;
}

function ref(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

/** Dev/sandbox adapter - simulates delivery, deterministic success. */
class ConsoleAdapter implements MessageAdapter {
  readonly provider = "console";
  constructor(private readonly prefix: string) {}
  async send(msg: OutgoingMessage): Promise<DeliveryResult> {
    console.log(`[comms:${this.prefix}] → ${msg.recipient ?? "n/a"} :: ${msg.subject ?? msg.body.slice(0, 80)}`);
    return { status: "SIMULATED", provider: this.provider, providerRef: ref(this.prefix) };
  }
}

/**
 * Resolve the adapter for a channel. Production registers real adapters keyed by
 * the org's ProviderConfig.provider value; anything unregistered falls back to
 * the console simulation so behaviour is always observable, never silently dropped.
 */
export function adapterFor(channel: Channel, providerKey: string | null): MessageAdapter {
  // Registry of production adapters is intentionally small and swappable:
  // switch (providerKey) { case "termii": return new TermiiAdapter(); ... }
  void channel;
  return new ConsoleAdapter(channel.toLowerCase());
}

export function preview(body: string, max = 160): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Persist + send a message through the channel adapter. Never throws into domain flow. */
export async function sendCommunication(msg: OutgoingMessage): Promise<DeliveryResult> {
  const cfg = await db.providerConfig.findUnique({
    where: { orgId_channel: { orgId: msg.orgId, channel: msg.channel === "IN_APP" ? "EMAIL" : msg.channel } },
  });
  const adapter = adapterFor(msg.channel, cfg?.provider ?? null);
  let result: DeliveryResult;
  try {
    result = await adapter.send(msg);
  } catch (e) {
    result = { status: "FAILED", provider: adapter.provider, error: e instanceof Error ? e.message : String(e) };
  }
  await db.communicationMessage.create({
    data: {
      orgId: msg.orgId,
      facilityId: msg.facilityId ?? null,
      channel: msg.channel,
      type: msg.type,
      recipient: msg.recipient,
      recipientUserId: msg.recipientUserId ?? null,
      subject: msg.subject ?? null,
      bodyPreview: preview(msg.body),
      status: result.status,
      provider: result.provider,
      providerRef: result.providerRef ?? null,
      error: result.error ?? null,
      source: msg.source,
      sourceId: msg.sourceId ?? null,
    },
  });
  return result;
}

export function hashWebhookSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
