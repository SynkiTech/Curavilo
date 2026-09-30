"use client";

// App state: session + SPA navigation (single visible route constraint)
import { create } from "zustand";
import type { SessionInfo, SessionUser } from "./api";

export type ViewName =
  | "overview" | "patients" | "patient-detail" | "appointments" | "queue" | "encounters"
  | "encounter-detail" | "billing" | "invoice-detail" | "pos" | "inventory" | "reports"
  | "ai" | "workflows" | "audit" | "staff" | "settings" | "followups" | "onboarding";

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
