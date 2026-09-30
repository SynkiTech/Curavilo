// RBAC - roles and granular permissions. Deny by default. (spec §16, §17)

export const PERMISSIONS = [
  "patients:read",
  "patients:write",
  "appointments:read",
  "appointments:write",
  "queue:operate",
  "encounters:read",
  "encounters:write",
  "billing:read",
  "billing:write",
  "payments:record",
  "inventory:read",
  "inventory:write",
  "pos:sell",
  "reports:read",
  "ai:ask",
  "audit:read",
  "staff:read",
  "staff:manage",
  "settings:manage",
  // Phase 5–13 additions
  "workflows:manage",
  "lab:operate", // order/specimen/result/verify/release diagnostics
  "inpatient:manage", // wards, beds, admissions, discharge
  "portals:manage", // portal tokens + leave approvals
  "data:manage", // import/export
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  "OWNER",
  "ADMIN",
  "RECEPTIONIST",
  "NURSE",
  "DOCTOR",
  "LAB",
  "PHARMACY",
  "BILLING",
  "STAFF",
] as const;

export type Role = (typeof ROLES)[number];

const ALL: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: ALL,
  ADMIN: ALL,
  RECEPTIONIST: [
    "patients:read", "patients:write",
    "appointments:read", "appointments:write",
    "queue:operate",
    "encounters:read",
    "billing:read",
    "ai:ask",
    "staff:read",
  ],
  NURSE: [
    "patients:read", "patients:write",
    "appointments:read",
    "queue:operate",
    "encounters:read", "encounters:write",
    "lab:operate",
    "inpatient:manage",
    "ai:ask",
  ],
  DOCTOR: [
    "patients:read",
    "appointments:read",
    "queue:operate",
    "encounters:read", "encounters:write",
    "billing:read",
    "reports:read",
    "lab:operate",
    "inpatient:manage",
    "ai:ask",
  ],
  LAB: [
    "patients:read",
    "encounters:read",
    "lab:operate",
    "inventory:read",
  ],
  PHARMACY: [
    "patients:read",
    "inventory:read", "inventory:write",
    "pos:sell",
    "billing:read",
  ],
  BILLING: [
    "patients:read",
    "billing:read", "billing:write",
    "payments:record",
    "reports:read",
    "ai:ask",
  ],
  STAFF: ["patients:read"],
};

export function permissionsForRole(role: string): Permission[] {
  const perms = ROLE_PERMISSIONS[role as Role];
  return perms ? [...perms] : [];
}

export function hasPermission(role: string, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

/** Nav modules a role can see. Maps module -> required permission. */
export const MODULE_PERMISSION: Record<string, Permission> = {
  overview: "patients:read",
  patients: "patients:read",
  appointments: "appointments:read",
  queue: "queue:operate",
  encounters: "encounters:read",
  billing: "billing:read",
  pos: "pos:sell",
  inventory: "inventory:read",
  reports: "reports:read",
  ai: "ai:ask",
  lab: "lab:operate",
  wards: "inpatient:manage",
  workflows: "patients:read",
  command: "reports:read",
  simulation: "reports:read",
  comms: "settings:manage",
  data: "data:manage",
  staff: "staff:read",
  myday: "patients:read",
  audit: "audit:read",
  settings: "settings:manage",
};
