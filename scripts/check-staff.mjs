import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const staff = await db.staffMember.findMany({
  select: { id: true, facilityId: true, name: true, designation: true, department: true, userId: true, active: true },
});
for (const s of staff) console.log(JSON.stringify(s));
const members = await db.membership.findMany({ where: { active: true }, select: { role: true, userId: true } });
for (const u of members) console.log("MEMBER", JSON.stringify(u));
await db.$disconnect();
