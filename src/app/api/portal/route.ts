// Portal API - staff token management + patient portal session/data (spec §141)
import { NextResponse } from "next/server";
import { z } from "zod";
import { ok, fail, parseBody, requireAuth } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import {
  PORTAL_COOKIE, createPortalToken, listPortalTokens, revokePortalToken,
  portalLogin, portalData, portalRateLimited, myDay, addCertification, requestLeave,
  decideLeave, listPendingLeave, recordLoginAttempt, certificationSchema, leaveSchema,
} from "@/modules/portal";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    // Patient-portal session read (no staff session required)
    const jar = await import("next/headers").then((m) => m.cookies());
    const portalHash = jar.get(PORTAL_COOKIE)?.value;
    const hasStaffSession = !!(await getAuth());
    if (portalHash && !hasStaffSession) {
      return ok(await portalData(portalHash));
    }
    // Staff side
    const ctx = await requireAuth();
    if (url.searchParams.get("scope") === "tokens") {
      return ok({ tokens: await listPortalTokens(ctx) });
    }
    if (url.searchParams.get("scope") === "leave") {
      return ok({ pendingLeave: await listPendingLeave(ctx) });
    }
    return ok(await myDay(ctx));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") ?? "main";

    // Patient portal (unauthenticated actions)
    if (scope === "login") {
      const body = await parseBody(request, z.object({ mrn: z.string().min(2).max(30), code: z.string().min(6).max(40) }));
      const key = `${request.headers.get("x-forwarded-for") ?? "ip"}:${body.mrn}`;
      if (portalRateLimited(key)) {
        recordLoginAttempt(key);
        return ok({ error: "Too many attempts. Try again in 15 minutes." }, 429);
      }
      recordLoginAttempt(key);
      const session = await portalLogin(body.mrn, body.code);
      const res = NextResponse.json({ ok: true, patientPortal: true });
      res.cookies.set(PORTAL_COOKIE, session.tokenHash, {
        httpOnly: true, sameSite: "lax", path: "/", maxAge: 12 * 3600,
      });
      return res;
    }
    if (scope === "logout") {
      const res = NextResponse.json({ ok: true });
      res.cookies.set(PORTAL_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
      return res;
    }

    // Staff-authenticated actions
    const ctx = await requireAuth();
    const body = await parseBody(request, z.object({
      action: z.enum(["CREATE_TOKEN", "REVOKE_TOKEN", "ADD_CERTIFICATION", "REQUEST_LEAVE", "DECIDE_LEAVE"]),
      patientId: z.string().min(5).optional(),
      label: z.string().max(80).optional(),
      tokenId: z.string().min(5).optional(),
      certification: certificationSchema.optional(),
      leave: leaveSchema.optional(),
      leaveId: z.string().min(5).optional(),
      decision: z.enum(["APPROVED", "REJECTED"]).optional(),
    }));

    switch (body.action) {
      case "CREATE_TOKEN": {
        if (!body.patientId) return ok({ error: "patientId is required." }, 400);
        return ok(await createPortalToken(ctx, body.patientId, body.label), 201);
      }
      case "REVOKE_TOKEN": {
        if (!body.tokenId) return ok({ error: "tokenId is required." }, 400);
        return ok(await revokePortalToken(ctx, body.tokenId));
      }
      case "ADD_CERTIFICATION": {
        if (!body.certification) return ok({ error: "certification is required." }, 400);
        return ok({ certification: await addCertification(ctx, body.certification) }, 201);
      }
      case "REQUEST_LEAVE": {
        if (!body.leave) return ok({ error: "leave is required." }, 400);
        return ok({ leave: await requestLeave(ctx, body.leave) }, 201);
      }
      case "DECIDE_LEAVE": {
        if (!body.leaveId || !body.decision) return ok({ error: "leaveId and decision are required." }, 400);
        return ok(await decideLeave(ctx, body.leaveId, body.decision));
      }
      default:
        return ok({ error: "Unknown action." }, 400);
    }
  } catch (error) {
    return fail(error);
  }
}
