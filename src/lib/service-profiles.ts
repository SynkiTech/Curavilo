// Service Profile Engine - configuration over hard-coding (spec §11, §12, §13)
// Starter profiles are templates, NOT clinical protocols. Forms must be reviewed
// by professionals before production clinical use.

export interface FormField {
  key: string;
  label: string;
  type: "text" | "number" | "textarea" | "select" | "multiselect" | "checkbox" | "date";
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
  "followup.plural": "Follow-ups",
  "doctor.label": "Doctor",
  "encounter.label": "Encounter",
  "encounter.plural": "Encounters",
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
      "encounter.plural": "Eye Examination Records",
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
      "followup.plural": "Treatment Plan Reviews",
      "doctor.label": "Dentist",
    },
    form: {
      key: "DENTAL_EXAM",
      title: "Dental Examination",
      sections: [
        {
          title: "Odontogram",
          fields: [
            { key: "toothChart", label: "Tooth Chart Notes (e.g. 16, 26 - caries)", type: "textarea", required: true },
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

  MATERNITY: {
    key: "MATERNITY",
    name: "Maternity / Obstetrics",
    description: "Antenatal care, delivery, postnatal follow-up and family planning.",
    terminology: {
      ...DEFAULT_TERMINOLOGY,
      "patient.label": "Mother",
      "visit.label": "Antenatal Visit",
      "consultation.label": "Antenatal Consultation",
      "followup.label": "Antenatal Next Visit",
      "followup.plural": "Antenatal Next Visits",
      "doctor.label": "Obstetrician",
    },
    form: {
      key: "ANC_VISIT",
      title: "Antenatal Visit",
      sections: [
        VITALS_SECTION,
        {
          title: "Pregnancy",
          fields: [
            { key: "gestationalAge", label: "Gestational Age (weeks)", type: "number", required: true },
            { key: "fundalHeight", label: "Fundal Height (cm)", type: "number" },
            { key: "fetalHeart", label: "Fetal Heart Rate (bpm)", type: "number" },
            { key: "presentation", label: "Presentation", type: "select", options: ["Cephalic", "Breech", "Transverse", "Unknown"] },
          ],
        },
        {
          title: "Assessment",
          fields: [
            { key: "riskFlags", label: "Risk Flags", type: "multiselect", options: ["Hypertension", "Anaemia", "Previous CS", "Multiple Gestation", "None"] },
            { key: "plan", label: "Plan", type: "textarea" },
          ],
        },
      ],
    },
    catalogue: [
      { code: "CONS-ANC", name: "Antenatal Consultation", category: "CONSULTATION", priceMinor: 2500000 },
      { code: "PROC-ANC-PKG", name: "Antenatal Package (per month)", category: "PROCEDURE", priceMinor: 25000000 },
      { code: "PROC-DEL-N", name: "Normal Delivery", category: "PROCEDURE", priceMinor: 120000000 },
      { code: "PROC-DEL-CS", name: "Caesarean Section", category: "PROCEDURE", priceMinor: 450000000 },
      { code: "LAB-PREG", name: "Pregnancy Test", category: "LAB", priceMinor: 100000 },
      { code: "US-OBST", name: "Obstetric Ultrasound", category: "IMAGING", priceMinor: 2000000 },
    ],
    modules: { wards: true },
  },

  PEDIATRICS: {
    key: "PEDIATRICS",
    name: "Pediatrics",
    description: "Child health, immunisation tracking, growth monitoring and pediatric care.",
    terminology: {
      ...DEFAULT_TERMINOLOGY,
      "patient.label": "Child",
      "patient.plural": "Children",
      "consultation.label": "Pediatric Consultation",
      "followup.label": "Review",
      "followup.plural": "Reviews",
      "doctor.label": "Pediatrician",
    },
    form: {
      key: "PED_EXAM",
      title: "Pediatric Examination",
      sections: [
        {
          title: "Growth & Vitals",
          fields: [
            { key: "weight", label: "Weight (kg)", type: "number", required: true },
            { key: "height", label: "Height (cm)", type: "number", required: true },
            { key: "temp", label: "Temperature", type: "number", unit: "°C" },
            { key: "muac", label: "MUAC (cm)", type: "number" },
          ],
        },
        {
          title: "Immunisation & Assessment",
          fields: [
            { key: "immunisation", label: "Immunisation Status", type: "select", options: ["Up to date", "Behind schedule", "Unknown"] },
            { key: "vaccineGiven", label: "Vaccine Given Today", type: "text" },
            { key: "findings", label: "Findings", type: "textarea" },
          ],
        },
      ],
    },
    catalogue: [
      { code: "CONS-PED", name: "Pediatric Consultation", category: "CONSULTATION", priceMinor: 2000000 },
      { code: "VAC-ROUTE", name: "Routine Immunisation", category: "PROCEDURE", priceMinor: 500000 },
      { code: "EXAM-WELL", name: "Well-Child Check", category: "EXAMINATION", priceMinor: 1200000 },
      { code: "LAB-MPS", name: "Malaria Parasite (RDT/Microscopy)", category: "LAB", priceMinor: 200000 },
    ],
    modules: {},
  },

  ORTHOPEDICS: {
    key: "ORTHOPEDICS",
    name: "Orthopedics",
    description: "Bone, joint and trauma care with imaging-first workflows.",
    terminology: {
      ...DEFAULT_TERMINOLOGY,
      "consultation.label": "Orthopedic Consultation",
      "procedure.label": "Orthopedic Procedure",
      "doctor.label": "Orthopedic Surgeon",
    },
    form: {
      key: "ORTH_EXAM",
      title: "Orthopedic Examination",
      sections: [
        {
          title: "Injury / Complaint",
          fields: [
            { key: "mechanism", label: "Mechanism of Injury", type: "textarea", required: true },
            { key: "region", label: "Region", type: "select", options: ["Upper Limb", "Lower Limb", "Spine", "Pelvis", "Other"] },
            { key: "romLimited", label: "Range of Motion Limited", type: "checkbox" },
          ],
        },
        {
          title: "Assessment",
          fields: [
            { key: "xrayFindings", label: "X-ray Findings", type: "textarea" },
            { key: "plan", label: "Plan", type: "textarea" },
          ],
        },
      ],
    },
    catalogue: [
      { code: "CONS-ORTH", name: "Orthopedic Consultation", category: "CONSULTATION", priceMinor: 3000000 },
      { code: "IMG-XRAY", name: "X-Ray (Plain)", category: "IMAGING", priceMinor: 1200000 },
      { code: "PROC-POP", name: "Plaster of Paris Cast", category: "PROCEDURE", priceMinor: 8000000 },
      { code: "PROC-REDUCT", name: "Closed Reduction", category: "PROCEDURE", priceMinor: 25000000 },
      { code: "PT-SESSION", name: "Physiotherapy Session", category: "PROCEDURE", priceMinor: 3000000 },
    ],
    modules: { wards: true },
  },

  ENT: {
    key: "ENT",
    name: "ENT (Otolaryngology)",
    description: "Ear, nose and throat care including audiology and endoscopy.",
    terminology: {
      ...DEFAULT_TERMINOLOGY,
      "consultation.label": "ENT Consultation",
      "doctor.label": "ENT Surgeon",
    },
    form: {
      key: "ENT_EXAM",
      title: "ENT Examination",
      sections: [
        {
          title: "Examination",
          fields: [
            { key: "ear", label: "Ear Findings", type: "textarea" },
            { key: "nose", label: "Nose / Sinus Findings", type: "textarea" },
            { key: "throat", label: "Throat Findings", type: "textarea" },
            { key: "audiometry", label: "Audiometry (if done)", type: "text" },
          ],
        },
      ],
    },
    catalogue: [
      { code: "CONS-ENT", name: "ENT Consultation", category: "CONSULTATION", priceMinor: 2500000 },
      { code: "PROC-SYRING", name: "Ear Syringing", category: "PROCEDURE", priceMinor: 800000 },
      { code: "PROC-AUDIO", name: "Audiometry", category: "EXAMINATION", priceMinor: 1500000 },
      { code: "IMG-CT-ENT", name: "CT Sinuses", category: "IMAGING", priceMinor: 6000000 },
    ],
    modules: {},
  },

  PHYSIOTHERAPY: {
    key: "PHYSIOTHERAPY",
    name: "Physiotherapy",
    description: "Rehabilitation sessions, mobility scoring and therapy plans.",
    terminology: {
      ...DEFAULT_TERMINOLOGY,
      "patient.label": "Client",
      "visit.label": "Session",
      "consultation.label": "Physiotherapy Assessment",
      "followup.label": "Next Session",
      "followup.plural": "Next Sessions",
      "doctor.label": "Physiotherapist",
    },
    form: {
      key: "PT_SESSION",
      title: "Physiotherapy Session",
      sections: [
        {
          title: "Assessment",
          fields: [
            { key: "painScore", label: "Pain Score (0–10)", type: "number", required: true },
            { key: "mobility", label: "Mobility", type: "select", options: ["Independent", "Walker", "Crutches", "Wheelchair", "Bed-bound"] },
            { key: "exercisesDone", label: "Exercises Performed", type: "textarea" },
          ],
        },
      ],
    },
    catalogue: [
      { code: "PT-ASSESS", name: "Physiotherapy Assessment", category: "CONSULTATION", priceMinor: 2500000 },
      { code: "PT-SESSION", name: "Physiotherapy Session", category: "PROCEDURE", priceMinor: 3000000 },
      { code: "PT-PKG", name: "Rehab Package (6 sessions)", category: "PROCEDURE", priceMinor: 15000000 },
    ],
    modules: {},
  },

  FERTILITY: {
    key: "FERTILITY",
    name: "Fertility Clinic",
    description: "Fertility assessments, cycle tracking and treatment cycles.",
    terminology: {
      ...DEFAULT_TERMINOLOGY,
      "visit.label": "Cycle Visit",
      "consultation.label": "Fertility Consultation",
      "doctor.label": "Fertility Specialist",
    },
    form: {
      key: "FERT_VISIT",
      title: "Fertility Visit",
      sections: [
        {
          title: "Cycle",
          fields: [
            { key: "cycleDay", label: "Cycle Day", type: "number", required: true },
            { key: "lmp", label: "LMP", type: "date" },
            { key: "scanFindings", label: "Scan Findings (follicle tracking)", type: "textarea" },
          ],
        },
        {
          title: "Plan",
          fields: [
            { key: "medications", label: "Medications", type: "textarea" },
            { key: "nextSteps", label: "Next Steps", type: "textarea" },
          ],
        },
      ],
    },
    catalogue: [
      { code: "CONS-FERT", name: "Fertility Consultation", category: "CONSULTATION", priceMinor: 5000000 },
      { code: "US-FOLL", name: "Follicular Tracking Scan", category: "IMAGING", priceMinor: 2500000 },
      { code: "LAB-HSG", name: "Hormone Profile", category: "LAB", priceMinor: 4500000 },
      { code: "LAB-SEMEN", name: "Semen Analysis", category: "LAB", priceMinor: 1500000 },
    ],
    modules: {},
  },

  MENTAL_HEALTH: {
    key: "MENTAL_HEALTH",
    name: "Mental Health",
    description: "Psychiatric consultations, therapy notes and risk assessment.",
    terminology: {
      ...DEFAULT_TERMINOLOGY,
      "consultation.label": "Therapy / Psychiatric Session",
      "followup.label": "Next Session",
      "followup.plural": "Next Sessions",
      "doctor.label": "Clinician",
    },
    form: {
      key: "MH_SESSION",
      title: "Mental Health Session",
      sections: [
        {
          title: "Session",
          fields: [
            { key: "mood", label: "Mood (1–10)", type: "number", required: true },
            { key: "riskAssessment", label: "Risk Assessment", type: "select", options: ["None identified", "Low", "Moderate", "High - escalate"], required: true },
            { key: "sessionNotes", label: "Session Notes (confidential)", type: "textarea" },
          ],
        },
      ],
    },
    catalogue: [
      { code: "CONS-MH", name: "Psychiatric Consultation", category: "CONSULTATION", priceMinor: 3500000 },
      { code: "TH-CBT", name: "Therapy Session (CBT)", category: "PROCEDURE", priceMinor: 4000000 },
      { code: "LAB-LEVELS", name: "Medication Level Monitoring", category: "LAB", priceMinor: 1500000 },
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

/** The terminology keys a facility may customize in Settings. */
export const TERMINOLOGY_KEYS = Object.keys(DEFAULT_TERMINOLOGY);
export const DEFAULT_TERMINOLOGY_PUBLIC: Record<string, string> = DEFAULT_TERMINOLOGY;

/**
 * Merge terminology for a facility: platform defaults < service profile < facility overrides.
 * `overridesJson` is Facility.termOverrides (JSON string of Record<string,string>).
 */
export function resolveTerminology(profileKey: string, overridesJson: string | null | undefined): Record<string, string> {
  const merged: Record<string, string> = { ...DEFAULT_TERMINOLOGY, ...getProfile(profileKey).terminology };
  if (overridesJson) {
    try {
      const parsed = JSON.parse(overridesJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string" && v.trim() && TERMINOLOGY_KEYS.includes(k)) merged[k] = v.trim().slice(0, 60);
        }
      }
    } catch {
      // corrupted JSON: fall through to profile terminology
    }
  }
  return merged;
}

export const DEPARTMENTS = ["GENERAL", "OPHTHALMOLOGY", "DENTAL", "LABORATORY", "IMAGING", "MATERNITY", "PEDIATRICS", "PHARMACY"];
