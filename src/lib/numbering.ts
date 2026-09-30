// Document numbering — collision-safe, tenant-safe, transaction-safe (spec §38).
// Format: {PREFIX}-{YYYYMMDD}-{seq6} per org per day. MRN uses period "ALL".
import { db } from "@/lib/db";

const PREFIX: Record<string, string> = {
  INVOICE: "INV",
  PAYMENT: "RCP",
  ENCOUNTER: "ENC",
  SALE: "POS",
  PATIENT: "MRN",
  LAB: "LAB",
  LABREPORT: "LAB",
  IMAGEREPORT: "IMG",
  REFERRAL: "REF",
  ADMISSION: "ADM",
};

function periodFor(type: string, now: Date): string {
  if (type === "PATIENT") return "ALL";
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Atomically allocate the next document number. MUST be called inside the
 * same transaction as the business write so a rollback also rolls back the counter.
 */
type SeqTx = {
  numberSequence: {
    upsert: (args: {
      where: { id: string };
      create: { id: string; seq: number };
      update: { seq: { increment: number } };
    }) => Promise<{ seq: number }>;
  };
};

export async function nextDocNumber(
  tx: SeqTx,
  orgId: string,
  type: keyof typeof PREFIX | string,
  now: Date = new Date()
): Promise<string> {
  const period = periodFor(type, now);
  const id = `${orgId}:${type}:${period}`;
  const rows = await tx.numberSequence.upsert({
    where: { id },
    create: { id, seq: 1 },
    update: { seq: { increment: 1 } },
  });
  const seq = rows.seq;
  return `${PREFIX[type] ?? type}-${period}-${String(seq).padStart(6, "0")}`;
}

/** MRN uses a longer human-friendly form: MRN-000001 */
export async function nextMrn(tx: SeqTx, orgId: string): Promise<string> {
  const id = `${orgId}:PATIENT:ALL`;
  const rows = await tx.numberSequence.upsert({
    where: { id },
    create: { id, seq: 1 },
    update: { seq: { increment: 1 } },
  });
  return `MRN-${String(rows.seq).padStart(6, "0")}`;
}
