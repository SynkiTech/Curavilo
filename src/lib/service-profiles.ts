// Service Profile Engine — configuration over hard-coding (spec §11, §12, §13)
// Starter profiles are templates, NOT clinical protocols. Forms must be reviewed
// by professionals before production clinical use.

export interface FormField {
  key: string;
  label: string;
  type: "text" | "number" | "textarea" | "select" | "date";
  required?: boolean;
  options?: string[];
  unit?: string;
}

export interface FormSection {
  title: string;
  fields: FormField[];
}

export interface CatalogueSeed {
  code: string;
  name: string;
  category: string;
  priceMinor: number;
}

export interface ServiceProfile {
  key: string;
  name: string;
  description: string;
  /** terminology overrides rendered through t(key) */
  terminology: Record<string, string>;
  /** encounter form template used by the clinical view */
  form: { key: string; title: string; sections: FormSection[] };
  /** starter service catalogue offered at onboarding */
  catalogue: CatalogueSeed[];
  /** module visibility fine-tuning */
  modules: Record<string, boolean>;
  dashboardWidgets?: string[];
}

const DEFAULT_TERMINOLOGY: Record<string, string> = {
  "patient.label": "Patient",
  "patient.plural": "Patients",
  "visit.label": "Visit",
  "consultation.label": "Consultation",
  "examination.label": "Examination",
  "procedure.label": "Procedure",
  "department.label": "Department",
  "followup.label": "Follow-up",
  "doctor.label": "Doctor",
  "encounter.label": "Encounter",
};

const VITALS_SECTION: FormSection = {
  title: "Vitals",
  fields: [
    { key: "bp", label: "Blood Pressure", type: "text", unit: "mmHg" },
    { key: "temp", label: "Temperature", type: "number", unit: "°C" },
    { key: "pulse", label: "Pulse", type: "number", unit: "bpm" },
    { key: "weight", label: "Weight", type: "number", unit: "kg" },
  ],
};

const GP_FORM = {
  key: "GENERAL_CONSULT",
  title: "General Consultation",
  sections: [
    VITALS_SECTION,
    {
      title: "Assessment",
      fields: [
        { key: "chiefComplaint", label: "Chief Complaint", type: "textarea", required: true },
        { key: "history", label: "History", type: "textarea" },
        { key: "findings", label: "Examination Findings", type: "textarea" },
      ],
    },
  ] as FormSection[],
};

