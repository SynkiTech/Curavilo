// Simulation API - scenario builder + run (spec §56–60, §138)
import { z } from "zod";
import { ok, fail, parseBody, requireAuth } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { runScenarios, calibrateFromOperations, type SimulationParams } from "@/lib/simulation";

const stationSchema = z.object({
  key: z.string().min(1).max(30),
  label: z.string().min(1).max(60),
  servers: z.number().int().min(0).max(50),
  meanServiceMin: z.number().min(0.5).max(240),
  sdServiceMin: z.number().min(0).max(120),
  routeShare: z.number().min(0).max(1),
});

const paramsSchema = z.object({
  hours: z.number().min(1).max(24),
  arrivalsPerDay: z.number().min(1).max(2000),
  urgentShare: z.number().min(0).max(0.9).default(0.1),
  days: z.number().int().min(1).max(14).default(3),
  stations: z.array(stationSchema).min(1).max(8),
});

export async function GET() {
  try {
    const ctx = await requireAuth("reports:read");
    const baseline = await calibrateFromOperations(ctx.orgId, ctx.facilityId);
    const scenarios = await db.simulationScenario.findMany({
      where: { orgId: ctx.orgId, facilityId: ctx.facilityId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    return ok({ baseline, scenarios });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("reports:read");
    // Monte-Carlo simulation is CPU-bound: cap request rate per user (DoS resistance).
    if (!rateLimit(`sim:${clientIp(request)}:${ctx.userId}`, 10, 10 * 60_000)) {
      return ok({ error: "Too many simulations. Please wait a few minutes." }, 429);
    }
    const body = await parseBody(request, z.object({
      action: z.enum(["RUN", "SAVE"]),
      baseline: paramsSchema,
      scenario: paramsSchema.optional(),
      name: z.string().max(80).optional(),
    }));

    const baseSummary = runScenarios(body.baseline as unknown as SimulationParams);
    const scenarioSummary = body.scenario ? runScenarios(body.scenario as unknown as SimulationParams) : null;

    let savedId: string | undefined;
    if (body.action === "SAVE" && body.name && body.scenario) {
      const saved = await db.simulationScenario.create({
        data: {
          orgId: ctx.orgId, facilityId: ctx.facilityId,
          name: body.name,
          paramsJson: JSON.stringify(body.scenario),
          resultJson: JSON.stringify(scenarioSummary),
          seed: 1,
          createdById: ctx.userId,
        },
      });
      savedId = saved.id;
    }

    return ok({
      baseline: baseSummary,
      scenario: scenarioSummary,
      savedId,
      disclaimer: "Operational estimates for planning only - not clinical predictions. Ranges reflect stochastic variation across seeds.",
    });
  } catch (error) {
    return fail(error);
  }
}
