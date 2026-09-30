// Audit — append-only event log (spec §2.9, §86). Never store sensitive payloads.
import { db } from "@/lib/db";

export interface AuditInput {
  orgId?: string | null;
  facilityId?: string | null;
  actorUserId?: string | null;
  actorLabel?: string | null;
  action: string; // e.g. "patient.created", "payment.recorded", "ai.query", "document.printed"
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
}

export async function audit(input: AuditInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      orgId: input.orgId ?? null,
      facilityId: input.facilityId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorLabel: input.actorLabel ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary.slice(0, 300),
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}
