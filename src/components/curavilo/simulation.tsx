"use client";

// Simulation — scenario builder + baseline comparison (spec §56–60, §138)
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Play, Save, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiGet, apiSend } from "./api";
import { LoadingState, ErrorState, PageHeader } from "./ui-kit";
import { toast } from "sonner";

interface Station { key: string; label: string; servers: number; meanServiceMin: number; sdServiceMin: number; routeShare: number }
interface Baseline { arrivalsPerDay: number; hours: number; stations: Station[] }
interface Stat { median: number; p10: number; p90: number }
interface ScenarioSummary {
  throughputPerDay: Stat;
  avgTotalWaitMin: Stat;
  perStation: Array<{ key: string; label: string; avgWaitMin: Stat; utilization: { median: number }; maxQueueLength: { median: number } }>;
  bottleneckLabel: string;
}

function fmt(x: number | undefined): string {
  return x === undefined ? "—" : Math.round(x * 10) / 10 >= 100 ? String(Math.round(x)) : (Math.round(x * 10) / 10).toFixed(1);
}

export function Simulation() {
  const { data: base, isLoading, isError, error } = useQuery({
    queryKey: ["simulation-baseline"],
    queryFn: () => apiGet<{ baseline: Baseline }>("/api/simulation"),
  });

  const [scenario, setScenario] = useState<Baseline | null>(null);
  const [volumeMultiplier, setVolumeMultiplier] = useState(1.3);
  const [saveName, setSaveName] = useState("");
  const [seeded, setSeeded] = useState(false);

  // Seed the editable scenario once baseline data arrives (via state initializer
  // alternative: flag-based seeding keeps this out of render).
  if (base?.baseline && !seeded) {
    setScenario(JSON.parse(JSON.stringify(base.baseline)) as Baseline);
    setSeeded(true);
  }

  const run = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiSend<{ baseline: ScenarioSummary; scenario: ScenarioSummary | null; disclaimer: string }>("POST", "/api/simulation", payload),
    onSuccess: (res) => toast.success("Simulation complete — estimates below."),
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <LoadingState label="Calibrating from your operational data…" />;
  if (isError) return <ErrorState message={(error as Error)?.message} />;
  if (!base || !scenario) return null;

  const scaledArrivals = Math.max(1, Math.round(base.baseline.arrivalsPerDay * volumeMultiplier));

  const runBoth = (save = false) => {
    if (save && !saveName.trim()) {
      toast.error("Name the scenario to save it.");
      return;
    }
    run.mutate({
      action: save ? "SAVE" : "RUN",
      baseline: { ...base.baseline, days: 3 },
      scenario: { ...scenario, arrivalsPerDay: scaledArrivals, days: 3 },
      ...(save ? { name: saveName.trim() } : {}),
    });
  };

  return (
    <div>
      <PageHeader title="Simulation" subtitle="Discrete-event what-if analysis, calibrated on your last 14 days of queue and consultation data. Five seeds per run; outputs are medians with p10–p90 ranges." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Scenario levers</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Patient volume — {base.baseline.arrivalsPerDay}/day → <strong>{scaledArrivals}/day</strong></Label>
              <Slider value={[volumeMultiplier]} min={0.5} max={2.5} step={0.05} onValueChange={(v) => setVolumeMultiplier(v[0])} aria-label="Volume multiplier" />
              <p className="text-xs text-muted-foreground">{volumeMultiplier.toFixed(2)}× baseline</p>
            </div>
            {scenario.stations.map((st, i) => (
              <div key={st.key} className="rounded-lg border p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-medium">{st.label}</span>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" className="h-6 w-6 p-0" onClick={() => setScenario((s) => { const n = JSON.parse(JSON.stringify(s!)) as Baseline; n.stations[i].servers = Math.max(0, n.stations[i].servers - 1); return n; })} aria-label={`Remove ${st.label} capacity`}>−</Button>
                    <span className="w-20 text-center text-sm tabular-nums">{st.servers} server{st.servers === 1 ? "" : "s"}</span>
                    <Button size="sm" variant="outline" className="h-6 w-6 p-0" onClick={() => setScenario((s) => { const n = JSON.parse(JSON.stringify(s!)) as Baseline; n.stations[i].servers = Math.min(20, n.stations[i].servers + 1); return n; })} aria-label={`Add ${st.label} capacity`}>+</Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">≈{st.meanServiceMin} min mean service · routed to {Math.round(st.routeShare * 100)}%</p>
              </div>
            ))}
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => runBoth(false)} disabled={run.isPending}>
                <Play className="mr-1.5 h-4 w-4" /> Run comparison
              </Button>
              <Button variant="outline" onClick={() => runBoth(true)} disabled={run.isPending}>
                <Save className="mr-1.5 h-4 w-4" /> Save
              </Button>
            </div>
            <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Scenario name (for saving)" aria-label="Scenario name" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Comparison</CardTitle></CardHeader>
          <CardContent>
            {run.isPending ? <LoadingState label="Simulating 5 seeds × 3 days…" /> : null}
            {!run.data && !run.isPending ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Run a comparison to see baseline vs scenario estimates.</p>
            ) : null}
            {run.data ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {(["baseline", "scenario"] as const).map((which) => {
                    const s = run.data![which];
                    if (!s) return null;
                    return (
                      <div key={which} className={`rounded-lg border p-3 ${which === "scenario" ? "border-teal-300 bg-teal-50/50" : ""}`}>
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{which === "baseline" ? "Current" : "Scenario"}</p>
                        <p className="text-sm">Throughput: <strong>{fmt(s.throughputPerDay.median)}</strong> patients/day <span className="text-xs text-muted-foreground">({fmt(s.throughputPerDay.p10)}–{fmt(s.throughputPerDay.p90)})</span></p>
                        <p className="text-sm">Avg wait: <strong>{fmt(s.avgTotalWaitMin.median)} min</strong> <span className="text-xs text-muted-foreground">({fmt(s.avgTotalWaitMin.p10)}–{fmt(s.avgTotalWaitMin.p90)})</span></p>
                        <p className="mt-1 text-xs">Largest pressure: {s.bottleneckLabel}</p>
                      </div>
                    );
                  })}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-1.5">Station</th>
                      <th className="py-1.5">Wait now</th>
                      <th className="py-1.5">Wait scenario</th>
                      <th className="py-1.5">Util. scenario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.data.baseline.perStation.map((st, i) => (
                      <tr key={st.key} className="border-b last:border-0">
                        <td className="py-1.5">{st.label}</td>
                        <td className="py-1.5 tabular-nums">{fmt(st.avgWaitMin.median)} min</td>
                        <td className="py-1.5 tabular-nums">{run.data!.scenario ? `${fmt(run.data!.scenario.perStation[i]?.avgWaitMin.median)} min` : "—"}</td>
                        <td className="py-1.5 tabular-nums">{run.data!.scenario ? `${Math.round((run.data!.scenario.perStation[i]?.utilization.median ?? 0) * 100)}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {run.data.disclaimer}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
