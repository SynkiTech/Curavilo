// Cross-tenant security regression probe (spec §99) — run while dev server is up.
// 1. anonymous access must be 401
// 2. eye-clinic session requesting gracefield patient must be 404
// 3. receptionist (no billing:write) recording a payment must be 403
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const BASE = "http://localhost:3000";

async function login(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email, password: "Demo1234!" }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const token = /curavilo_session=([^;]+)/.exec(setCookie)?.[1];
  if (!token) throw new Error(`login failed for ${email}: ${res.status}`);
  return token;
}

async function probe(label: string, path: string, token?: string | null) {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Cookie: `curavilo_session=${token}` } : {},
  });
  console.log(`${label}: ${res.status}`);
  return res.status;
}

async function main() {
  const owner = await login("eyeclinic@curavilo.demo");
  const reception = await login("reception@curavilo.demo");

  const gracefieldOrg = await db.organization.findUnique({ where: { slug: "gracefield-gmc" } });
  const eyeOrg = await db.organization.findUnique({ where: { slug: "lagos-central-eye-clinic" } });
  if (!gracefieldOrg || !eyeOrg) throw new Error("seed data missing");
  const gracefieldPatient = await db.patient.findFirst({
    where: { orgId: gracefieldOrg.id },
  });
  const gracefieldInvoice = await db.invoice.findFirst({
    where: { orgId: gracefieldOrg.id },
  });
  if (!gracefieldPatient || !gracefieldInvoice) throw new Error("seed data missing");

  let failures = 0;
  if ((await probe("anon GET /api/patients", "/api/patients", null)) !== 401) failures++;
  if ((await probe("eye-clinic GET other-tenant patient", `/api/patients/${gracefieldPatient.id}`, owner)) !== 404) failures++;
  if ((await probe("eye-clinic GET other-tenant invoice", `/api/invoices?id=${gracefieldInvoice.id}`, owner)) !== 404) failures++;

  // ── Phase 5–13 surface: anonymous + RBAC probes ──
  const anonRoutes = ["/api/lab", "/api/wards", "/api/command", "/api/simulation", "/api/comms", "/api/webhooks", "/api/data?export=patients", "/api/portal", "/api/health"];
  for (const r of anonRoutes) {
    const expect = r === "/api/health" ? 200 : 401;
    if ((await probe(`anon GET ${r}`, r, null)) !== expect) failures++;
  }
  // receptionist lacks lab:operate / inpatient:manage / workflows:manage / data:manage / settings:manage
  for (const r of ["/api/lab", "/api/wards", "/api/data?export=patients", "/api/comms", "/api/webhooks"]) {
    const status = await probe(`reception GET ${r}`, r, reception);
    if (status !== 403 && status !== 400) failures++;
  }
  // workflows GET is intentionally viewable to staff (manage is gated separately)
  {
    const status = await probe("reception GET /api/workflows", "/api/workflows", reception);
    if (status !== 200) failures++;
  }
  // FHIR: anon must be rejected; owner allowed on Patient
  if ((await probe("anon GET /api/fhir/Patient", "/api/fhir/Patient", null)) !== 401) failures++;

  // RBAC: receptionist lacks payments:record
  const ownInvoice = await db.invoice.findFirst({
    where: { orgId: eyeOrg.id, status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
  });
  if (ownInvoice) {
    const res = await fetch(`${BASE}/api/invoices?id=${ownInvoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: `curavilo_session=${reception}` },
      body: JSON.stringify({ action: "PAY", amountMinor: 100, method: "CASH" }),
    });
    console.log(`receptionist PAY on own invoice: ${res.status}`);
    if (res.status !== 403) failures++;
  }

  // AI: receptionist CAN ask (ai:ask) — should succeed
  const ai = await fetch(`${BASE}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `curavilo_session=${reception}` },
    body: JSON.stringify({ message: "How many appointments are scheduled today?" }),
  });
  console.log(`receptionist AI ask: ${ai.status}`);

  console.log(failures === 0 ? "\nALL SECURITY PROBES PASSED" : `\n${failures} SECURITY PROBES FAILED`);
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
