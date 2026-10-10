// HR API - people operations (permission-gated): overview, leave decisions,
// attendance, reviews, certifications, announcements.
import { ok, fail, requireAuth, parseBody, parseQuery } from "@/lib/api";
import { z } from "zod";
import {
  hrOverview, decideLeaveHr, markAttendance, createReview,
  addCertificationHr, announce,
  reviewSchema, attendanceSchema, hrCertificationSchema, announcementSchema,
} from "@/modules/hr";

const query = z.object({ view: z.enum(["overview"]).default("overview") });

const actionSchema = z.union([
  z.object({ action: z.literal("decide-leave"), id: z.string().min(5), decision: z.enum(["APPROVED", "REJECTED"]) }),
  z.object({ action: z.literal("attendance"), data: attendanceSchema }),
  z.object({ action: z.literal("review"), data: reviewSchema }),
  z.object({ action: z.literal("certification"), data: hrCertificationSchema }),
  z.object({ action: z.literal("announce"), data: announcementSchema }),
]);

export async function GET(request: Request) {
  try {
    parseQuery(request, query);
    const ctx = await requireAuth("hr:read");
    return ok(await hrOverview(ctx));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("hr:manage");
    const input = await parseBody(request, actionSchema);
    switch (input.action) {
      case "decide-leave":
        return ok(await decideLeaveHr(ctx, input.id, input.decision));
      case "attendance":
        return ok(await markAttendance(ctx, input.data));
      case "review":
        return ok(await createReview(ctx, input.data));
      case "certification":
        return ok(await addCertificationHr(ctx, input.data));
      case "announce":
        return ok(await announce(ctx, input.data));
    }
  } catch (error) {
    return fail(error);
  }
}
