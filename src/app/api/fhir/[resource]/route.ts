// FHIR export endpoint - /api/fhir/{Resource}?count=50 (read-only, auth'd, audited)
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { FHIR_RESOURCES, FHIR_PERMISSION, mapResource, type FhirResource } from "@/lib/fhir";

export async function GET(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: { code: "unauthorized", message: "Authentication required." } }, { status: 401 });

  const { resource } = await params;
  if (!FHIR_RESOURCES.includes(resource as FhirResource)) {
    return NextResponse.json(
      { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-supported", diagnostics: `Supported: ${FHIR_RESOURCES.join(", ")}` }] },
      { status: 404 },
    );
  }
  const permission = FHIR_PERMISSION[resource as FhirResource];
  if (!ctx.permissions.includes(permission as never)) {
    return NextResponse.json(
      { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "forbidden", diagnostics: `Requires ${permission}.` }] },
      { status: 403 },
    );
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
  return NextResponse.json(
    { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-supported", diagnostics: "FHIR export is read-only." }] },
    { status: 405 },
  );
}
export const dynamic = "force-dynamic";
