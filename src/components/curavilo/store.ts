"use client";

// App state: session + SPA navigation (single visible route constraint)
import { create } from "zustand";
import type { SessionInfo, SessionUser } from "./api";

export type ViewName =
  | "overview" | "patients" | "patient-detail" | "appointments" | "queue" | "encounters"
  | "encounter-detail" | "billing" | "invoice-detail" | "pos" | "inventory" | "reports"
  | "accounting" | "hr" | "ai" | "workflows" | "audit" | "staff" | "settings" | "followups" | "onboarding"
  | "lab" | "wards" | "command" | "simulation" | "comms" | "data" | "myday";

export interface ViewRoute {
  view: ViewName;
  params?: Record<string, string>;
}

interface AppState {
  booted: boolean;
  session: SessionInfo | null;
  route: ViewRoute;
  aiPatientContext: { id: string; name: string } | null;
  setBooted: (b: boolean) => void;
  setSession: (s: SessionInfo | null) => void;
  navigate: (view: ViewName, params?: Record<string, string>) => void;
  setAiPatientContext: (ctx: { id: string; name: string } | null) => void;
}

export const useApp = create<AppState>((set) => ({
  booted: false,
  session: null,
  route: { view: "overview" },
  aiPatientContext: null,
  setBooted: (booted) => set({ booted }),
  setSession: (session) => set({ session }),
  navigate: (view, params) => set({ route: { view, params } }),
  setAiPatientContext: (aiPatientContext) => set({ aiPatientContext }),
}));

export function user(): SessionUser | null {
  return useApp.getState().session?.user ?? null;
}

export function can(permission: string): boolean {
  return !!useApp.getState().session?.user?.permissions.includes(permission);
}

// ─── Facility terminology (settings-driven labels, reflect facility-wide) ───

const TERMINOLOGY_DEFAULTS: Record<string, string> = {
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

/** Resolve a terminology key for the signed-in facility (server-merged, defaults as fallback). */
export function term(key: string): string {
  return useApp.getState().session?.terminology?.[key] ?? TERMINOLOGY_DEFAULTS[key] ?? key;
}

/** React hook variant - re-renders when the session (terminology) changes. */
export function useTerm(key: string): string {
  return useApp((s) => s.session?.terminology?.[key] ?? TERMINOLOGY_DEFAULTS[key] ?? key);
}
