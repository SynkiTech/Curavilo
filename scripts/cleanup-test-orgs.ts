// One-off cleanup: remove orgs created during this session's verification runs.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const TEST_ORGS = ["Test Clinic Group", "Sunrise Dental Group"];

async function main() {
  for (const name of TEST_ORGS) {
    const org = await db.organization.findFirst({ where: { name } });
    if (!org) {
      console.log(`skip (not found): ${name}`);
      continue;
    }
    await db.organization.delete({ where: { id: org.id } }); // cascades via relations
    console.log(`deleted org: ${name} (${org.id})`);
  }
  // Orphaned users (created with the orgs above via registration)
  for (const email of ["testadmin1@curavilo.demo", "adaobi@sunrisedental.ng"]) {
    const u = await db.user.findUnique({ where: { email } });
    if (u) {
      await db.user.delete({ where: { id: u.id } });
      console.log(`deleted user: ${email}`);
    }
  }
  const orgs = await db.organization.findMany({ select: { name: true } });
  console.log("remaining orgs:", orgs.map((o) => o.name).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
