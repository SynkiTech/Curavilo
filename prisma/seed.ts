// Curavilo seed - synthetic demo facilities only (spec §93: no real patient data, ever).
// Run: bun prisma/seed.ts
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

const PASSWORD = "Demo1234!";

function daysAgo(n: number, hour = 9): Date {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function salePeriodForDays(n: number): string {
  return daysAgo(n).toISOString().slice(0, 10).replaceAll("-", "");
}

function todayAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

async function clean() {
  // Child-first deletion keeps FK constraints happy.
  await db.aIMessage.deleteMany();
  await db.aIConversation.deleteMany();
  await db.performanceReview.deleteMany();
  await db.attendanceLog.deleteMany();
  await db.expense.deleteMany();
  await db.workflowRunNode.deleteMany();
  await db.workflowRun.deleteMany();
  await db.workflowDef.deleteMany();
  await db.webhookDelivery.deleteMany();
  await db.webhookEndpoint.deleteMany();
  await db.providerConfig.deleteMany();
  await db.communicationMessage.deleteMany();
  await db.outboxEvent.deleteMany();
  await db.notification.deleteMany();
  await db.opsAlert.deleteMany();
  await db.generatedDocument.deleteMany();
  await db.task.deleteMany();
  await db.auditEvent.deleteMany();
  await db.diagnosticOrder.deleteMany();
  await db.admission.deleteMany();
  await db.bed.deleteMany();
  await db.ward.deleteMany();
  await db.referral.deleteMany();
  await db.leaveRequest.deleteMany();
  await db.staffCertification.deleteMany();
  await db.portalToken.deleteMany();
  await db.simulationScenario.deleteMany();
  await db.stockMovement.deleteMany();
  await db.stockLot.deleteMany();
  await db.purchaseOrderItem.deleteMany();
  await db.purchaseOrder.deleteMany();
  await db.saleReturnItem.deleteMany();
  await db.saleReturn.deleteMany();
  await db.heldSale.deleteMany();
  await db.saleItem.deleteMany();
  await db.sale.deleteMany();
  await db.payment.deleteMany();
  await db.invoiceItem.deleteMany();
  await db.invoice.deleteMany();
  await db.followUp.deleteMany();
  await db.encounter.deleteMany();
  await db.queueEntry.deleteMany();
  await db.appointment.deleteMany();
  await db.serviceItem.deleteMany();
  await db.staffMember.deleteMany();
  await db.patient.deleteMany();
  await db.inventoryItem.deleteMany();
  await db.session.deleteMany();
  await db.passwordToken.deleteMany();
  await db.permissionOverride.deleteMany();
  await db.facilityMembership.deleteMany();
  await db.membership.deleteMany();
  await db.customRole.deleteMany();
  await db.department.deleteMany();
  await db.gateSession.deleteMany();
  await db.facilityCredential.deleteMany();
  await db.facility.deleteMany();
  await db.organization.deleteMany();
  await db.user.deleteMany();
  await db.numberSequence.deleteMany();
}

async function main() {
  console.log("Seeding Curavilo synthetic demo data…");
  await clean();

  // ─── Org 1: Eye Clinic ──────────────────────────────────────────────────
  const eyeOrg = await db.organization.create({
    data: { name: "Lagos Central Eye Clinic", slug: "lagos-central-eye-clinic", currency: "NGN", timezone: "Africa/Lagos" },
  });
  const eyeFacility = await db.facility.create({
    data: {
      orgId: eyeOrg.id,
      name: "Lagos Central Eye Clinic - Ikeja",
      type: "CLINIC",
      serviceProfileKey: "EYE_CLINIC",
      address: "24 Awolowo Way, Ikeja, Lagos",
      phone: "+234 802 555 0110",
      email: "hello@lagoscentral-eye.ng",
      reportFooter: "Thank you for choosing Lagos Central Eye Clinic.",
      receiptFooter: "Thank you for your visit - get well soon!",
    },
  });

  // Departments (spec §26/§38: staff belong to a department + service line)
  const eyeDepartments: Record<string, string> = {};
  for (const name of ["Optometry", "Ophthalmology", "Front Desk", "Pharmacy", "Accounts"]) {
    const d = await db.department.create({ data: { orgId: eyeOrg.id, facilityId: eyeFacility.id, name } });
    eyeDepartments[name] = d.id;
  }

  // Facility access gate credential (stage 1 of the two-stage login)
  await db.facilityCredential.create({
    data: { orgId: eyeOrg.id, email: "eyeclinic@curavilo.demo", passwordHash: hashPassword(PASSWORD) },
  });

  const eyeRoster = [
    { email: "eyeclinic@curavilo.demo", first: "Adaeze", last: "Okafor", role: "OWNER", dept: null, line: "EYE_CLINIC", designation: "MD, FWACS", code: "EYE-001", status: "ACTIVE", display: "Dr. Adaeze Okafor" },
    { email: "ophthalmologist@curavilo.demo", first: "Chidi", last: "Bello", role: "OPHTHALMOLOGIST", dept: "Ophthalmology", line: "EYE_CLINIC", designation: "MBBS, FWO", code: "EYE-002", status: "ACTIVE", display: "Dr. Chidi Bello" },
    { email: "optometrist@curavilo.demo", first: "Ifeanyi", last: "Nwosu", role: "OPTOMETRIST", dept: "Optometry", line: "Optometry", designation: "OD", code: "EYE-003", status: "ACTIVE", display: "Dr. Ifeanyi Nwosu" },
    { email: "optician@curavilo.demo", first: "Ngozi", last: "Balogun", role: "OPTICIAN", dept: "Optometry", line: "Optics", designation: "Dispensing Optician", code: "EYE-004", status: "ACTIVE", display: "Ngozi Balogun" },
    { email: "nurse@curavilo.demo", first: "Amina", last: "Yusuf", role: "NURSE", dept: "Ophthalmology", line: "EYE_CLINIC", designation: "RN, Ophthalmic", code: "EYE-005", status: "ACTIVE", display: "Amina Yusuf" },
    { email: "reception@curavilo.demo", first: "Chioma", last: "Eze", role: "RECEPTIONIST", dept: "Front Desk", line: "Front Desk", designation: "Front Desk Officer", code: "EYE-006", status: "ACTIVE", display: "Chioma Eze" },
    { email: "pharmacy@curavilo.demo", first: "Bola", last: "Ahmed", role: "PHARMACY", dept: "Pharmacy", line: "Pharmacy", designation: "BPharm", code: "EYE-007", status: "ACTIVE", display: "Bola Ahmed" },
    { email: "billing@curavilo.demo", first: "Tunde", last: "Adeyemi", role: "BILLING", dept: "Accounts", line: "Finance", designation: "Accounts Officer", code: "EYE-008", status: "ACTIVE", display: "Tunde Adeyemi" },
    { email: "accountant@curavilo.demo", first: "Ngozi", last: "Ifeanyi", role: "ACCOUNTANT", dept: "Accounts", line: "Finance", designation: "ACA, Accountant", code: "EYE-011", status: "ACTIVE", display: "Ngozi Ifeanyi" },
    { email: "hr@curavilo.demo", first: "Amara", last: "Okafor", role: "HR", dept: null, line: "People", designation: "HR Manager", code: "EYE-012", status: "ACTIVE", display: "Amara Okafor" },
    { email: "supervisor@curavilo.demo", first: "Funke", last: "Olawale", role: "STAFF", dept: "Front Desk", line: "Front Desk", designation: "Supervisor", code: "EYE-009", status: "ACTIVE", display: "Funke Olawale", custom: "front-desk-supervisor" },
    { email: "intern@curavilo.demo", first: "Emeka", last: "Obi", role: "STAFF", dept: "Optometry", line: "Optometry", designation: "Intern", code: "EYE-010", status: "SUSPENDED", display: "Emeka Obi" },
  ] as const;

  // Owner-defined custom role (spec §25): permissions chosen by the owner,
  // protected permissions are stripped server-side.
  const supervisorRole = await db.customRole.create({
    data: {
      orgId: eyeOrg.id,
      name: "Front Desk Supervisor",
      key: "front-desk-supervisor",
      permissions: JSON.stringify([
        "patients:read", "patients:write", "appointments:read", "appointments:write",
        "queue:operate", "billing:read", "staff:read", "reports:read", "ai:ask",
      ]),
    },
  });

  const eyeUsers: Record<string, string> = {};
  for (const r of eyeRoster) {
    const u = await db.user.create({
      data: {
        email: r.email, name: r.display, passwordHash: hashPassword(PASSWORD),
        status: r.status,
        firstName: r.first, lastName: r.last,
        phone: "+234 80" + r.code.slice(4) + " 000 " + r.code.slice(4),
        staffCode: r.code, designation: r.designation,
        employmentStatus: r.status === "SUSPENDED" ? "CONTRACT" : "FULL_TIME",
        serviceLine: r.line,
        departmentId: r.dept ? eyeDepartments[r.dept] : null,
      },
    });
    await db.membership.create({
      data: { userId: u.id, orgId: eyeOrg.id, role: r.role, customRoleId: "custom" in r && r.custom ? supervisorRole.id : null },
    });
    await db.facilityMembership.create({ data: { userId: u.id, facilityId: eyeFacility.id } });
    eyeUsers[r.role + (r.email.startsWith("supervisor") ? "-S" : "")] = u.id;
  }
  const owner = await db.user.findUniqueOrThrow({ where: { email: "eyeclinic@curavilo.demo" } });
  const receptionist = await db.user.findUniqueOrThrow({ where: { email: "reception@curavilo.demo" } });
  const optometristUser = await db.user.findUniqueOrThrow({ where: { email: "optometrist@curavilo.demo" } });
  const pharmacyUser = await db.user.findUniqueOrThrow({ where: { email: "pharmacy@curavilo.demo" } });

  // Service catalogue (Eye Clinic profile)
  const catalogue = [
    { code: "CONS-EYE", name: "Eye Consultation", category: "CONSULTATION", priceMinor: 2000000 },
    { code: "EXAM-EYE", name: "Eye Examination", category: "EXAMINATION", priceMinor: 1500000 },
    { code: "REFRACT", name: "Refraction", category: "EXAMINATION", priceMinor: 2500000 },
    { code: "IOP", name: "IOP Measurement", category: "EXAMINATION", priceMinor: 500000 },
    { code: "PROC-EYE", name: "Ophthalmic Procedure", category: "PROCEDURE", priceMinor: 5000000 },
    { code: "FRAME-STD", name: "Standard Frame + Lenses", category: "PROCEDURE", priceMinor: 3500000 },
  ];
  const serviceItems: Record<string, { id: string; name: string; priceMinor: number }> = {};
  for (const c of catalogue) {
    const item = await db.serviceItem.create({
      data: { orgId: eyeOrg.id, code: c.code, name: c.name, category: c.category, priceMinor: c.priceMinor },
    });
    serviceItems[c.code] = { id: item.id, name: item.name, priceMinor: item.priceMinor };
  }

  // Staff
  const optometrist = await db.staffMember.create({
    data: { orgId: eyeOrg.id, facilityId: eyeFacility.id, userId: optometristUser.id, name: "Dr. Ifeanyi Nwosu", designation: "OPTOMETRIST", department: "OPHTHALMOLOGY" },
  });
  const nurse = await db.staffMember.create({
    data: { orgId: eyeOrg.id, facilityId: eyeFacility.id, name: "Amina Yusuf", designation: "NURSE", department: "OPHTHALMOLOGY" },
  });

  // HR directory: full personnel records for the HR workspace (designation + department)
  const hrStaffSeed = [
    ["Dr. Chidi Bello", "OPHTHALMOLOGIST", "OPHTHALMOLOGY", "ophthalmologist"],
    ["Chioma Eze", "RECEPTIONIST", "FRONT DESK", "reception"],
    ["Bola Ahmed", "PHARMACIST", "PHARMACY", "pharmacy"],
    ["Tunde Adeyemi", "CASHIER", "ACCOUNTS", "billing"],
    ["Ngozi Ifeanyi", "ACCOUNTANT", "ACCOUNTS", "accountant"],
    ["Ngozi Balogun", "OPTICIAN", "OPTICS", "optician"],
  ] as const;
  const hrStaff: { id: string; name: string }[] = [{ id: optometrist.id, name: optometrist.name }, { id: nurse.id, name: nurse.name }];
  for (const [name, designation, department, emailKey] of hrStaffSeed) {
    const u = await db.user.findUnique({ where: { email: `${emailKey}@curavilo.demo` } });
    const s = await db.staffMember.create({
      data: { orgId: eyeOrg.id, facilityId: eyeFacility.id, userId: u?.id ?? null, name, designation, department },
    });
    hrStaff.push({ id: s.id, name });
  }

  // HR: certifications (two expiring within 30 days)
  await db.staffCertification.createMany({
    data: [
      { orgId: eyeOrg.id, staffId: optometrist.id, name: "Optometry Council License", expiresAt: new Date(Date.now() + 18 * 86_400_000) },
      { orgId: eyeOrg.id, staffId: hrStaff[2].id, name: "MDCN License", expiresAt: new Date(Date.now() + 220 * 86_400_000) },
      { orgId: eyeOrg.id, staffId: nurse.id, name: "Nursing & Midwifery Council License", expiresAt: new Date(Date.now() + 25 * 86_400_000) },
      { orgId: eyeOrg.id, staffId: hrStaff[6].id, name: "Dispensing Optics Certificate", expiresAt: new Date(Date.now() + 400 * 86_400_000) },
    ],
  });

  // HR: attendance for today (most present, one late, one on approved leave)
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const at = (h: number, m: number) => new Date(dayStart.getTime() + (h * 60 + m) * 60_000);
  await db.attendanceLog.createMany({
    data: [
      { orgId: eyeOrg.id, facilityId: eyeFacility.id, staffId: optometrist.id, date: dayStart, status: "PRESENT", checkInAt: at(7, 55) },
      { orgId: eyeOrg.id, facilityId: eyeFacility.id, staffId: nurse.id, date: dayStart, status: "PRESENT", checkInAt: at(8, 5) },
      { orgId: eyeOrg.id, facilityId: eyeFacility.id, staffId: hrStaff[2].id, date: dayStart, status: "LATE", checkInAt: at(9, 40), note: "Traffic" },
      { orgId: eyeOrg.id, facilityId: eyeFacility.id, staffId: hrStaff[3].id, date: dayStart, status: "PRESENT", checkInAt: at(8, 20) },
      { orgId: eyeOrg.id, facilityId: eyeFacility.id, staffId: hrStaff[4].id, date: dayStart, status: "PRESENT", checkInAt: at(8, 2) },
    ],
  });

  // HR: leave requests (2 pending + 1 approved covering today)
  await db.leaveRequest.createMany({
    data: [
      { orgId: eyeOrg.id, facilityId: eyeFacility.id, staffId: hrStaff[3].id, fromAt: new Date(Date.now() + 7 * 86_400_000), toAt: new Date(Date.now() + 12 * 86_400_000), reason: "Family event in Enugu", status: "PENDING" },
      { orgId: eyeOrg.id, facilityId: eyeFacility.id, staffId: hrStaff[5].id, fromAt: new Date(Date.now() + 20 * 86_400_000), toAt: new Date(Date.now() + 27 * 86_400_000), reason: "Annual leave", status: "PENDING" },
      { orgId: eyeOrg.id, facilityId: eyeFacility.id, staffId: hrStaff[6].id, fromAt: new Date(Date.now() - 1 * 86_400_000), toAt: new Date(Date.now() + 2 * 86_400_000), reason: "Medical checkup", status: "APPROVED", decidedById: owner.id, decidedAt: new Date(Date.now() - 2 * 86_400_000) },
    ],
  });

  // HR: performance reviews
  await db.performanceReview.createMany({
    data: [
      { orgId: eyeOrg.id, facilityId: eyeFacility.id, staffId: optometrist.id, period: "Q3 2026", reviewerName: "Dr. Adaeze Okafor", overallScore: 5, strengths: "Excellent refraction accuracy and patient rapport.", improvements: "Documentation turnaround.", goals: "Lead two community outreach screenings.", status: "FINAL" },
      { orgId: eyeOrg.id, facilityId: eyeFacility.id, staffId: nurse.id, period: "Q3 2026", reviewerName: "Dr. Adaeze Okafor", overallScore: 4, strengths: "Reliable triage and tonometry.", improvements: "Inventory counts timeliness.", goals: "Complete infection-control refresher.", status: "FINAL" },
      { orgId: eyeOrg.id, facilityId: eyeFacility.id, staffId: hrStaff[3].id, period: "Q3 2026", reviewerName: "Ngozi Ifeanyi", overallScore: 3, strengths: "Accurate till reconciliation.", improvements: "Invoice queue backlog.", goals: "Zero pending invoices over 7 days.", status: "FINAL" },
    ],
  });

  // Accounting: expense ledger across categories, statuses and dates
  const expenseSeed = [
    { category: "RENT", description: "Clinic rent - Ikeja premises", vendor: "Awolowo Properties Ltd", amountMinor: 3_500_000, method: "TRANSFER", status: "PAID", days: 32 },
    { category: "UTILITIES", description: "IKEDC electricity bill", vendor: "Eko Disco", amountMinor: 412_500, method: "TRANSFER", status: "PAID", days: 18 },
    { category: "SALARIES", description: "Staff salaries - previous month", vendor: null, amountMinor: 12_800_000, method: "TRANSFER", status: "PAID", days: 15 },
    { category: "SUPPLIES", description: "Printer paper and consumables restock", vendor: "MedSupply Nigeria", amountMinor: 236_000, method: "POS", status: "APPROVED", days: 6 },
    { category: "EQUIPMENT", description: "Slit lamp bulb replacement", vendor: "OptiTech Systems", amountMinor: 890_000, method: "TRANSFER", status: "APPROVED", days: 4 },
    { category: "MAINTENANCE", description: "Generator servicing and diesel", vendor: "PowerCare Engineering", amountMinor: 315_000, method: "CASH", status: "PENDING", days: 2 },
    { category: "MARKETING", description: "Radio awareness campaign - glaucoma week", vendor: "Wazobia FM", amountMinor: 750_000, method: "TRANSFER", status: "PENDING", days: 1 },
    { category: "TRANSPORT", description: "Courier - lab samples to reference lab", vendor: "GIG Logistics", amountMinor: 48_000, method: "CASH", status: "PENDING", days: 0 },
    { category: "INSURANCE", description: "Professional indemnity premium", vendor: "AIICO Insurance", amountMinor: 1_200_000, method: "CHEQUE", status: "REJECTED", days: 22 },
    { category: "OPERATIONS", description: "Cleaning services - monthly", vendor: "Sparkle Facilities", amountMinor: 180_000, method: "CASH", status: "PENDING", days: 3 },
  ] as const;
  for (const e of expenseSeed) {
    await db.expense.create({
      data: {
        orgId: eyeOrg.id, facilityId: eyeFacility.id,
        category: e.category, description: e.description, vendor: e.vendor ?? null,
        amountMinor: e.amountMinor, currency: "NGN", method: e.method, status: e.status,
        incurredAt: daysAgo(e.days, 10),
        paidAt: e.status === "PAID" ? daysAgo(e.days, 14) : null,
        requestedByName: "Tunde Adeyemi (BILLING)",
        approvedByName: e.status === "PENDING" ? null : "Ngozi Ifeanyi (ACCOUNTANT)",
      },
    });
  }

  // Patients
  const patientSeed = [
    ["Chidinma", "Okeke", "+234 803 111 2233", "FEMALE", 1991], ["Emeka", "Obi", "+234 805 222 3344", "MALE", 1978],
    ["Fatima", "Bello", "+234 806 333 4455", "FEMALE", 1985], ["Tunde", "Adeyemi", "+234 807 444 5566", "MALE", 1966],
    ["Amina", "Yusuf", "+234 808 555 6677", "FEMALE", 1996], ["Kelechi", "Nwankwo", "+234 809 666 7788", "MALE", 1982],
    ["Blessing", "Igwe", "+234 810 777 8899", "FEMALE", 1973], ["Dayo", "Ogunleye", "+234 811 888 9900", "MALE", 1989],
  ] as const;
  const patients: { id: string; name: string; mrn: string }[] = [];
  let mrnSeq = 1;
  for (const [first, last, phone, sex, year] of patientSeed) {
    const p = await db.patient.create({
      data: {
        orgId: eyeOrg.id, facilityId: eyeFacility.id,
        mrn: `MRN-${String(mrnSeq++).padStart(6, "0")}`,
        firstName: first, lastName: last, phone,
        sex, dateOfBirth: new Date(Date.UTC(year, 3, 12)),
        address: `${10 + mrnSeq} Allen Avenue, Ikeja, Lagos`,
        nextOfKinName: `${first} ${last} Jr.`, nextOfKinPhone: "+234 812 999 0011",
        allergies: mrnSeq % 3 === 0 ? "Penicillin" : null,
        consentNote: "Verbal consent for records processing recorded.",
      },
    });
    patients.push({ id: p.id, name: `${first} ${last}`, mrn: p.mrn });
  }

  // Number sequences to reflect used numbers
  await db.numberSequence.create({ data: { id: `${eyeOrg.id}:PATIENT:ALL`, seq: patients.length } });

  // Inventory
  const inventorySeed = [
    { sku: "DRG-TIM-5ML", name: "Timolol Maleate 0.5% Drops", genericName: "Timolol", category: "PHARMACEUTICAL", unit: "5ml bottle", purchase: 85000, sell: 150000, reorder: 15 },
    { sku: "DRG-ART-10ML", name: "Artificial Tears", genericName: "Carboxymethylcellulose", category: "PHARMACEUTICAL", unit: "10ml bottle", purchase: 50000, sell: 95000, reorder: 20 },
    { sku: "DRG-ATR-1G", name: "Atropine 1% Ointment", genericName: "Atropine", category: "PHARMACEUTICAL", unit: "3.5g tube", purchase: 70000, sell: 120000, reorder: 10 },
    { sku: "CNS-TON-TIP", name: "Tonometer Probe Tips", genericName: null, category: "CONSUMABLE", unit: "pack of 50", purchase: 120000, sell: 200000, reorder: 8 },
    { sku: "CNS-EYE-PAD", name: "Eye Pads", genericName: null, category: "CONSUMABLE", unit: "pack of 20", purchase: 30000, sell: 60000, reorder: 12 },
    { sku: "EQP-CHT-SNT", name: "Snellen Chart", genericName: null, category: "EQUIPMENT", unit: "unit", purchase: 2500000, sell: 3500000, reorder: 2 },
  ];
  const items: Record<string, { id: string; name: string }> = {};
  for (const inv of inventorySeed) {
    const item = await db.inventoryItem.create({
      data: {
        orgId: eyeOrg.id, facilityId: eyeFacility.id,
        sku: inv.sku, name: inv.name, genericName: inv.genericName, category: inv.category,
        unit: inv.unit, purchasePriceMinor: inv.purchase, sellingPriceMinor: inv.sell, reorderLevel: inv.reorder,
      },
    });
    items[inv.sku] = { id: item.id, name: item.name };
  }
  // Lots + receipts
  const lots: { id: string; itemId: string; remaining: number }[] = [];
  const lotSeed = [
    ["DRG-TIM-5ML", "TIM-B2026-03", 40, 8], ["DRG-ART-10ML", "ART-B2026-11", 15, 10],
    ["DRG-ATR-1G", "ATR-B2025-07", 12, 1], ["CNS-TON-TIP", "TON-B2026-02", 6, 30],
    ["CNS-EYE-PAD", "PAD-B2026-05", 30, 20], ["EQP-CHT-SNT", "CHT-2025-01", 3, null],
  ] as const;
  for (const [sku, batch, qty, expiresInDays] of lotSeed) {
    const expiresAt = expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 24 * 3600 * 1000);
    const lot = await db.stockLot.create({
      data: { orgId: eyeOrg.id, itemId: items[sku].id, batchNo: batch, qtyReceived: qty, qtyRemaining: qty, expiresAt },
    });
    await db.stockMovement.create({
      data: { orgId: eyeOrg.id, itemId: items[sku].id, lotId: lot.id, type: "RECEIPT", quantity: qty, reason: "Initial stock received", userId: owner.id },
    });
    lots.push({ id: lot.id, itemId: items[sku].id, remaining: qty });
  }

  // Appointments today
  const appt1 = await db.appointment.create({
    data: { orgId: eyeOrg.id, facilityId: eyeFacility.id, patientId: patients[0].id, staffMemberId: optometrist.id, serviceItemId: serviceItems["CONS-EYE"].id, scheduledAt: todayAt(9), status: "CHECKED_IN", createdById: receptionist.id },
  });
  await db.appointment.create({
    data: { orgId: eyeOrg.id, facilityId: eyeFacility.id, patientId: patients[1].id, staffMemberId: optometrist.id, serviceItemId: serviceItems["REFRACT"].id, scheduledAt: todayAt(10), status: "SCHEDULED", createdById: receptionist.id },
  });
  await db.appointment.create({
    data: { orgId: eyeOrg.id, facilityId: eyeFacility.id, patientId: patients[2].id, serviceItemId: serviceItems["EXAM-EYE"].id, scheduledAt: todayAt(11), status: "SCHEDULED", createdById: receptionist.id },
  });
  // Past appointments
  await db.appointment.create({
    data: { orgId: eyeOrg.id, facilityId: eyeFacility.id, patientId: patients[3].id, staffMemberId: optometrist.id, scheduledAt: daysAgo(7, 10), status: "COMPLETED", createdById: receptionist.id },
  });
  await db.appointment.create({
    data: { orgId: eyeOrg.id, facilityId: eyeFacility.id, patientId: patients[4].id, scheduledAt: daysAgo(14, 9), status: "NO_SHOW", createdById: receptionist.id },
  });

  // Queue today
  const q1 = await db.queueEntry.create({
    data: { orgId: eyeOrg.id, facilityId: eyeFacility.id, patientId: patients[0].id, appointmentId: appt1.id, department: "OPHTHALMOLOGY", number: 1, status: "IN_SERVICE", checkedInAt: todayAt(8, 40), calledAt: todayAt(9) },
  });
  await db.queueEntry.create({
    data: { orgId: eyeOrg.id, facilityId: eyeFacility.id, patientId: patients[3].id, department: "OPHTHALMOLOGY", number: 2, status: "WAITING", checkedInAt: todayAt(8, 55) },
  });
  await db.queueEntry.create({
    data: { orgId: eyeOrg.id, facilityId: eyeFacility.id, patientId: patients[5].id, department: "OPHTHALMOLOGY", number: 3, status: "WAITING", checkedInAt: todayAt(9, 10) },
  });
  await db.queueEntry.create({
    data: { orgId: eyeOrg.id, facilityId: eyeFacility.id, patientId: patients[6].id, department: "OPHTHALMOLOGY", number: 4, status: "WAITING", checkedInAt: todayAt(9, 25) },
  });

  // Encounters (completed) with invoices + payments - last 30 days
  const eyeExamData = (vaOd: string, vaOs: string, iopOd: number, iopOs: number) =>
    JSON.stringify({ vaOd, vaOs, pinhole: "", refractionOd: "-0.50 DS", refractionOs: "-0.75 DS", nearAdd: "", iopOd, iopOs, anteriorSegment: "Quiet and white", fundus: "C/D 0.3 both eyes" });

  const encounterSeed = [
    { patient: 3, days: 30, dx: "Primary open-angle glaucoma suspect", items: ["CONS-EYE", "IOP"], payFull: true, formData: eyeExamData("6/6", "6/9", 24, 22) },
    { patient: 4, days: 21, dx: "Allergic conjunctivitis", items: ["CONS-EYE", "EXAM-EYE"], payFull: true, formData: eyeExamData("6/5", "6/5", 15, 14) },
    { patient: 5, days: 14, dx: "Uncorrected refractive error", items: ["CONS-EYE", "REFRACT"], payFull: false, formData: eyeExamData("6/18", "6/24", 16, 17) },
    { patient: 6, days: 7, dx: "Dry eye syndrome", items: ["CONS-EYE", "EXAM-EYE"], payFull: true, formData: eyeExamData("6/6", "6/6", 14, 15) },
    { patient: 7, days: 3, dx: "Cataract - age related, right eye", items: ["CONS-EYE", "IOP"], payFull: false, formData: eyeExamData("6/36", "6/9", 12, 13) },
  ] as const;

  let invoiceSeq = 0, paymentSeq = 0, encounterSeq = 0;
  const todayPeriod = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  // The seeded POS sale happens 3 days ago; its number period must match so the
  // counter row below starts where the seed left off.
  const salePeriod = salePeriodForDays(3);
  await db.numberSequence.createMany({
    data: [
      { id: `${eyeOrg.id}:INVOICE:${todayPeriod}`, seq: invoiceSeq },
      { id: `${eyeOrg.id}:PAYMENT:${todayPeriod}`, seq: paymentSeq },
      { id: `${eyeOrg.id}:ENCOUNTER:${todayPeriod}`, seq: encounterSeq },
      { id: `${eyeOrg.id}:SALE:${salePeriod}`, seq: 1 },
    ],
  });

  for (const es of encounterSeed) {
    const startedAt = daysAgo(es.days, 10);
    const completedAt = new Date(startedAt.getTime() + 35 * 60 * 1000);
    const encounter = await db.encounter.create({
      data: {
        orgId: eyeOrg.id, facilityId: eyeFacility.id, patientId: patients[es.patient].id,
        staffMemberId: optometrist.id, serviceLine: "EYE_CLINIC", formKey: "EYE_EXAM",
        status: "COMPLETED", formData: es.formData, diagnosis: es.dx, plan: "Review as indicated",
        startedAt, completedAt,
      },
    });
    const subtotal = es.items.reduce((s, code) => s + serviceItems[code].priceMinor, 0);
    const invoice = await db.invoice.create({
      data: {
        orgId: eyeOrg.id, facilityId: eyeFacility.id, patientId: patients[es.patient].id,
        encounterId: encounter.id, number: `INV-${todayPeriod}-${String(++invoiceSeq).padStart(6, "0")}`,
        status: es.payFull ? "PAID" : "PARTIALLY_PAID",
        subtotalMinor: subtotal, discountMinor: 0, totalMinor: subtotal,
        amountPaidMinor: es.payFull ? subtotal : Math.floor(subtotal / 2),
        currency: "NGN", issuedAt: completedAt, createdById: owner.id,
        items: {
          create: es.items.map((code) => ({
            orgId: eyeOrg.id, serviceItemId: serviceItems[code].id, name: serviceItems[code].name,
            quantity: 1, unitPriceMinor: serviceItems[code].priceMinor, totalMinor: serviceItems[code].priceMinor,
          })),
        },
      },
    });
    await db.payment.create({
      data: {
        orgId: eyeOrg.id, facilityId: eyeFacility.id, invoiceId: invoice.id,
        number: `RCP-${todayPeriod}-${String(++paymentSeq).padStart(6, "0")}`,
        method: es.days % 2 === 0 ? "CASH" : "TRANSFER",
        amountMinor: es.payFull ? subtotal : Math.floor(subtotal / 2),
        currency: "NGN", createdById: owner.id, createdAt: completedAt,
      },
    });
    await db.numberSequence.update({ where: { id: `${eyeOrg.id}:INVOICE:${todayPeriod}` }, data: { seq: invoiceSeq } });
    await db.numberSequence.update({ where: { id: `${eyeOrg.id}:PAYMENT:${todayPeriod}` }, data: { seq: paymentSeq } });
  }
  // Encounter of patient 0 today is OPEN (linked to queue entry q1)
  await db.encounter.create({
    data: {
      orgId: eyeOrg.id, facilityId: eyeFacility.id, patientId: patients[0].id,
      queueEntryId: q1.id, staffMemberId: optometrist.id, serviceLine: "EYE_CLINIC", formKey: "EYE_EXAM",
      status: "OPEN", formData: "{}", startedAt: todayAt(9, 5),
    },
  });

  // Follow-ups: 2 overdue, 1 upcoming
  await db.followUp.create({
    data: { orgId: eyeOrg.id, facilityId: eyeFacility.id, patientId: patients[3].id, title: "Visual field test review", dueAt: daysAgo(4), status: "PENDING" },
  });
  await db.followUp.create({
    data: { orgId: eyeOrg.id, facilityId: eyeFacility.id, patientId: patients[7].id, title: "Post-dilation review", dueAt: daysAgo(2), status: "PENDING" },
  });
  await db.followUp.create({
    data: { orgId: eyeOrg.id, facilityId: eyeFacility.id, patientId: patients[6].id, title: "Cataract surgical review", dueAt: new Date(Date.now() + 6 * 24 * 3600 * 1000), status: "PENDING" },
  });

  // POS sale (3 days ago): 2 Timolol + 1 Artificial tears
  const saleSubtotal = 2 * 150000 + 95000;
  const sale = await db.sale.create({
    data: {
      orgId: eyeOrg.id, facilityId: eyeFacility.id, number: `POS-${salePeriod}-000001`,
      customerName: "Walk-in customer", status: "COMPLETED",
      subtotalMinor: saleSubtotal, discountMinor: 0, totalMinor: saleSubtotal, amountPaidMinor: saleSubtotal,
      method: "CASH", createdById: pharmacyUser.id, createdAt: daysAgo(3, 13),
      items: {
        create: [
          { orgId: eyeOrg.id, itemId: items["DRG-TIM-5ML"].id, name: items["DRG-TIM-5ML"].name, quantity: 2, unitPriceMinor: 150000, totalMinor: 300000 },
          { orgId: eyeOrg.id, itemId: items["DRG-ART-10ML"].id, name: items["DRG-ART-10ML"].name, quantity: 1, unitPriceMinor: 95000, totalMinor: 95000 },
        ],
      },
    },
  });
  // Stock movements for the sale (FEFO from the single lots)
  const timLot = lots.find((l) => l.itemId === items["DRG-TIM-5ML"].id)!;
  const artLot = lots.find((l) => l.itemId === items["DRG-ART-10ML"].id)!;
  await db.stockLot.update({ where: { id: timLot.id }, data: { qtyRemaining: { decrement: 2 } } });
  await db.stockMovement.create({ data: { orgId: eyeOrg.id, itemId: items["DRG-TIM-5ML"].id, lotId: timLot.id, type: "SALE", quantity: -2, reason: "POS sale", refType: "Sale", refId: sale.id, userId: pharmacyUser.id, createdAt: daysAgo(3, 13) } });
  await db.stockLot.update({ where: { id: artLot.id }, data: { qtyRemaining: { decrement: 1 } } });
  await db.stockMovement.create({ data: { orgId: eyeOrg.id, itemId: items["DRG-ART-10ML"].id, lotId: artLot.id, type: "SALE", quantity: -1, reason: "POS sale", refType: "Sale", refId: sale.id, userId: pharmacyUser.id, createdAt: daysAgo(3, 13) } });

  // Workflow: outpatient follow-up
  await db.workflowDef.create({
    data: {
      orgId: eyeOrg.id, key: "OUTPATIENT_FOLLOWUP", name: "Outpatient follow-up", status: "PUBLISHED", version: 1,
      description: "After an encounter: schedule follow-up, notify reception, create a nurse task.",
      publishedAt: new Date(),
      definition: JSON.stringify({
        trigger: "ENCOUNTER_COMPLETED",
        nodes: [
          { id: "n1", type: "CREATE_FOLLOWUP", config: { title: "Follow-up visit", days: 14 } },
          { id: "n2", type: "NOTIFY", config: { title: "Encounter completed", body: "A patient encounter completed - schedule the follow-up.", role: "RECEPTIONIST" } },
          { id: "n3", type: "CREATE_TASK", config: { title: "Call patient to confirm follow-up", role: "NURSE", priority: "NORMAL" } },
        ],
        edges: [{ from: "n1", to: "n2" }, { from: "n2", to: "n3" }],
      }),
    },
  });

  await db.auditEvent.createMany({
    data: [
      { orgId: eyeOrg.id, facilityId: eyeFacility.id, actorUserId: owner.id, actorLabel: "Dr. Adaeze Okafor", action: "organization.registered", entityType: "Organization", entityId: eyeOrg.id, summary: "Organization registered with facility Ikeja (Eye Clinic profile)." },
      { orgId: eyeOrg.id, facilityId: eyeFacility.id, actorUserId: owner.id, actorLabel: "Dr. Adaeze Okafor", action: "patient.created", entityType: "Patient", entityId: patients[0].id, summary: `Registered patient ${patients[0].name} (${patients[0].mrn}).` },
      { orgId: eyeOrg.id, facilityId: eyeFacility.id, actorUserId: pharmacyUser.id, actorLabel: "Bola Ahmed", action: "sale.completed", entityType: "Sale", entityId: sale.id, summary: "POS sale completed (CASH)." },
    ],
  });

  // ─── Org 2: General Medical Centre ─────────────────────────────────────
  const gpOrg = await db.organization.create({
    data: { name: "Gracefield General Medical Centre", slug: "gracefield-gmc", currency: "NGN", timezone: "Africa/Lagos" },
  });
  const gpFacility = await db.facility.create({
    data: {
      orgId: gpOrg.id, name: "Gracefield GMC - Yaba", type: "CLINIC", serviceProfileKey: "GENERAL_PRACTICE",
      address: "5 Herbert Macaulay Way, Yaba, Lagos", phone: "+234 801 222 3344",
      reportFooter: "Gracefield GMC - caring for you.", receiptFooter: "Get well soon!",
    },
  });
  await db.facilityCredential.create({
    data: { orgId: gpOrg.id, email: "gracefield@curavilo.demo", passwordHash: hashPassword(PASSWORD) },
  });
  const gpDepartments: Record<string, string> = {};
  for (const name of ["General Practice", "Nursing", "Front Desk", "Accounts"]) {
    const d = await db.department.create({ data: { orgId: gpOrg.id, facilityId: gpFacility.id, name } });
    gpDepartments[name] = d.id;
  }
  const gpRoster = [
    { email: "gracefield@curavilo.demo", display: "Dr. Musa Ibrahim", first: "Musa", last: "Ibrahim", role: "OWNER", dept: null, line: "GENERAL_PRACTICE", designation: "MBBS, FWACP", code: "GMC-001", status: "ACTIVE" },
    { email: "gp-doctor@curavilo.demo", display: "Dr. Halima Sule", first: "Halima", last: "Sule", role: "DOCTOR", dept: "General Practice", line: "General Medicine", designation: "MBBS", code: "GMC-002", status: "ACTIVE" },
    { email: "gp-nurse@curavilo.demo", display: "Peter Eze", first: "Peter", last: "Eze", role: "NURSE", dept: "Nursing", line: "Nursing", designation: "RN", code: "GMC-003", status: "ACTIVE" },
    { email: "gp-reception@curavilo.demo", display: "Ngozi Umeh", first: "Ngozi", last: "Umeh", role: "RECEPTIONIST", dept: "Front Desk", line: "Front Desk", designation: "Front Desk Officer", code: "GMC-004", status: "ACTIVE" },
    { email: "gp-billing@curavilo.demo", display: "Sadiq Bello", first: "Sadiq", last: "Bello", role: "BILLING", dept: "Accounts", line: "Finance", designation: "Accounts Officer", code: "GMC-005", status: "ACTIVE" },
  ] as const;
  for (const r of gpRoster) {
    const u = await db.user.create({
      data: {
        email: r.email, name: r.display, passwordHash: hashPassword(PASSWORD),
        status: r.status, firstName: r.first, lastName: r.last,
        staffCode: r.code, designation: r.designation, employmentStatus: "FULL_TIME",
        serviceLine: r.line,
        departmentId: r.dept ? gpDepartments[r.dept] : null,
      },
    });
    await db.membership.create({ data: { userId: u.id, orgId: gpOrg.id, role: r.role } });
    await db.facilityMembership.create({ data: { userId: u.id, facilityId: gpFacility.id } });
  }
  const gpOwner = await db.user.findUniqueOrThrow({ where: { email: "gracefield@curavilo.demo" } });

  const gpCatalogue = [
    { code: "CONS-GEN", name: "General Consultation", category: "CONSULTATION", priceMinor: 1500000 },
    { code: "LAB-MPS", name: "Malaria Parasite Test", category: "LAB", priceMinor: 200000 },
    { code: "LAB-FCB", name: "FBC (Full Blood Count)", category: "LAB", priceMinor: 350000 },
  ];
  for (const c of gpCatalogue) {
    await db.serviceItem.create({ data: { orgId: gpOrg.id, code: c.code, name: c.name, category: c.category, priceMinor: c.priceMinor } });
  }
  const gpPatients: { id: string; name: string; mrn: string }[] = [];
  let gpMrn = 1;
  for (const [first, last, phone] of [["Halima", "Sule", "+234 803 000 1122"], ["Peter", "Eze", "+234 805 111 2233"], ["Ngozi", "Umeh", "+234 806 222 3344"]] as const) {
    const p = await db.patient.create({
      data: { orgId: gpOrg.id, facilityId: gpFacility.id, mrn: `MRN-${String(gpMrn++).padStart(6, "0")}`, firstName: first, lastName: last, phone, sex: gpMrn % 2 ? "FEMALE" : "MALE", dateOfBirth: new Date(Date.UTC(1988, 6, 9)) },
    });
    gpPatients.push({ id: p.id, name: `${first} ${last}`, mrn: p.mrn });
  }
  await db.numberSequence.create({ data: { id: `${gpOrg.id}:PATIENT:ALL`, seq: gpPatients.length } });

  const gpEncounter = await db.encounter.create({
    data: {
      orgId: gpOrg.id, facilityId: gpFacility.id, patientId: gpPatients[0].id, serviceLine: "GENERAL_PRACTICE", formKey: "GENERAL_CONSULT",
      status: "COMPLETED", formData: JSON.stringify({ bp: "120/80", temp: "36.8", chiefComplaint: "Fever and headache for 3 days", findings: "Tender hepatomegaly" }),
      diagnosis: "Uncomplicated malaria", plan: "ACT 3 days, review 1 week", startedAt: daysAgo(5, 11), completedAt: new Date(daysAgo(5, 11).getTime() + 25 * 60 * 1000),
    },
  });
  const gpInvoice = await db.invoice.create({
    data: {
      orgId: gpOrg.id, facilityId: gpFacility.id, patientId: gpPatients[0].id, encounterId: gpEncounter.id,
      number: `INV-${todayPeriod}-000001`, status: "PAID", subtotalMinor: 1700000, totalMinor: 1700000, amountPaidMinor: 1700000,
      currency: "NGN", issuedAt: daysAgo(5, 11), createdById: gpOwner.id,
      items: { create: [{ orgId: gpOrg.id, name: "General Consultation", quantity: 1, unitPriceMinor: 1500000, totalMinor: 1500000 }, { orgId: gpOrg.id, name: "Malaria Parasite Test", quantity: 1, unitPriceMinor: 200000, totalMinor: 200000 }] },
    },
  });
  await db.payment.create({
    data: { orgId: gpOrg.id, facilityId: gpFacility.id, invoiceId: gpInvoice.id, number: `RCP-${todayPeriod}-000001`, method: "CASH", amountMinor: 1700000, currency: "NGN", createdById: gpOwner.id, createdAt: daysAgo(5, 11) },
  });
  await db.followUp.create({
    data: { orgId: gpOrg.id, facilityId: gpFacility.id, patientId: gpPatients[0].id, title: "Malaria review after ACT", dueAt: new Date(Date.now() + 2 * 24 * 3600 * 1000), status: "PENDING" },
  });
  await db.numberSequence.createMany({
    data: [
      { id: `${gpOrg.id}:INVOICE:${todayPeriod}`, seq: 1 },
      { id: `${gpOrg.id}:PAYMENT:${todayPeriod}`, seq: 1 },
    ],
  });

  console.log("Seed complete.");
  console.log("  Facility gate (stage 1): eyeclinic@curavilo.demo / gracefield@curavilo.demo");
  console.log("  Eye Clinic staff (stage 2): ophthalmologist@ optometrist@ optician@ nurse@ reception@ pharmacy@ billing@ accountant@ hr@ supervisor@ intern@ (SUSPENDED) curavilo.demo");
  console.log("  GP staff (stage 2): gp-doctor@ gp-nurse@ gp-reception@ gp-billing@curavilo.demo");
  console.log(`  Password for all demo accounts: ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
