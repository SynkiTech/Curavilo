"use client";

// Overview — role-aware dashboard (spec §77)
import { useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { apiGet, formatMoney, formatDateTime, type Payment, type Patient, type QueueEntry } from "./api";
import { LoadingState, ErrorState, StatCard, PageHeader } from "./ui-kit";
import { useApp } from "./store";

interface DashboardData {
  stats: {
    patientsToday: number;
    waiting: number;
    inService: number;
    completedToday: number;
    appointmentsToday: number;
    revenueTodayMinor: number;
    overdueFollowUps: number;
    currency: string;
    profile: string;
  };
  lowStock: { id: string; name: string; stockOnHand: number; reorderLevel: number }[];
  queueSnapshot: QueueEntry[];
  recentPayments: Payment[];
}

export function Overview() {
  const { session, navigate } = useApp();
  const user = session?.user;
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<DashboardData>("/api/dashboard"),
    refetchInterval: 30_000,
  });

  if (isLoading) return <LoadingState label="Loading dashboard…" />;
  if (isError) return <ErrorState message={(error as Error)?.message ?? "Failed to load dashboard."} onRetry={() => void refetch()} />;
  if (!data || !user) return null;

  const s = data.stats;
  const tz = user.timezone;

  return (
    <div>
      <PageHeader
        title={`Good day, ${user.name.replace(/^Dr\.\s*/i, "").split(" ")[0] || user.name}`}
        subtitle={`${user.facilityName} · today at a glance`}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard title="Registered today" value={s.patientsToday} />
        <StatCard title="Waiting" value={s.waiting} tone={s.waiting > 6 ? "warn" : "default"} hint="in queue now" />
        <StatCard title="In service" value={s.inService} />
        <StatCard title="Completed today" value={s.completedToday} />
        <StatCard title="Revenue today" value={formatMoney(s.revenueTodayMinor, s.currency)} />
        <StatCard title="Appointments" value={s.appointmentsToday} hint="scheduled today" />
        <StatCard title="Overdue follow-ups" value={s.overdueFollowUps} tone={s.overdueFollowUps > 0 ? "warn" : "default"} />
        <StatCard title="Low stock items" value={data.lowStock.length} tone={data.lowStock.length > 0 ? "warn" : "default"} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section aria-label="Live queue" className="rounded-lg border bg-white">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Live queue</h2>
            <button className="flex items-center gap-1 text-xs text-teal-700 hover:underline" onClick={() => navigate("queue")}>
              <Link2 className="h-3 w-3" /> Open queue
            </button>
          </div>
          {data.queueSnapshot.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No patients waiting right now.</p>
          ) : (
            <ul className="divide-y">
              {data.queueSnapshot.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-bold tabular-nums">
                    {entry.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {entry.patient ? `${entry.patient.firstName} ${entry.patient.lastName}` : "Patient"}
                    <span className="ml-2 text-xs text-muted-foreground">{entry.department}</span>
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    entry.status === "IN_SERVICE" ? "border-teal-300 bg-teal-50 text-teal-700" :
                    entry.status === "CALLED" ? "border-teal-200 bg-teal-50/60 text-teal-700" :
                    "border-amber-200 bg-amber-50 text-amber-700"
                  }`}>
                    {entry.status.replaceAll("_", " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-4">
          <section aria-label="Operational alerts" className="rounded-lg border bg-white">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Operational alerts</h2>
            </div>
            {data.lowStock.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">All stock levels look healthy.</p>
            ) : (
              <ul className="divide-y">
                {data.lowStock.slice(0, 5).map((item) => (
                  <li key={item.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="truncate">{item.name}</span>
                    <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                      {item.stockOnHand} left · reorder at {item.reorderLevel}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Recent payments" className="rounded-lg border bg-white">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Recent payments</h2>
            </div>
            {data.recentPayments.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No payments recorded yet.</p>
            ) : (
              <ul className="divide-y">
                {data.recentPayments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{p.number}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {p.invoice?.patient ? `${p.invoice.patient.firstName} ${p.invoice.patient.lastName}` : ""} · {formatDateTime(p.createdAt, tz)}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">{formatMoney(p.amountMinor, p.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
