// Dashboard API - role-aware overview stats
import { ok, fail, requireAuth } from "@/lib/api";
import { dashboardStats } from "@/modules/reports";

export async function GET() {
  try {
    const ctx = await requireAuth("patients:read");
    const data = await dashboardStats(ctx);
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}