export const SERVICE_PROFILES: Record<string, ServiceProfile> = {
  GENERAL_PRACTICE: {
    key: "GENERAL_PRACTICE",
    name: "General Practice",
    description: "Outpatient general medical care for clinics and medical centres.",
    terminology: DEFAULT_TERMINOLOGY,
    form: GP_FORM,
    catalogue: [
      { code: "CONS-GEN", name: "General Consultation", category: "CONSULTATION", priceMinor: 1500000 },
      { code: "EXAM-GEN", name: "General Examination", category: "EXAMINATION", priceMinor: 1000000 },
      { code: "LAB-FCB", name: "FBC (Full Blood Count)", category: "LAB", priceMinor: 350000 },
      { code: "LAB-MPS", name: "Malaria Parasite Test", category: "LAB", priceMinor: 200000 },
      { code: "PROC-DRESS", name: "Wound Dressing", category: "PROCEDURE", priceMinor: 500000 },
    ],
    modules: {},
    dashboardWidgets: ["patients", "waiting", "inConsultation", "completed", "revenue", "appointments", "followups", "inventory"],
  },

  EYE_CLINIC: {
    key: "EYE_CLINIC",
    name: "Eye Clinic (Ophthalmology / Optometry)",
    description: "Eye examinations, refraction, IOP measurement and ophthalmic care.",
    terminology: {
      ...DEFAULT_TERMINOLOGY,
      "consultation.label": "Eye Consultation",
      "examination.label": "Eye Examination",
      "procedure.label": "Ophthalmic Procedure",
      "doctor.label": "Optometrist",
      "encounter.label": "Eye Examination Record",
      "visit.label": "Eye Visit",
    },
    form: {
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
    catalogue: [
      { code: "CONS-EYE", name: "Eye Consultation", category: "CONSULTATION", priceMinor: 2000000 },
      { code: "EXAM-EYE", name: "Eye Examination", category: "EXAMINATION", priceMinor: 1500000 },
      { code: "REFRACT", name: "Refraction", category: "EXAMINATION", priceMinor: 2500000 },
      { code: "IOP", name: "IOP Measurement", category: "EXAMINATION", priceMinor: 500000 },
      { code: "PROC-EYE", name: "Ophthalmic Procedure", category: "PROCEDURE", priceMinor: 5000000 },
      { code: "FRAME-STD", name: "Standard Frame + Lenses", category: "PROCEDURE", priceMinor: 3500000 },
    ],
    modules: {},
    dashboardWidgets: ["patients", "waiting", "inConsultation", "completed", "revenue", "appointments", "followups", "inventory"],
  },

  DENTAL: {
    key: "DENTAL",
    name: "Dental Clinic",
    description: "Dental consultations, tooth charting, procedures and treatment plans.",
    terminology: {
      ...DEFAULT_TERMINOLOGY,
      "consultation.label": "Dental Consultation",
      "examination.label": "Dental Examination",
      "procedure.label": "Dental Procedure",
      "followup.label": "Treatment Plan Review",
      "doctor.label": "Dentist",
    },
    form: {
      key: "DENTAL_EXAM",
      title: "Dental Examination",
      sections: [
        {
          title: "Odontogram",
          fields: [
            { key: "toothChart", label: "Tooth Chart Notes (e.g. 16, 26 — caries)", type: "textarea", required: true },
          ],
        },
        {
          title: "Assessment",
          fields: [
            { key: "oralHygiene", label: "Oral Hygiene", type: "select", options: ["Good", "Fair", "Poor"] },
            { key: "findings", label: "Findings", type: "textarea" },
          ],
        },
      ],
    },
    catalogue: [
      { code: "CONS-DEN", name: "Dental Consultation", category: "CONSULTATION", priceMinor: 2000000 },
      { code: "EXAM-DEN", name: "Dental Examination", category: "EXAMINATION", priceMinor: 1000000 },
      { code: "PROC-SCALE", name: "Scaling & Polishing", category: "PROCEDURE", priceMinor: 3000000 },
      { code: "PROC-EXTR", name: "Extraction", category: "PROCEDURE", priceMinor: 4000000 },
      { code: "PROC-FILL", name: "Filling", category: "PROCEDURE", priceMinor: 3500000 },
    ],
    modules: {},
  },

  DIAGNOSTIC_CENTRE: {
    key: "DIAGNOSTIC_CENTRE",
    name: "Diagnostic Centre",
    description: "Laboratory and imaging services with result workflows.",
    terminology: {
      ...DEFAULT_TERMINOLOGY,
      "consultation.label": "Test Request Review",
      "examination.label": "Diagnostic Test",
      "procedure.label": "Procedure",
      "doctor.label": "Radiographer / Scientist",
    },
    form: {
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
    catalogue: [
      { code: "LAB-CBC", name: "Complete Blood Count", category: "LAB", priceMinor: 350000 },
      { code: "LAB-LFT", name: "Liver Function Test", category: "LAB", priceMinor: 800000 },
      { code: "LAB-RBS", name: "Random Blood Sugar", category: "LAB", priceMinor: 150000 },
      { code: "IMG-XRAY", name: "X-Ray (Plain)", category: "IMAGING", priceMinor: 1200000 },
      { code: "IMG-US", name: "Ultrasound Scan", category: "IMAGING", priceMinor: 1500000 },
    ],
    modules: {},
  },

  GENERAL_HOSPITAL: {
    key: "GENERAL_HOSPITAL",
    name: "General Hospital",
    description: "Multi-department hospital configuration.",
    terminology: DEFAULT_TERMINOLOGY,
    form: GP_FORM,
    catalogue: [
      { code: "CONS-GEN", name: "General Consultation", category: "CONSULTATION", priceMinor: 1500000 },
      { code: "CONS-SPEC", name: "Specialist Consultation", category: "CONSULTATION", priceMinor: 3000000 },
      { code: "EXAM-GEN", name: "General Examination", category: "EXAMINATION", priceMinor: 1000000 },
      { code: "LAB-FCB", name: "FBC (Full Blood Count)", category: "LAB", priceMinor: 350000 },
      { code: "IMG-XRAY", name: "X-Ray (Plain)", category: "IMAGING", priceMinor: 1200000 },
      { code: "WARD-DAY", name: "Ward Admission (per day)", category: "OTHER", priceMinor: 2000000 },
    ],
    modules: {},
  },
};

export const PROFILE_KEYS = Object.keys(SERVICE_PROFILES);

export function getProfile(key: string): ServiceProfile {
  return SERVICE_PROFILES[key] ?? SERVICE_PROFILES.GENERAL_PRACTICE;
}

/** Resolve a terminology key against profile overrides, falling back to defaults. */
export function t(profile: ServiceProfile, key: string): string {
  return profile.terminology[key] ?? DEFAULT_TERMINOLOGY[key] ?? key;
}

export const DEPARTMENTS = ["GENERAL", "OPHTHALMOLOGY", "DENTAL", "LABORATORY", "IMAGING", "MATERNITY", "PEDIATRICS", "PHARMACY"];
