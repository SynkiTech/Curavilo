// Operations command center API (spec §139)
import { z } from "zod";
import { ok, fail, parseBody, requireAuth } from "@/lib/api";
import { computeAnalytics, detectAnomalies, listAlerts, acknowledgeAlert, detectBottlenecks } from "@/modules/analytics";

export async function GET() {
  try {
    const ctx = await requireAuth("reports:read");
    const [metrics, alerts, bottlenecks] = await Promise.all([
      computeAnalytics(ctx),
      detectAnomalies(ctx).then(() => listAlerts(ctx.orgId)),
      detectBottlenecks(ctx),
    ]);
    return ok({ metrics, alerts, bottlenecks });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("reports:read");
    const body = await parseBody(request, z.object({
      action: z.enum(["ACK_ALERT"]),
      alertId: z.string().min(5),
    }));
    if (body.action === "ACK_ALERT") return ok(await acknowledgeAlert(ctx.orgId, body.alertId));
  } catch (error) {
    return fail(error);
  }
}
