// Auth - scrypt passwords + DB-backed opaque sessions (ADR 0005) + two-stage
// facility access gate (ADR 0011). Stage 1 issues a permissionless GateSession
// ("this browser passed the facility gate for org X"); stage 2 resolves the
// individual staff identity and issues the real application session.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { permissionsForRole, PROTECTED_PERMISSIONS, PERMISSIONS, type Permission } from "@/lib/rbac";

const SESSION_COOKIE = "curavilo_session";
const GATE_COOKIE = "curavilo_gate";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // absolute lifetime
const SESSION_IDLE_TTL_MS = 12 * 60 * 60 * 1000; // inactivity timeout (shared workstations)
const GATE_TTL_MS = 30 * 60 * 1000; // short-lived, sliding on use (shared-computer safe)

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Password policy: 8+ chars with at least one letter and one digit. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < 8 || password.length > 100) return "Password must be 8 to 100 characters.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Password must include at least one letter and one number.";
  return null;
}

function tokenToHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Hash an opaque one-time token (invite/reset) for DB storage. Shared by auth route + staff module. */
export const hashToken = tokenToHash;

/** Generate a pronounceable-enough temporary password that satisfies the policy. */
export function generateTempPassword(): string {
  const words = ["ward", "clinic", "vital", "lens", "pulse", "chart", "calm", "check", "optic", "care"];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  const n = Math.floor(Math.random() * 90) + 10;
  const symbol = "!@#$%"[Math.floor(Math.random() * 5)];
  return `${pick()}${pick().replace(/^./, (c) => c.toUpperCase())}${n}${symbol}`;
}

/** Cookie attributes shared by every auth cookie (portals included). */
export function authCookieAttrs(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && process.env.SANDBOX !== "1",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Opportunistic housekeeping: remove dead sessions so stolen-expired rows cannot linger. */
export async function pruneExpiredSessions(): Promise<void> {
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
  await db.gateSession.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
}

// ─── Application (staff) session ────────────────────────────────────────────

export async function createSession(userId: string, orgId: string | null): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: { userId, orgId, tokenHash: tokenToHash(token), expiresAt },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, authCookieAttrs(SESSION_TTL_MS / 1000));
  return token;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: tokenToHash(token) } });
  }
  jar.delete(SESSION_COOKIE);
}

/** Invalidate every session of a user (deactivation, suspension, password reset). */
export async function destroyUserSessions(userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}

// ─── Facility gate session (stage 1) ────────────────────────────────────────

export async function createGateSession(orgId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + GATE_TTL_MS);
  await db.gateSession.create({ data: { orgId, tokenHash: tokenToHash(token), expiresAt } });
  const jar = await cookies();
  jar.set(GATE_COOKIE, token, authCookieAttrs(GATE_TTL_MS / 1000));
}

/** Resolve + slide the gate session. Returns the gated org, or null. */
export async function getGate(): Promise<{ orgId: string; orgName: string; expiresAt: Date } | null> {
  const jar = await cookies();
  const token = jar.get(GATE_COOKIE)?.value;
  if (!token) return null;
  const gate = await db.gateSession.findUnique({
    where: { tokenHash: tokenToHash(token) },
    include: { org: { select: { name: true } } },
  });
  if (!gate || gate.expiresAt < new Date()) return null;
  const expiresAt = new Date(Date.now() + GATE_TTL_MS);
  // Sliding renewal keeps a shift workstation on the personnel screen without
  // ever leaving an indefinitely valid facility context behind.
  await db.gateSession.update({ where: { id: gate.id }, data: { expiresAt } }).catch(() => undefined);
  return { orgId: gate.orgId, orgName: gate.org.name, expiresAt };
}

/** Destroy the gate session. When clearCookie is false the cookie value is kept (already dead). */
export async function destroyGateSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(GATE_COOKIE)?.value;
  if (token) {
    await db.gateSession.deleteMany({ where: { tokenHash: tokenToHash(token) } });
  }
  jar.delete(GATE_COOKIE);
}

// ─── Permission resolution (role / custom role + overrides) ────────────────

export async function resolvePermissions(
  role: string,
  customRole: { permissions: string; active: boolean } | null,
  userId: string
): Promise<Permission[]> {
  let permissions: string[];
  if (customRole && customRole.active) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(customRole.permissions);
    } catch {
      parsed = [];
    }
    permissions = Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } else {
    permissions = permissionsForRole(role);
  }
  const overrides = await db.permissionOverride.findMany({ where: { userId } });
  const set = new Set<string>(permissions);
  for (const o of overrides) {
    if (PROTECTED_PERMISSIONS.has(o.permission)) continue; // never escalatable
    if (o.effect === "GRANT") set.add(o.permission);
    else if (o.effect === "DENY") set.delete(o.permission);
  }
  return [...set].filter((p) => PERMISSION_GUARD.has(p)) as Permission[];
}

