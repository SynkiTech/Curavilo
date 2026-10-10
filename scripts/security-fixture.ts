// Security suite fixtures (bun scripts/security-fixture.ts up|down)
// up:   creates a SECOND facility inside the eye-clinic org + one patient in
//       it, used to prove cross-facility PHI isolation for non-admin roles.
// down: removes the fixture and any throwaway "secprobe-*" orgs.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const marker = "SEC-FIXTURE";

async function up() {
  const org = await db.organization.findUniqueOrThrow({ where: { slug: "lagos-central-eye-clinic" } }).catch(async () => {
    // Fall back to the first org with the eye gate credential.
    const cred = await db.facilityCredential.findUniqueOrThrow({ where: { email: "eyeclinic@curavilo.demo" } });
    return db.organization.findUniqueOrThrow({ where: { id: cred.orgId } });
  });
  const existing = await db.facility.findFirst({ where: { orgId: org.id, name: marker } });
  if (existing) {
    const p = await db.patient.findFirst({ where: { facilityId: existing.id } });
    console.log(JSON.stringify({ orgId: org.id, facilityId: existing.id, patientId: p?.id ?? "" }));
    return;
  }
  const facility = await db.facility.create({
    data: { orgId: org.id, name: marker, type: "CLINIC", serviceProfileKey: "EYE_CLINIC" },
  });
  const patient = await db.patient.create({
    data: {
      orgId: org.id,
      facilityId: facility.id,
      mrn: `SEC-${Date.now().toString(36).toUpperCase()}`,
      firstName: "Isolation",
      lastName: "Fixture",
      phone: "07000000000",
      sex: "MALE",
    },
  });
  console.log(JSON.stringify({ orgId: org.id, facilityId: facility.id, patientId: patient.id }));
}

async function down() {
  const fixtures = await db.facility.findMany({ where: { name: marker } });
  for (const f of fixtures) {
    await db.patient.deleteMany({ where: { facilityId: f.id } });
    await db.followUp.deleteMany({ where: { facilityId: f.id } });
    await db.facility.delete({ where: { id: f.id } }).catch(() => undefined);
  }
  // Remove patients created by the mass-assignment regression test.
  await db.patient.deleteMany({ where: { phone: { startsWith: "0770000000" } } });
  const probes = await db.organization.findMany({ where: { slug: { startsWith: "secprobe-" } } });
  for (const o of probes) {
    await db.organization.delete({ where: { id: o.id } }).catch(() => undefined);
  }
  console.log(`cleaned ${fixtures.length} fixture facility(ies), ${probes.length} probe org(s)`);
}

const cmd = process.argv[2] ?? "up";
if (cmd === "up") await up();
else await down();
await db.$disconnect();
