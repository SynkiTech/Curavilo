// FHIR R4 read-only mapping layer (spec §91, §140, ADR 0009).
// Maps the canonical model to standard resources via pure functions. This is an
// EXPORT surface only: tenant-scoped, permission-gated, audited, rate-limited
// by take(). Licensing-sensitive terminology is not embedded - local codes only.

import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth";

type FhirObject = Record<string, unknown>;

export const FHIR_RESOURCES = [
  "Patient", "Practitioner", "Organization", "Encounter", "Appointment",
  "Observation", "DiagnosticReport", "MedicationRequest", "MedicationDispense",
  "ServiceRequest", "Invoice",
] as const;

export type FhirResource = (typeof FHIR_RESOURCES)[number];

export const FHIR_PERMISSION: Record<FhirResource, string> = {
  Patient: "patients:read",
  Practitioner: "staff:read",
  Organization: "patients:read",
  Encounter: "encounters:read",
  Appointment: "appointments:read",
  Observation: "lab:operate",
  DiagnosticReport: "lab:operate",
  MedicationRequest: "inventory:read",
  MedicationDispense: "inventory:read",
  ServiceRequest: "lab:operate",
  Invoice: "billing:read",
};

const SYSTEM = "https://curavilo.example/fhir";

function ref(type: string, id: string): FhirObject {
  return { reference: `${type}/${id}` };
}