const PERMISSION_GUARD: ReadonlySet<string> = new Set<string>(PERMISSIONS);

// ─── Auth context ───────────────────────────────────────────────────────────

export interface AuthContext {
  userId: string;
  userName: string;
  email: string;
  orgId: string;
  orgName: string;
  currency: string;
  timezone: string;
  facilityId: string;
  facilityName: string;
  serviceProfileKey: string;
  role: string;
  permissions: Permission[];
  sessionId: string;
  // Personnel identity context (spec §35)
  status: string;
  mustChangePassword: boolean;
  department: string | null;
  serviceLine: string | null;
  staffCode: string | null;
  designation: string | null;
  customRoleId: string | null;
}

/**
 * Facilities a user may open: OWNER/ADMIN span the whole organization,
 * everyone else only their explicit FacilityMembership assignments.
 */
export async function accessibleFacilityIds(orgId: string, role: string, userId: string): Promise<string[]> {
  if (role === "OWNER" || role === "ADMIN") {
    const all = await db.facility.findMany({ where: { orgId }, select: { id: true } });
    return all.map((f) => f.id);
  }
  const assigned = await db.facilityMembership.findMany({ where: { userId }, select: { facilityId: true } });
  const ids = assigned.map((a) => a.facilityId);
  const valid = await db.facility.findMany({ where: { id: { in: ids }, orgId }, select: { id: true } });
  return valid.map((f) => f.id);
}

/** Resolve the current session into a fully-verified tenant context, or null. */
export async function getAuth(): Promise<AuthContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: tokenToHash(token) },
    include: {
      user: { include: { department: true, overrides: true } },
      org: true,
    },
  });
  if (!session || session.expiresAt < new Date() || !session.orgId) return null;

  // Idle timeout: a session unused for SESSION_IDLE_TTL dies even if its
  // absolute expiry has not passed (shared reception/clinical workstations).
  const idleMs = Date.now() - session.lastSeenAt.getTime();
  if (idleMs > SESSION_IDLE_TTL_MS) {
    await db.session.deleteMany({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  // Slide the idle window; throttle writes to at most once per minute per session.
  if (idleMs > 60_000) {
    await db.session.updateMany({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }

  const membership = await db.membership.findFirst({
    where: { userId: session.userId, orgId: session.orgId, active: true },
    include: { customRole: true },
  });
  if (!membership) return null;

  // Non-active personnel can never use an old session (spec §28).
  if (session.user.status !== "ACTIVE") return null;

  // Resolve active facility: must belong to the org AND be accessible to this user.
  const allowed = await accessibleFacilityIds(session.orgId, membership.role, session.userId);
  let facilityId = session.activeFacilityId;
  if (!facilityId || !allowed.includes(facilityId)) {
    facilityId = allowed[0] ?? null;
    if (!facilityId) return null;
    await db.session.updateMany({ where: { id: session.id }, data: { activeFacilityId: facilityId } }).catch(() => undefined);
  }
  const facility = await db.facility.findFirst({ where: { id: facilityId, orgId: session.orgId } });
  if (!facility) return null;

  const permissions = await resolvePermissions(membership.role, membership.customRole, session.userId);

  return {
    userId: session.user.id,
    userName: session.user.name,
    email: session.user.email,
    orgId: session.orgId,
    orgName: session.org?.name ?? "",
    currency: session.org?.currency ?? "NGN",
    timezone: session.org?.timezone ?? "Africa/Lagos",
    facilityId: facility.id,
    facilityName: facility.name,
    serviceProfileKey: facility.serviceProfileKey,
    role: membership.role,
    permissions,
    sessionId: session.id,
    status: session.user.status,
    mustChangePassword: session.user.mustChangePassword,
    department: session.user.department?.name ?? null,
    serviceLine: session.user.serviceLine ?? facility.serviceProfileKey,
    staffCode: session.user.staffCode,
    designation: session.user.designation,
    customRoleId: membership.customRoleId,
  };
}

export async function setActiveFacility(userId: string, orgId: string, facilityId: string): Promise<boolean> {
  const facility = await db.facility.findFirst({ where: { id: facilityId, orgId } });
  if (!facility) return false;
  const membership = await db.membership.findFirst({ where: { userId, orgId, active: true } });
  if (!membership) return false;
  const allowed = await accessibleFacilityIds(orgId, membership.role, userId);
  if (!allowed.includes(facilityId)) return false;
  await db.session.updateMany({
    where: { userId, orgId },
    data: { activeFacilityId: facilityId },
  });
  return true;
}

export function can(ctx: AuthContext | null, permission: Permission): boolean {
  if (!ctx) return false;
  return ctx.permissions.includes(permission);
}
