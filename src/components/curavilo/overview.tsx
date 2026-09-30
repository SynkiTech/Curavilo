"use client";

// Overview: role-aware dashboard (spec §77) with animated KPIs, live charts and JS effects
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Link2, UserPlus, Users, Clock3, Stethoscope, CheckCircle2, Wallet, CalendarDays,
  BellRing, PackageSearch, Activity, ArrowRight,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { apiGet, formatMoney, formatDateTime, type Payment, type QueueEntry } from "./api";
import { LoadingState, ErrorState, MetricCard, type Accent } from "./ui-kit";
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
  trends: {
    revenueByDay: { date: string; minor: number }[];
    encountersByDay: { date: string; count: number }[];
    revenueByMethod: { method: string; minor: number }[];
  };
}

const PIE_COLORS = ["#0d9488", "#06b6d4", "#8b5cf6", "#f59e0b", "#f43f5e", "#6366f1"];

function useToday(): string {
  const [today, setToday] = useState("");
  useEffect(() => {
    const kick = setTimeout(() => setToday(new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })), 0);
    return () => clearTimeout(kick);
  }, []);
  return today;
}

export function Overview() {
  const { session, navigate } = useApp();
  const user = session?.user;
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<DashboardData>("/api/dashboard"),
    refetchInterval: 30_000,
  });
  const today = useToday();

  if (isLoading) return <LoadingState label="Loading dashboard…" />;
  if (isError) return <ErrorState message={(error as Error)?.message ?? "Failed to load dashboard."} onRetry={() => void refetch()} />;
  if (!data || !user) return null;

  const s = data.stats;
  const currency = s.currency;

  const compactMoney = (minor: number) => {
    try {
      return new Intl.NumberFormat("en", { notation: "compact", style: "currency", currency, maximumFractionDigits: 1 }).format(minor / 100);
    } catch {
      return String(Math.round(minor / 100));
    }
  };
  const fullMoney = (minor: number) => {
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
    } catch {
      return `${currency} ${(minor / 100).toFixed(2)}`;
    }
  };

  const firstName = user.name.replace(/^Dr\.\s*/i, "").split(" ")[0] || user.name;

  const kpis: { title: string; value: number | string; hint?: string; icon: React.ComponentType<{ className?: string }>; accent?: Accent; tone?: "default" | "warn"; money?: boolean }[] = [
    { title: "Registered today", value: s.patientsToday, hint: "new patients", icon: UserPlus, accent: "teal" },
    { title: "Waiting", value: s.waiting, tone: s.waiting > 6 ? "warn" : "default", hint: "in queue now", icon: Clock3, accent: "amber" },
    { title: "In service", value: s.inService, hint: "with clinician", icon: Stethoscope, accent: "cyan" },
    { title: "Completed today", value: s.completedToday, hint: "encounters", icon: CheckCircle2, accent: "emerald" },
    { title: "Revenue today", value: s.revenueTodayMinor, hint: "payments collected", icon: Wallet, accent: "violet", money: true },
    { title: "Appointments", value: s.appointmentsToday, hint: "scheduled today", icon: CalendarDays, accent: "indigo" },
    { title: "Overdue follow-ups", value: s.overdueFollowUps, tone: s.overdueFollowUps > 0 ? "warn" : "default", hint: "need attention", icon: BellRing, accent: "rose" },
    { title: "Low stock items", value: data.lowStock.length, tone: data.lowStock.length > 0 ? "warn" : "default", hint: "at reorder level", icon: PackageSearch, accent: "amber" },
  ];

  const hasRevenueTrend = data.trends.revenueByDay.some((d) => d.minor > 0);
  const hasEncounterTrend = data.trends.encountersByDay.some((d) => d.count > 0);
  const donutData = data.trends.revenueByMethod.filter((d) => d.minor > 0);

  return (
    <div>
      {/* Hero band: animated gradient with sheen sweep */}
      <section
        aria-label="Dashboard overview"
        className="curvilo-hero curvilo-rise relative mb-5 overflow-hidden rounded-2xl px-5 py-6 text-white shadow-lg shadow-teal-900/20 sm:px-7"
      >
        <div className="curvilo-sheen" aria-hidden />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-teal-100/80">{today || "Today"}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Good day, {firstName}</h1>
            <p className="mt-1 text-sm text-teal-100/85">
              {user.facilityName} · {s.profile ? s.profile.replace(/_/g, " ").toLowerCase() : "general"} workspace · figures refresh every 30s
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="relative flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
              <span className="relative flex h-2 w-2 text-emerald-300">
                <span className="curvilo-ping relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
              </span>
              Live
            </span>
            <button
              onClick={() => navigate("queue")}
              className="group flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-white/25"
            >
              Open queue
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </button>
            <button
              onClick={() => navigate("patients")}
              className="group flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-white/25"
            >
              Patients
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </button>
          </div>
        </div>
      </section>

      {/* KPI grid: staggered entrance + count-up numbers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {kpis.map((k, i) => (
          <MetricCard
            key={k.title}
            title={k.title}
            value={k.money ? (k.value as number) / 100 : (k.value as number)}
            hint={k.hint}
            icon={k.icon}
            accent={k.accent}
            tone={k.tone}
            delay={80 + i * 55}
            formatValue={k.money ? (n) => formatMoney(Math.round(n * 100), currency) : undefined}
          />
        ))}
      </div>

      {/* Charts row 1: revenue trend + payment mix donut */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <section aria-label="Revenue trend" className={`curvilo-card curvilo-rise rounded-xl border bg-white p-4 lg:col-span-2 ${hasRevenueTrend ? "" : "hidden lg:block"}`} style={{ animationDelay: "480ms" }}>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Revenue trend</h2>
              <p className="text-xs text-muted-foreground">Payments collected, last 14 days</p>
            </div>
            <button className="flex items-center gap-1 text-xs text-teal-700 hover:underline" onClick={() => navigate("billing")}>
              <Link2 className="h-3 w-3" /> Billing
            </button>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.trends.revenueByDay} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="curviloRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} width={54} tickFormatter={(v: number) => compactMoney(v)} />
                <ChartTooltip
                  formatter={(v) => [fullMoney(Number(v)), "Collected"]}
                  labelFormatter={(l) => String(l)}
                  contentStyle={{ borderRadius: 10, fontSize: 12, borderColor: "#ccfbf1" }}
                />
                <Area type="monotone" dataKey="minor" stroke="#0d9488" strokeWidth={2.5} fill="url(#curviloRev)" animationDuration={1200} name="Collected" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section aria-label="Payment mix" className="curvilo-card curvilo-rise rounded-xl border bg-white p-4" style={{ animationDelay: "540ms" }}>
          <h2 className="text-sm font-semibold">Payment mix</h2>
          <p className="text-xs text-muted-foreground">Share by method, last 14 days</p>
          {donutData.length === 0 ? (
            <p className="flex h-48 items-center justify-center text-sm text-muted-foreground">No payments in the last 14 days.</p>
          ) : (
            <div className="relative h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="minor"
                    nameKey="method"
                    innerRadius="58%"
                    outerRadius="86%"
                    paddingAngle={3}
                    cornerRadius={5}
                    animationDuration={1100}
                  >
                    {donutData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <ChartTooltip formatter={(v, n) => [fullMoney(Number(v)), String(n)]} contentStyle={{ borderRadius: 10, fontSize: 12, borderColor: "#ccfbf1" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Total</span>
                <span className="text-sm font-bold tabular-nums text-stone-700">
                  {fullMoney(donutData.reduce((sum, d) => sum + d.minor, 0))}
                </span>
              </div>
            </div>
          )}
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {donutData.map((d, i) => (
              <li key={d.method} className="flex items-center gap-1.5 text-[11px] text-stone-600">
                <span className="h-2 w-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} aria-hidden />
                {d.method}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Charts row 2: patient volume + live queue */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section aria-label="Patient volume" className="curvilo-card curvilo-rise rounded-xl border bg-white p-4" style={{ animationDelay: "600ms" }}>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Patient volume</h2>
              <p className="text-xs text-muted-foreground">Encounters started, last 14 days</p>
            </div>
            <Activity className="h-4 w-4 text-teal-600" aria-hidden />
          </div>
          {hasEncounterTrend ? (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.trends.encountersByDay} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="curviloVol" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22d3ee" />
                      <stop offset="100%" stopColor="#0f766e" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={28} />
                  <ChartTooltip formatter={(v) => [`${v} encounters`, "Volume"]} contentStyle={{ borderRadius: 10, fontSize: 12, borderColor: "#ccfbf1" }} />
                  <Bar dataKey="count" fill="url(#curviloVol)" radius={[4, 4, 0, 0]} animationDuration={1100} name="Encounters" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="flex h-52 items-center justify-center text-sm text-muted-foreground">No encounters recorded in the last 14 days.</p>
          )}
        </section>

        <section aria-label="Live queue" className="curvilo-card curvilo-rise rounded-xl border bg-white" style={{ animationDelay: "660ms" }}>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Live queue</h2>
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">{data.queueSnapshot.length} active</span>
          </div>
          {data.queueSnapshot.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">No patients waiting right now.</p>
          ) : (
            <ul className="max-h-64 divide-y overflow-y-auto">
              {data.queueSnapshot.map((entry, i) => (
                <li key={entry.id} className="curvilo-rise flex items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-teal-50/40" style={{ animationDelay: `${700 + i * 45}ms` }}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-100 to-cyan-100 text-xs font-bold tabular-nums text-teal-800">
                    {entry.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {entry.patient ? `${entry.patient.firstName} ${entry.patient.lastName}` : "Patient"}
                    <span className="ml-2 text-xs text-muted-foreground">{entry.department}</span>
                  </span>
                  {entry.status === "IN_SERVICE" ? (
                    <span className="relative flex h-2 w-2 text-teal-500" aria-hidden>
                      <span className="curvilo-ping relative inline-flex h-2 w-2 rounded-full" />
                    </span>
                  ) : null}
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    entry.status === "IN_SERVICE" ? "border-teal-300 bg-teal-50 text-teal-700" :
                    entry.status === "CALLED" ? "border-cyan-200 bg-cyan-50/60 text-cyan-700" :
                    "border-amber-200 bg-amber-50 text-amber-700"
                  }`}>
                    {entry.status.replaceAll("_", " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Bottom row: alerts + recent payments */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section aria-label="Operational alerts" className="curvilo-card curvilo-rise rounded-xl border bg-white" style={{ animationDelay: "720ms" }}>
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Operational alerts</h2>
          </div>
          {data.lowStock.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">All stock levels look healthy.</p>
          ) : (
            <ul className="divide-y">
              {data.lowStock.slice(0, 5).map((item, i) => (
                <li key={item.id} className="curvilo-rise flex items-center justify-between px-4 py-2.5 text-sm transition hover:bg-amber-50/40" style={{ animationDelay: `${760 + i * 45}ms` }}>
                  <span className="truncate">{item.name}</span>
                  <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                    {item.stockOnHand} left · reorder at {item.reorderLevel}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Recent payments" className="curvilo-card curvilo-rise rounded-xl border bg-white" style={{ animationDelay: "780ms" }}>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Recent payments</h2>
            <button className="flex items-center gap-1 text-xs text-teal-700 hover:underline" onClick={() => navigate("billing")}>
              <Link2 className="h-3 w-3" /> Billing
            </button>
          </div>
          {data.recentPayments.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            <ul className="divide-y">
              {data.recentPayments.map((p, i) => (
                <li key={p.id} className="curvilo-rise flex items-center justify-between px-4 py-2.5 text-sm transition hover:bg-teal-50/40" style={{ animationDelay: `${820 + i * 45}ms` }}>
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{p.number}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {p.invoice?.patient ? `${p.invoice.patient.firstName} ${p.invoice.patient.lastName}` : ""} · {formatDateTime(p.createdAt, user.timezone)}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-teal-700">{formatMoney(p.amountMinor, p.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
