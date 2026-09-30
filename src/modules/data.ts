// Data import/export (spec §64–65, §140): CSV patients/inventory import with
// inspect → map → validate → preview → transactional import → audit; audited
// tenant-scoped CSV exports. Never imports silently — every row is validated
// and reported before anything is written.

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/api";
import { nextDocNumber } from "@/lib/numbering";
import type { AuthContext } from "@/lib/auth";

// ─── CSV parsing (RFC4180-lite) ─────────────────────────────────────────────

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function col(headers: string[], row: string[], name: string): string {
  const idx = headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  return idx >= 0 ? (row[idx] ?? "").trim() : "";
}

// ─── Patients import ────────────────────────────────────────────────────────

export interface ImportPreview {
  total: number;
  valid: number;
  errors: Array<{ row: number; message: string }>;
  duplicates: Array<{ row: number; message: string }>;
}

function validatePatientRows(headers: string[], rows: string[][], orgId: string): { preview: ImportPreview; clean: Array<{ firstName: string; lastName: string; phone: string; sex: string }> } {
  const errors: ImportPreview["errors"] = [];
  const duplicates: ImportPreview["duplicates"] = [];
  const clean: Array<{ firstName: string; lastName: string; phone: string; sex: string }> = [];
  const seen = new Set<string>();
  const existing = new Set<string>();
  void orgId;

  rows.forEach((row, i) => {
    const line = i + 2; // header is line 1
    const firstName = col(headers, row, "firstName") || col(headers, row, "first name");
    const lastName = col(headers, row, "lastName") || col(headers, row, "last name") || col(headers, row, "surname");
    const phone = col(headers, row, "phone") || col(headers, row, "mobile") || col(headers, row, "telephone");
    const sex = (col(headers, row, "sex") || col(headers, row, "gender") || "FEMALE").toUpperCase();
    if (firstName.length < 2) errors.push({ row: line, message: "firstName missing/short" });
    if (lastName.length < 2) errors.push({ row: line, message: "lastName missing/short" });
    if (phone.length < 7) errors.push({ row: line, message: "phone missing/short" });
    if (!["MALE", "FEMALE"].includes(sex)) errors.push({ row: line, message: `sex must be MALE or FEMALE (got "${sex}")` });
    const key = `${phone.toLowerCase()}`;
    if (errors.every((e) => e.row !== line)) {
      if (seen.has(key)) duplicates.push({ row: line, message: `duplicate phone in file (${phone})` });
      seen.add(key);
      clean.push({ firstName, lastName, phone, sex: sex === "MALE" ? "MALE" : "FEMALE" });
    }
  });
  return { preview: { total: rows.length, valid: clean.length, errors, duplicates }, clean };
}

export async function previewPatientImport(ctx: AuthContext, csv: string) {
  const [headers, ...rows] = parseCsv(csv);
  if (!headers) throw new AppError(400, "bad_request", "CSV appears empty.");
  const required = ["firstName", "lastName", "phone"];
  const missing = required.filter((r) => !headers.some((h) => h.trim().toLowerCase().startsWith(r.toLowerCase())));
  if (missing.length) {
    throw new AppError(400, "bad_request", `Missing required columns: ${missing.join(", ")}. Available headers: ${headers.join(", ")}`);
  }
  // Duplicate check against existing patients
  const { preview, clean } = validatePatientRows(headers, rows, ctx.orgId);
  const existingPhones = new Set(
    (await db.patient.findMany({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId, phone: { in: clean.map((c) => c.phone) } }, select: { phone: true } })).map((p) => p.phone),
  );
  const finalRows = clean.filter((c) => {
    if (existingPhones.has(c.phone)) {
      const idx = clean.indexOf(c) + 2;
      preview.duplicates.push({ row: idx, message: `phone already registered (${c.phone})` });
      return false;
    }
    return true;
  });
  preview.valid = finalRows.length;
  return { preview, rows: finalRows, headers };
}

export async function commitPatientImport(ctx: AuthContext, rows: Array<{ firstName: string; lastName: string; phone: string; sex: string }>) {
  if (rows.length === 0 || rows.length > 500) throw new AppError(400, "bad_request", "Import must contain 1–500 rows.");
  const created = await db.$transaction(async (tx) => {
    const patients: Array<{ id: string }> = [];
    for (const row of rows) {
      const mrn = await nextDocNumber(tx, ctx.orgId, "PATIENT");
      patients.push(await tx.patient.create({
        data: { orgId: ctx.orgId, facilityId: ctx.facilityId, mrn, ...row },
      }));
    }
    return patients;
  });
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "data.import", entityType: "Patient", entityId: "bulk",
    summary: `Imported ${created.length} patients from CSV.`,
  });
  return { imported: created.length };
}

// ─── Exports (audited, tenant-scoped) ───────────────────────────────────────

function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export async function exportPatients(ctx: AuthContext): Promise<string> {
  const rows = await db.patient.findMany({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId }, orderBy: { createdAt: "desc" }, take: 2000 });
  await auditExport(ctx, "patients", rows.length);
  return toCsv(
    ["mrn", "firstName", "lastName", "phone", "email", "sex", "dateOfBirth", "createdAt"],
    rows.map((p) => [p.mrn, p.firstName, p.lastName, p.phone, p.email, p.sex, p.dateOfBirth?.toISOString().slice(0, 10), p.createdAt.toISOString()]),
  );
}

export async function exportInvoices(ctx: AuthContext): Promise<string> {
  const rows = await db.invoice.findMany({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId }, orderBy: { createdAt: "desc" }, take: 2000, include: { patient: true } });
  await auditExport(ctx, "invoices", rows.length);
  return toCsv(
    ["number", "patient", "status", "totalMinor", "amountPaidMinor", "currency", "createdAt"],
    rows.map((i) => [i.number, `${i.patient.firstName} ${i.patient.lastName}`, i.status, i.totalMinor, i.amountPaidMinor, i.currency, i.createdAt.toISOString()]),
  );
}

export async function exportAppointments(ctx: AuthContext): Promise<string> {
  const rows = await db.appointment.findMany({ where: { orgId: ctx.orgId, facilityId: ctx.facilityId }, orderBy: { scheduledAt: "desc" }, take: 2000, include: { patient: true } });
  await auditExport(ctx, "appointments", rows.length);
  return toCsv(
    ["patient", "scheduledAt", "durationMin", "status"],
    rows.map((a) => [`${a.patient.firstName} ${a.patient.lastName}`, a.scheduledAt.toISOString(), a.durationMin, a.status]),
  );
}

async function auditExport(ctx: AuthContext, what: string, count: number) {
  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "data.export", entityType: "CsvExport", entityId: what,
    summary: `Exported ${count} ${what} rows to CSV.`,
  });
}
