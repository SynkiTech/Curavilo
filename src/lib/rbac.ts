// RBAC — roles and granular permissions. Deny by default. (spec §16, §17)

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
    "ai:ask",
  ],
  DOCTOR: [
    "patients:read",
    "appointments:read",
    "queue:operate",
    "encounters:read", "encounters:write",
    "billing:read",
    "reports:read",
    "ai:ask",
  ],
  LAB: ["patients:read", "encounters:read"],
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
  staff: "staff:read",
  workflows: "patients:read",
  audit: "audit:read",
  settings: "settings:manage",
};
