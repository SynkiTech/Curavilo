// Health probe — liveness + DB check + queue depth (runbooks, spec §142)
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const [pendingOutbox, pendingWebhooks] = await Promise.all([
      db.outboxEvent.count({ where: { processedAt: null } }),
      db.webhookDelivery.count({ where: { status: { in: ["PENDING", "FAILED"] } } }),
    ]);
    return NextResponse.json({
      status: "ok",
      db: "ok",
      latencyMs: Date.now() - startedAt,
      pendingOutbox,
      pendingWebhooks,
      time: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { status: "degraded", db: "error", error: e instanceof Error ? e.message : "unknown", time: new Date().toISOString() },
      { status: 503 },
    );
  }
}
