// Client-side mirror of service profile encounter form templates (lib/service-profiles.ts).
// Starter templates — require professional clinical review before production use.
export interface FormField { key: string; label: string; type: "text" | "number" | "textarea" | "select"; required?: boolean; options?: string[]; unit?: string }
export interface FormSection { title: string; fields: FormField[] }
export interface EncounterFormTemplate { key: string; title: string; sections: FormSection[] }

const VITALS: FormSection = {
  title: "Vitals",
  fields: [
    { key: "bp", label: "Blood Pressure", type: "text", unit: "mmHg" },
    { key: "temp", label: "Temperature", type: "number", unit: "°C" },
    { key: "pulse", label: "Pulse", type: "number", unit: "bpm" },
    { key: "weight", label: "Weight", type: "number", unit: "kg" },
  ],
};

export const ENCOUNTER_FORMS: Record<string, EncounterFormTemplate> = {
  GENERAL_CONSULT: {
    key: "GENERAL_CONSULT",
    title: "General Consultation",
    sections: [
      VITALS,
      {
        title: "Assessment",
        fields: [
          { key: "chiefComplaint", label: "Chief Complaint", type: "textarea", required: true },
          { key: "history", label: "History", type: "textarea" },
          { key: "findings", label: "Examination Findings", type: "textarea" },
        ],
      },
    ],
  },
  EYE_EXAM: {
    key: "EYE_EXAM",
    title: "Ophthalmic Examination",
    sections: [
      {
        title: "Visual Acuity",
        fields: [
          { key: "vaOd", label: "VA Right Eye (OD)", type: "text", required: true },
          { key: "vaOs", label: "VA Left Eye (OS)", type: "text", required: true },
          { key: "pinhole", label: "Pinhole VA", type: "text" },
        ],
      },
      {
        title: "Refraction",
        fields: [
          { key: "refractionOd", label: "Refraction OD", type: "text" },
          { key: "refractionOs", label: "Refraction OS", type: "text" },
          { key: "nearAdd", label: "Near Addition", type: "text" },
        ],
      },
      {
        title: "Intraocular Pressure",
        fields: [
          { key: "iopOd", label: "IOP OD", type: "number", unit: "mmHg" },
          { key: "iopOs", label: "IOP OS", type: "number", unit: "mmHg" },
        ],
      },
      {
        title: "Anterior Segment & Fundus",
        fields: [
          { key: "anteriorSegment", label: "Anterior Segment Findings", type: "textarea" },
          { key: "fundus", label: "Fundoscopy", type: "textarea" },
        ],
      },
    ],
  },
  DENTAL_EXAM: {
    key: "DENTAL_EXAM",
    title: "Dental Examination",
    sections: [
      { title: "Odontogram", fields: [{ key: "toothChart", label: "Tooth Chart Notes (e.g. 16, 26 — caries)", type: "textarea", required: true }] },
      {
        title: "Assessment",
        fields: [
          { key: "oralHygiene", label: "Oral Hygiene", type: "select", options: ["Good", "Fair", "Poor"] },
          { key: "findings", label: "Findings", type: "textarea" },
        ],
      },
    ],
  },
  DIAG_TEST: {
    key: "DIAG_TEST",
    title: "Diagnostic Record",
    sections: [
      {
        title: "Investigation",
        fields: [
          { key: "tests", label: "Tests / Investigations", type: "textarea", required: true },
          { key: "specimen", label: "Specimen Type", type: "text" },
        ],
      },
      {
        title: "Results",
        fields: [
          { key: "results", label: "Results", type: "textarea" },
          { key: "flags", label: "Abnormal Flags", type: "text" },
        ],
      },
    ],
  },
};
