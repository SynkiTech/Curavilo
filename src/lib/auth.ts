// Auth — scrypt passwords + DB-backed opaque sessions (ADR 0005).
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { hasPermission, permissionsForRole, type Permission } from "@/lib/rbac";

const SESSION_COOKIE = "curavilo_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

function tokenToHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, orgId: string | null): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: { userId, orgId, tokenHash: tokenToHash(token), expiresAt },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.SANDBOX !== "1",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
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
}

/** Resolve the current session into a fully-verified tenant context, or null. */
export async function getAuth(): Promise<AuthContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: tokenToHash(token) },
    include: {
      user: true,
      org: true,
    },
  });
  if (!session || session.expiresAt < new Date() || !session.orgId) return null;

  const membership = await db.membership.findFirst({
    where: { userId: session.userId, orgId: session.orgId, active: true },
  });
  if (!membership) return null;

  // Resolve active facility: stored value must belong to the same org.
  let facilityId = session.activeFacilityId;
  let facility = facilityId
    ? await db.facility.findFirst({ where: { id: facilityId, orgId: session.orgId } })
    : null;
  if (!facility) {
    facility = await db.facility.findFirst({ where: { orgId: session.orgId }, orderBy: { createdAt: "asc" } });
    if (!facility) return null;
    facilityId = facility.id;
  }

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
    permissions: permissionsForRole(membership.role),
    sessionId: session.id,
  };
}

export async function setActiveFacility(userId: string, orgId: string, facilityId: string): Promise<boolean> {
  const facility = await db.facility.findFirst({ where: { id: facilityId, orgId } });
  if (!facility) return false;
  await db.session.updateMany({
    where: { userId, orgId },
    data: { activeFacilityId: facilityId },
  });
  return true;
}

export function can(ctx: AuthContext | null, permission: Permission): boolean {
  if (!ctx) return false;
  return hasPermission(ctx.role, permission);
}
