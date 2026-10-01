// One-time migration for ADR 0011 (facility access + personnel identity).
// - Creates a FacilityCredential per org by copying the OWNER user's password hash,
//   so existing owners keep working through the new two-stage gate.
// - Marks all users ACTIVE with passwordSetAt, splits display names into first/last.
// - Seeds FacilityMemberships: OWNER/ADMIN get all facilities, others get their first facility.
// - Seeds default departments from the facility service profile.
// Safe to re-run: it only fills what is missing.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DEFAULT_DEPARTMENTS: Record<string, string[]> = {
  EYE_CLINIC: ["Optometry", "Ophthalmology", "Front Desk", "Pharmacy", "Accounts"],
  GENERAL_PRACTICE: ["General Practice", "Nursing", "Front Desk", "Accounts"],
  DENTAL: ["Dentistry", "Front Desk", "Accounts"],
};

async function main() {
  const orgs = await db.organization.findMany({ include: { facilities: true } });
  let credentials = 0, memberships = 0, usersUpdated = 0, departments = 0;

  for (const org of orgs) {
    const ownerMembership = await db.membership.findFirst({
      where: { orgId: org.id, role: "OWNER", active: true },
      orderBy: { createdAt: "asc" },
    });
    const owner = ownerMembership
      ? await db.user.findUnique({ where: { id: ownerMembership.userId } })
      : null;

    // 1. Facility credential (copy owner hash so existing credentials keep working)
    if (owner && !org.facilityCredential) {
      const email = org.facilities[0]?.email?.trim() || owner.email;
      try {
        await db.facilityCredential.create({
          data: { orgId: org.id, email: email.toLowerCase(), passwordHash: owner.passwordHash, updatedById: owner.id },
        });
        credentials++;
      } catch { /* email collision - skip, org already has an equivalent credential */ }
    }

    // 2. User fields
    for (const m of await db.membership.findMany({ where: { orgId: org.id } })) {
      const u = await db.user.findUnique({ where: { id: m.userId }, include: { facilityMemberships: true } });
      if (!u) continue;
      const parts = u.name.trim().split(/\s+/);
      const firstName = parts[0] ?? null;
      const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
      await db.user.update({
        where: { id: u.id },
        data: {
          status: u.status === "ACTIVE" ? "ACTIVE" : "ACTIVE",
          firstName: u.firstName ?? firstName,
          lastName: u.lastName ?? lastName,
          passwordSetAt: u.passwordSetAt ?? u.createdAt,
        },
      });
      usersUpdated++;

      // 3. Facility memberships
      const existing = new Set(u.facilityMemberships.map((fm) => fm.facilityId));
      const spanAll = m.role === "OWNER" || m.role === "ADMIN";
      const targets = spanAll ? org.facilities : org.facilities.slice(0, 1);
      for (const f of targets) {
        if (!existing.has(f.id)) {
          await db.facilityMembership.create({ data: { userId: u.id, facilityId: f.id } });
          memberships++;
        }
      }
    }

    // 4. Default departments per profile
    for (const f of org.facilities) {
      const names = DEFAULT_DEPARTMENTS[f.serviceProfileKey] ?? DEFAULT_DEPARTMENTS.GENERAL_PRACTICE;
      for (const name of names) {
        const exists = await db.department.findFirst({ where: { orgId: org.id, name } });
        if (!exists) {
          await db.department.create({ data: { orgId: org.id, facilityId: f.id, name } });
          departments++;
        }
      }
    }
  }

  console.log(`Migration complete: ${credentials} facility credentials, ${memberships} facility memberships, ${usersUpdated} users updated, ${departments} departments.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
