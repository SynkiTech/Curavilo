// Central dashboard configuration (ADR 0011, spec §23/§53/§67).
// Role + permission set + service profile resolve into ONE ordered widget list
// and set of quick actions. The overview renders this configuration; server
// APIs independently gate every dataset. No scattered "if role ===" branches.

import type { Permission } from "@/lib/rbac";

export type DashboardWidgetId =
  | "kpi-band"
  | "quick-actions"
  | "today-appointments"
  | "live-queue"
  | "revenue-trend"
  | "payment-mix"
  | "patient-volume"
  | "recent-payments"
  | "alerts-low-stock"
  | "expiring-stock"
  | "today-sales"
  | "pending-results"
  | "my-tasks"
  | "team-messages"
  | "expense-pipeline"
  | "hr-requests";

export interface DashboardWidget {
  id: DashboardWidgetId;
  span?: "wide" | "half";
}

export interface QuickAction {
  id: string;
  label: string;
  view: string;
  icon: string; // lucide icon key resolved in the overview
  permission?: Permission;
}

export interface DashboardConfig {
  widgets: DashboardWidget[];
  quickActions: QuickAction[];
}

/** Per-role widget layouts (spec §67). Anything not listed falls back to STAFF. */
const ROLE_WIDGETS: Record<string, DashboardWidget[]> = {
  OWNER: [
    { id: "kpi-band" }, { id: "quick-actions" }, { id: "team-messages" },
    { id: "revenue-trend", span: "wide" }, { id: "payment-mix" },
    { id: "today-appointments" }, { id: "live-queue" },
    { id: "patient-volume" }, { id: "today-sales" },
    { id: "alerts-low-stock" }, { id: "expiring-stock" },
    { id: "recent-payments" }, { id: "my-tasks" },
  ],
  ADMIN: [
    { id: "kpi-band" }, { id: "quick-actions" }, { id: "team-messages" },
    { id: "revenue-trend", span: "wide" }, { id: "payment-mix" },
    { id: "today-appointments" }, { id: "live-queue" },
    { id: "patient-volume" },
    { id: "alerts-low-stock" }, { id: "recent-payments" }, { id: "my-tasks" },
  ],
  DOCTOR: [
    { id: "kpi-band" }, { id: "quick-actions" }, { id: "team-messages" },
    { id: "today-appointments" }, { id: "live-queue" },
    { id: "pending-results" }, { id: "patient-volume" }, { id: "my-tasks" },
  ],
  OPHTHALMOLOGIST: [
    { id: "kpi-band" }, { id: "quick-actions" }, { id: "team-messages" },
    { id: "today-appointments" }, { id: "live-queue" },
    { id: "pending-results" }, { id: "patient-volume" }, { id: "my-tasks" },
  ],
  OPTOMETRIST: [
    { id: "kpi-band" }, { id: "quick-actions" }, { id: "team-messages" },
    { id: "today-appointments" }, { id: "live-queue" },
    { id: "patient-volume" }, { id: "my-tasks" },
  ],
  DENTIST: [
    { id: "kpi-band" }, { id: "quick-actions" }, { id: "team-messages" },
    { id: "today-appointments" }, { id: "live-queue" },
    { id: "pending-results" }, { id: "patient-volume" }, { id: "my-tasks" },
  ],
  NURSE: [
    { id: "kpi-band" }, { id: "quick-actions" }, { id: "team-messages" },
    { id: "live-queue" }, { id: "today-appointments" },
    { id: "pending-results" }, { id: "my-tasks" },
  ],
  RECEPTIONIST: [
    { id: "kpi-band" }, { id: "quick-actions" }, { id: "team-messages" },
    { id: "today-appointments" }, { id: "live-queue" },
    { id: "recent-payments" }, { id: "my-tasks" },
  ],
  PHARMACY: [
    { id: "kpi-band" }, { id: "quick-actions" }, { id: "team-messages" },
    { id: "today-sales" }, { id: "alerts-low-stock" },
    { id: "expiring-stock" }, { id: "my-tasks" },
  ],
  OPTICIAN: [
    { id: "kpi-band" }, { id: "quick-actions" }, { id: "team-messages" },
    { id: "today-sales" }, { id: "alerts-low-stock" },
    { id: "expiring-stock" }, { id: "my-tasks" },
  ],
  LAB: [
    { id: "kpi-band" }, { id: "quick-actions" }, { id: "team-messages" },
    { id: "pending-results" }, { id: "my-tasks" },
  ],
  BILLING: [
    { id: "kpi-band" }, { id: "quick-actions" }, { id: "team-messages" },
    { id: "revenue-trend", span: "wide" }, { id: "payment-mix" },
    { id: "recent-payments" }, { id: "today-sales" }, { id: "my-tasks" },
  ],
  ACCOUNTANT: [
    { id: "kpi-band" }, { id: "quick-actions" }, { id: "team-messages" },
    { id: "revenue-trend", span: "wide" }, { id: "payment-mix" },
    { id: "expense-pipeline" }, { id: "recent-payments" }, { id: "my-tasks" },
  ],
  INVENTORY: [
    { id: "kpi-band" }, { id: "quick-actions" }, { id: "team-messages" },
    { id: "alerts-low-stock" }, { id: "expiring-stock" }, { id: "my-tasks" },
  ],
  HR: [
    { id: "kpi-band" }, { id: "quick-actions" }, { id: "team-messages" },
    { id: "hr-requests" }, { id: "my-tasks" },
  ],
  STAFF: [
    { id: "kpi-band" }, { id: "quick-actions" }, { id: "team-messages" }, { id: "my-tasks" },
  ],
};