export async function mapResource(ctx: AuthContext, resource: FhirResource, take: number): Promise<FhirObject[]> {
  const orgId = ctx.orgId;
  switch (resource) {
    case "Patient": {
      const rows = await db.patient.findMany({ where: { orgId }, take, orderBy: { createdAt: "desc" } });
      return rows.map((p): FhirObject => ({
        resourceType: "Patient",
        id: p.id,
        identifier: [{ system: SYSTEM, value: p.mrn }],
        active: p.active,
        name: [{ family: p.lastName, given: [p.firstName] }],
        telecom: [{ system: "phone", value: p.phone }, ...(p.email ? [{ system: "email", value: p.email }] : [])],
        gender: p.sex.toLowerCase(),
        birthDate: p.dateOfBirth?.toISOString().slice(0, 10),
      }));
    }
    case "Practitioner": {
      const rows = await db.staffMember.findMany({ where: { orgId }, take });
      return rows.map((s): FhirObject => ({
        resourceType: "Practitioner",
        id: s.id,
        active: s.active,
        name: [{ text: s.name }],
        extension: [{ url: `${SYSTEM}/designation`, valueString: s.designation }],
      }));
    }
    case "Organization": {
      const rows = await db.facility.findMany({ where: { orgId }, take });
      return rows.map((f): FhirObject => ({
        resourceType: "Organization",
        id: f.id,
        name: f.name,
        type: [{ coding: [{ system: SYSTEM, code: f.type, display: f.serviceProfileKey }] }],
        telecom: f.phone ? [{ system: "phone", value: f.phone }] : undefined,
      }));
    }
    case "Encounter": {
      const rows = await db.encounter.findMany({ where: { orgId }, take, orderBy: { startedAt: "desc" }, include: { patient: true } });
      return rows.map((e): FhirObject => ({
        resourceType: "Encounter",
        id: e.id,
        status: e.status === "COMPLETED" ? "finished" : "in-progress",
        class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" },
        subject: ref("Patient", e.patientId),
        period: { start: e.startedAt.toISOString(), end: e.completedAt?.toISOString() },
        reasonCode: e.diagnosis ? [{ text: e.diagnosis }] : undefined,
      }));
    }
    case "Appointment": {
      const rows = await db.appointment.findMany({ where: { orgId }, take, orderBy: { scheduledAt: "desc" } });
      return rows.map((a): FhirObject => ({
        resourceType: "Appointment",
        id: a.id,
        status: a.status === "COMPLETED" ? "fulfilled" : a.status === "NO_SHOW" ? "noshow" : a.status === "CANCELLED" ? "cancelled" : "booked",
        start: a.scheduledAt.toISOString(),
        minutesDuration: a.durationMin,
        participant: [{ actor: ref("Patient", a.patientId), status: "accepted" }],
      }));
    }
    case "Observation": {
      const rows = await db.diagnosticOrder.findMany({
        where: { orgId, status: "RELEASED" }, take, orderBy: { releasedAt: "desc" },
      });
      const out: FhirObject[] = [];
      for (const order of rows) {
        const results = JSON.parse(order.resultsJson ?? "[]") as Array<{ name: string; value: string; unit?: string | null; refRange?: string | null; flag?: string }>;
        for (const r of results) {
          out.push({
            resourceType: "Observation",
            id: `${order.id}-${r.name.replace(/\W+/g, "-").toLowerCase()}`,
            status: "final",
            category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
            code: { text: r.name },
            subject: ref("Patient", order.patientId),
            effectiveDateTime: order.releasedAt?.toISOString(),
            valueString: `${r.value}${r.unit ? ` ${r.unit}` : ""}`,
            referenceRange: r.refRange ? [{ text: r.refRange }] : undefined,
            interpretation: r.flag ? [{ text: r.flag }] : undefined,
          });
        }
      }
      return out.slice(0, take);
    }
    case "DiagnosticReport": {
      const rows = await db.diagnosticOrder.findMany({ where: { orgId, status: "RELEASED" }, take, orderBy: { releasedAt: "desc" } });
      return rows.map((o): FhirObject => ({
        resourceType: "DiagnosticReport",
        id: o.id,
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: o.kind === "LAB" ? "LAB" : "RAD" }] }],
        code: { text: o.testName },
        subject: ref("Patient", o.patientId),
        issued: o.releasedAt?.toISOString(),
        conclusion: o.impression ?? undefined,
      }));
    }
    case "MedicationRequest": {
      const rows = await db.saleItem.findMany({
        where: { orgId, sale: { status: "COMPLETED" } },
        take,
        orderBy: { sale: { createdAt: "desc" } },
        include: { sale: { select: { createdAt: true, patientId: true } } },
      });
      return rows.slice(0, take).map((si): FhirObject => ({
        resourceType: "MedicationRequest",
        id: si.id,
        status: "completed",
        intent: "order",
        medicationCodeableConcept: { text: si.name },
        subject: si.sale.patientId ? ref("Patient", si.sale.patientId) : undefined,
        quantity: { value: si.quantity },
        authoredOn: si.sale.createdAt.toISOString(),
      }));
    }
    case "MedicationDispense": {
      const rows = await db.saleItem.findMany({
        where: { orgId, sale: { status: "COMPLETED" } },
        take,
        orderBy: { sale: { createdAt: "desc" } },
        include: { sale: { select: { createdAt: true, patientId: true } } },
      });
      return rows.slice(0, take).map((si): FhirObject => ({
        resourceType: "MedicationDispense",
        id: si.id,
        status: "completed",
        medicationCodeableConcept: { text: si.name },
        subject: si.sale.patientId ? ref("Patient", si.sale.patientId) : undefined,
        quantity: { value: si.quantity },
        whenHandedOver: si.sale.createdAt.toISOString(),
      }));
    }
    case "ServiceRequest": {
      const rows = await db.diagnosticOrder.findMany({ where: { orgId }, take, orderBy: { orderedAt: "desc" } });
      return rows.map((o): FhirObject => ({
        resourceType: "ServiceRequest",
        id: o.id,
        status: o.status === "CANCELLED" ? "revoked" : o.status === "RELEASED" ? "completed" : "active",
        intent: "order",
        code: { text: o.testName },
        subject: ref("Patient", o.patientId),
        authoredOn: o.orderedAt.toISOString(),
        priority: o.priority === "URGENT" ? "urgent" : "routine",
      }));
    }
    case "Invoice": {
      const rows = await db.invoice.findMany({ where: { orgId, voidedAt: null }, take, orderBy: { createdAt: "desc" } });
      return rows.map((inv): FhirObject => ({
        resourceType: "Invoice",
        id: inv.id,
        status: inv.status === "PAID" ? "paid" : inv.status === "VOID" ? "cancelled" : "issued",
        identifier: [{ system: SYSTEM, value: inv.number }],
        subject: ref("Patient", inv.patientId),
        createdAt: inv.createdAt.toISOString(),
        totalGross: { value: inv.totalMinor / 100, currency: inv.currency },
        totalPaid: { value: inv.amountPaidMinor / 100, currency: inv.currency },
      }));
    }
    default:
      return [];
  }
}
