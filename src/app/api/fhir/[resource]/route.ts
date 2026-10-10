// FHIR export endpoint - /api/fhir/{Resource}?count=50 (read-only, auth'd, audited)
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/api";
import { FHIR_RESOURCES, FHIR_PERMISSION, mapResource, type FhirResource } from "@/lib/fhir";
import { rateLimit, clientIp } from "@/lib/rate-limit";

function outcome(status: number, code: string, diagnostics: string) {
  return NextResponse.json(
    { resourceType: "OperationOutcome", issue: [{ severity: "error", code, diagnostics }] },
    { status },
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  // requireAuth (not raw getAuth) so mustChangePassword accounts and missing
  // permissions fail closed through the standard guard.
  let ctx;
  try {
    ctx = await requireAuth();
  } catch {
    return outcome(401, "unauthorized", "Authentication required.");
  }

  // Bulk-PII surface: rate limited per user to blunt scraping/enumeration.
  if (!rateLimit(`fhir:${clientIp(request)}:${ctx.userId}`, 30, 10 * 60_000)) {
    return outcome(429, "too-many-requests", "Too many exports. Try again later.");
  }

  const { resource } = await params;
  if (!FHIR_RESOURCES.includes(resource as FhirResource)) {
    return outcome(404, "not-supported", `Supported: ${FHIR_RESOURCES.join(", ")}`);
  }
  const permission = FHIR_PERMISSION[resource as FhirResource];
  if (!ctx.permissions.includes(permission as never)) {
    return outcome(403, "forbidden", `Requires ${permission}.`);
  }

  const url = new URL(request.url);
  const count = Math.min(200, Math.max(1, Number(url.searchParams.get("count") ?? 50) || 50));
  const entries = await mapResource(ctx, resource as FhirResource, count);

  await audit({
    orgId: ctx.orgId, facilityId: ctx.facilityId, actorUserId: ctx.userId, actorLabel: ctx.userName,
    action: "fhir.export", entityType: "FhirBundle", entityId: resource,
    summary: `FHIR export of ${entries.length} ${resource} resource(s) (count=${count}).`,
  });

  return NextResponse.json({
    resourceType: "Bundle",
    type: "searchset",
    total: entries.length,
    entry: entries.map((r) => ({ resource: r })),
  });
}

export async function POST() {
  // Read-only export surface - writes are intentionally not supported.
  return outcome(405, "not-supported", "FHIR export is read-only.");
}
export const dynamic = "force-dynamic";
