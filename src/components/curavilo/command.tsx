"use client";

// Operations Command Center - metrics, anomaly alerts, bottlenecks (spec §139)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Gauge, Shuffle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiGet, apiSend } from "./api";
import { LoadingState, ErrorState, PageHeader, StatCard } from "./ui-kit";
import { useApp } from "./store";
import { toast } from "sonner";

interface Metric { key: string; label: string; value: string; numeric: number; unit?: string; baseline?: number; direction?: string }
interface OpsAlert { id: string; metric: string; severity: string; value: string; baseline?: string | null; message: string; createdAt: string }
interface Bottleneck { area: string; load: number; avgWaitProxy: number; hint: string }

export function Command() {
  const { navigate } = useApp();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["command"],
    queryFn: () => apiGet<{ metrics: Metric[]; alerts: OpsAlert[]; bottlenecks: Bottleneck[] }>("/api/command"),
    refetchInterval: 60_000,
  });

  const ack = useMutation({
    mutationFn: (alertId: string) => apiSend("POST", "/api/command", { action: "ACK_ALERT", alertId }),
    onSuccess: () => {
      toast.success("Alert acknowledged.");
      queryClient.invalidateQueries({ queryKey: ["command"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div>
      <PageHeader
        title="Command Center"
        subtitle="Live operational metrics, statistical anomaly alerts (z ≥ 2 vs 7-day baseline) and capacity bottlenecks."
        actions={
          <Button size="sm" variant="outline" onClick={() => navigate("simulation")}>
            <Shuffle className="mr-1.5 h-3.5 w-3.5" /> Open scenario launcher
          </Button>
        }
      />

      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}

      {data ? (
        <div className="space-y-6">
          <section aria-label="Key metrics">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.metrics.slice(0, 8).map((m) => (
                <StatCard
                  key={m.key}
                  title={m.label}
                  value={m.unit === "NGN" ? `₦${Number(m.value).toLocaleString()}` : m.value}
                  hint={m.baseline !== undefined ? `7-day baseline ≈ ${Math.round(m.baseline)}` : undefined}
                  tone={Math.abs((m.numeric ?? 0) - (m.baseline ?? 0)) > (m.baseline ?? 0) * 0.7 ? "warn" : "default"}
                />
              ))}
            </div>
          </section>

          <section aria-label="Alerts">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-stone-600">
              <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden /> Anomaly alerts
            </h2>
            {data.alerts.length === 0 ? (
              <p className="rounded-lg border bg-white px-4 py-6 text-center text-sm text-muted-foreground">No anomalies detected - operations look nominal.</p>
            ) : (
              <ul className="space-y-2">
                {data.alerts.map((a) => (
                  <li key={a.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3 ${a.severity === "CRITICAL" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
                    <div>
                      <p className="text-sm font-medium">{a.message}</p>
                      <p className="text-xs text-muted-foreground">{a.metric} · now {a.value} vs baseline {a.baseline}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => navigate("ai")}>
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Ask AI
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => ack.mutate(a.id)} disabled={ack.isPending}>
                        <Check className="mr-1.5 h-3.5 w-3.5" /> Acknowledge
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Bottlenecks">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-stone-600">
              <Gauge className="h-4 w-4 text-stone-500" aria-hidden /> Capacity pressure (7-day)
            </h2>
            {data.bottlenecks.length === 0 ? (
              <p className="rounded-lg border bg-white px-4 py-6 text-center text-sm text-muted-foreground">No significant pressure detected.</p>
            ) : (
              <Card>
                <CardContent className="pt-4">
                  <ol className="space-y-2">
                    {data.bottlenecks.map((b, i) => (
                      <li key={b.area} className="flex items-center gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-semibold">{i + 1}</span>
                        <span className="w-32 shrink-0 text-sm font-medium">{b.area.replaceAll("_", " ")}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100" aria-hidden>
                          <div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.min(100, (b.avgWaitProxy / 60) * 100)}%` }} />
                        </div>
                        <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">~{Math.round(b.avgWaitProxy)} min</span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
