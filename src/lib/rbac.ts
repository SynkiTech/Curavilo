// RBAC - roles and granular permissions. Deny by default. (spec §16, §17, ADR 0011)
//
// Resolution order for a user's effective permission set (server-side, see src/lib/auth.ts):
//   1. Built-in role defaults OR CustomRole.permissions (when membership.customRoleId is set)
//   2. + per-user GRANT overrides   3. - per-user DENY overrides
// PROTECTED_PERMISSIONS can never be added by custom roles or overrides - they are OWNER-only.

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
  "pos:refund", // returns, refunds, voids at the POS
  "reports:read",
  "ai:ask",
  "audit:read",
  "staff:read",
  "staff:manage",
  "settings:manage",
  "org:manage", // facility access credential, subscription, organization administration (OWNER-only)
  "roles:manage", // custom roles + permission overrides (OWNER-only)
  // Phase 5-13 additions
  "workflows:manage",
  "lab:operate", // order/specimen/result/verify/release diagnostics
  "inpatient:manage", // wards, beds, admissions, discharge
  "portals:manage", // portal tokens + leave approvals
  "data:manage", // import/export
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Platform-protected permissions: never grantable through custom roles or user overrides. */
export const PROTECTED_PERMISSIONS: ReadonlySet<string> = new Set(["org:manage", "roles:manage"]);

export const ROLES = [
  "OWNER",
  "ADMIN",
  "RECEPTIONIST",
  "NURSE",
  "DOCTOR",
  "OPHTHALMOLOGIST",
  "OPTOMETRIST",
  "OPTICIAN",
  "DENTIST",
  "LAB",
  "PHARMACY",
  "BILLING",
  "INVENTORY",
  "STAFF",
] as const;

export type Role = (typeof ROLES)[number];

const ALL: Permission[] = [...PERMISSIONS];
// ADMIN is deliberately NOT the OWNER set (spec §11/§44): the two protected
// owner-only permissions stay out, everything administrative is granted.
const ADMIN: Permission[] = ALL.filter((p) => !PROTECTED_PERMISSIONS.has(p));

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: ALL,
  ADMIN,
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
  OPHTHALMOLOGIST: [
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
  OPTOMETRIST: [
    "patients:read",
    "appointments:read",
    "queue:operate",
    "encounters:read", "encounters:write",
    "reports:read",
    "ai:ask",
  ],
  OPTICIAN: [
    "patients:read",
    "appointments:read",
    "inventory:read", "inventory:write",
    "pos:sell",
    "billing:read",
  ],
  DENTIST: [
    "patients:read",
    "appointments:read",
    "queue:operate",
    "encounters:read", "encounters:write",
    "billing:read",
    "reports:read",
    "lab:operate",
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
    "pos:sell", "pos:refund",
    "billing:read",
    "reports:read",
  ],
  BILLING: [
    "patients:read",
    "billing:read", "billing:write",
    "payments:record",
    "reports:read",
    "ai:ask",
  ],
  INVENTORY: [
    "inventory:read", "inventory:write",
    "reports:read",
  ],
  STAFF: ["patients:read"],
};

export function permissionsForRole(role: string): Permission[] {
  const perms = ROLE_PERMISSIONS[role as Role];
  return perms ? [...perms] : [];
}

export function isBuiltinRole(role: string): boolean {
  return (ROLES as readonly string[]).includes(role);
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

export const STAFF_STATUSES = ["INVITED", "ACTIVE", "INACTIVE", "SUSPENDED", "LOCKED", "TERMINATED"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

/** Statuses that may authenticate. Everything else is locked out of the personnel gate. */
export function canAuthenticate(status: string): boolean {
  return status === "ACTIVE";
}