/** Widgets each permission unlocks. A widget renders only when its gate passes. */
export const WIDGET_PERMISSION: Record<DashboardWidgetId, Permission | null> = {
  "kpi-band": null, // role-aware KPI set rendered by the overview (clinical/finance/HR)
  "quick-actions": null,
  "today-appointments": "appointments:read",
  "live-queue": "queue:operate",
  "revenue-trend": "billing:read",
  "payment-mix": "billing:read",
  "patient-volume": "encounters:read",
  "recent-payments": "billing:read",
  "alerts-low-stock": "inventory:read",
  "expiring-stock": "inventory:read",
  "today-sales": "pos:sell",
  "pending-results": "lab:operate",
  "my-tasks": null,
  "team-messages": null,
  "expense-pipeline": "accounting:read",
  "hr-requests": "hr:read",
};

const DEFAULT_ACTIONS: QuickAction[] = [
  { id: "qa-patient", label: "Register patient", view: "patients", icon: "UserPlus", permission: "patients:write" },
  { id: "qa-appointment", label: "New appointment", view: "appointments", icon: "CalendarDays", permission: "appointments:write" },
  { id: "qa-queue", label: "Open queue", view: "queue", icon: "ListOrdered", permission: "queue:operate" },
  { id: "qa-encounter", label: "Start encounter", view: "encounters", icon: "ClipboardPlus", permission: "encounters:write" },
  { id: "qa-billing", label: "Billing", view: "billing", icon: "ReceiptText", permission: "billing:read" },
  { id: "qa-pos", label: "Open POS", view: "pos", icon: "ShoppingCart", permission: "pos:sell" },
  { id: "qa-inventory", label: "Inventory", view: "inventory", icon: "Boxes", permission: "inventory:read" },
  { id: "qa-lab", label: "Lab worklist", view: "lab", icon: "FlaskConical", permission: "lab:operate" },
  { id: "qa-reports", label: "Reports", view: "reports", icon: "BarChart3", permission: "reports:read" },
  { id: "qa-ai", label: "Ask AI", view: "ai", icon: "Sparkles", permission: "ai:ask" },
  { id: "qa-staff", label: "Staff", view: "staff", icon: "UserCog", permission: "staff:read" },
  { id: "qa-accounting", label: "Accounting", view: "accounting", icon: "Landmark", permission: "accounting:read" },
  { id: "qa-hr", label: "Human Resources", view: "hr", icon: "Contact", permission: "hr:read" },
];

/**
 * Resolve the dashboard for a user. Custom roles keep their built-in base role
 * layout (layout follows the closest clinical family) but the permission gates
 * apply to every widget, so a restricted custom role sees a restricted board.
 */
export function getDashboardConfig(input: {
  role: string;
  permissions: Permission[];
  serviceProfileKey: string;
  department?: string | null;
}): DashboardConfig {
  const baseRole = (ROLE_WIDGETS[input.role] ? input.role : "STAFF") as string;
  const widgets = (ROLE_WIDGETS[baseRole] ?? ROLE_WIDGETS.STAFF).filter((w) => {
    const perm = WIDGET_PERMISSION[w.id];
    return !perm || input.permissions.includes(perm);
  });
  const quickActions = DEFAULT_ACTIONS.filter((a) => !a.permission || input.permissions.includes(a.permission));
  return { widgets, quickActions };
}

// ─── Personalization (client-side) ──────────────────────────────────────────

export interface DashboardPrefs {
  hidden?: string[];
  order?: string[];
}

/** Apply stored personalization; can only hide/reorder allowed widgets. */
export function applyPrefs(config: DashboardConfig, prefs: DashboardPrefs | null): DashboardConfig {
  if (!prefs) return config;
  const hidden = new Set(prefs.hidden ?? []);
  const widgets = config.widgets
    .filter((w) => !hidden.has(w.id))
    .sort((a, b) => {
      const ia = prefs.order?.indexOf(a.id) ?? -1;
      const ib = prefs.order?.indexOf(b.id) ?? -1;
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  return { ...config, widgets };
}
