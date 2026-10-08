"use client";

// Overview: role-aware dashboard (ADR 0011, spec §23/§40/§67).
// Widget layout comes from the central dashboard configuration (role + custom
// role + permissions). Within that boundary the user can personalize widget
// visibility and ordering; personalization can never create access.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Link2, UserPlus, Users, Clock3, Stethoscope, CheckCircle2, Wallet, CalendarDays,
  BellRing, PackageSearch, Activity, ArrowRight, Settings2, ArrowUp, ArrowDown, Eye, EyeOff,
  CalendarClock, ListTodo, FlaskConical, ShoppingCart, CalendarX2, ReceiptText,
  TrendingDown, CircleCheck, Landmark, CalendarOff,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { apiGet, apiSend, formatMoney, formatDateTime, type Payment, type QueueEntry } from "./api";
import { LoadingState, ErrorState, MetricCard, type Accent } from "./ui-kit";
import { useApp } from "./store";
import { TeamMessagesWidget } from "./notifications";
import { getDashboardConfig, applyPrefs, WIDGET_PERMISSION, type DashboardPrefs, type DashboardWidgetId } from "@/lib/dashboard-config";

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
  todayAppointments?: { id: string; scheduledAt: string; status: string; patient: string; mrn?: string | null; with?: string | null }[];
  myTasks?: { id: string; title: string; priority: string; status: string; role?: string | null }[];
  expiringLots?: { id: string; item: string; batchNo: string; qtyRemaining: number; expiresAt: string | null }[];
  todaySales?: { count: number; grossMinor: number; returnsMinor: number; currency: string };
  pendingResults?: { count: number; orders: { id: string; test: string; status: string; patient: string; orderedAt: string }[] };
  accountingKpis?: { currency: string; monthExpensesMinor: number; pendingExpenses: number; pendingExpensesMinor: number; outstandingMinor: number; revenueTodayMinor: number };
  hrKpis?: { headcount: number; activeStaff: number; onLeaveToday: number; pendingLeaves: number; certsExpiring: number; recentHires: { id: string; name: string; designation: string; department: string | null; active: boolean }[] };
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

const QUICK_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  UserPlus, CalendarDays, ListOrdered: Activity, ClipboardPlus: Stethoscope, ReceiptText,
  ShoppingCart, Boxes: PackageSearch, FlaskConical, BarChart3: Activity, Sparkles: BellRing,
  Landmark: Wallet, Contact: Users,
};

export function Overview() {
  const { session, navigate, setSession } = useApp();
  const user = session?.user;
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<DashboardData>("/api/dashboard"),
    refetchInterval: 30_000,
  });
  const today = useToday();

  // Personalization derives straight from the session (single source of truth);
  // saving writes to the server and mirrors into the session, which re-derives.
  const prefs: DashboardPrefs | null = useMemo(() => {
    if (!user?.dashboardPrefs) return null;
    try {
      return JSON.parse(user.dashboardPrefs) as DashboardPrefs;
    } catch {
      return null;
    }
     
  }, [user]);

  const config = useMemo(() => {
    if (!user) return null;
    const base = getDashboardConfig({
      role: user.role,
      permissions: user.permissions as never,
      serviceProfileKey: user.serviceProfileKey,
      department: user.department,
    });
    return applyPrefs(base, prefs);
  }, [user, prefs]);

  const savePrefs = async (next: DashboardPrefs) => {
    const serialized = JSON.stringify(next);
    try {
      await apiSend("POST", "/api/auth", { action: "update-prefs", dashboardPrefs: serialized });
    } catch { /* keep going - personalization is cosmetic */ }
    if (user) setSession({ ...session, user: { ...user, dashboardPrefs: serialized } } as typeof session);
  };

  if (isLoading) return <LoadingState label="Loading dashboard…" />;
  if (isError) return <ErrorState message={(error as Error)?.message ?? "Failed to load dashboard."} onRetry={() => void refetch()} />;
  if (!data || !user || !config) return null;

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
  const hasRevenueTrend = data.trends.revenueByDay.some((d) => d.minor > 0);
  const hasEncounterTrend = data.trends.encountersByDay.some((d) => d.count > 0);
  const donutData = data.trends.revenueByMethod.filter((d) => d.minor > 0);

  // Role-aware KPI cards: each department sees the numbers that matter to it.
  // Clinical/ops KPIs need patients:read; accounting and HR get their own sets.
  const kpis: { title: string; value: number | string; hint?: string; icon: React.ComponentType<{ className?: string }>; accent?: Accent; tone?: "default" | "warn"; money?: boolean }[] =
    user.permissions.includes("patients:read") ? [
      { title: "Registered today", value: s.patientsToday, hint: "new patients", icon: UserPlus, accent: "teal" },
      { title: "Waiting", value: s.waiting, tone: s.waiting > 6 ? "warn" : "default", hint: "in queue now", icon: Clock3, accent: "amber" },
      { title: "In service", value: s.inService, hint: "with clinician", icon: Stethoscope, accent: "cyan" },
      { title: "Completed today", value: s.completedToday, hint: "encounters", icon: CheckCircle2, accent: "emerald" },
      { title: "Revenue today", value: s.revenueTodayMinor, hint: "payments collected", icon: Wallet, accent: "violet", money: true },
      { title: "Appointments", value: s.appointmentsToday, hint: "scheduled today", icon: CalendarDays, accent: "indigo" },
      { title: "Overdue follow-ups", value: s.overdueFollowUps, tone: s.overdueFollowUps > 0 ? "warn" : "default", hint: "need attention", icon: BellRing, accent: "rose" },
      { title: "Low stock items", value: data.lowStock.length, tone: data.lowStock.length > 0 ? "warn" : "default", hint: "at reorder level", icon: PackageSearch, accent: "amber" },
    ]
    : user.permissions.includes("accounting:read") && data.accountingKpis ? [
      { title: "Revenue today", value: data.accountingKpis.revenueTodayMinor, hint: "payments collected", icon: Wallet, accent: "violet", money: true },
      { title: "Outstanding", value: data.accountingKpis.outstandingMinor, hint: "receivables", icon: ReceiptText, accent: "amber", money: true, tone: data.accountingKpis.outstandingMinor > 0 ? "warn" : "default" },
      { title: "Expenses this month", value: data.accountingKpis.monthExpensesMinor, hint: "booked", icon: TrendingDown, accent: "rose", money: true },
      { title: "Pending approvals", value: data.accountingKpis.pendingExpenses, hint: "expenses to review", icon: CircleCheck, accent: "teal", tone: data.accountingKpis.pendingExpenses > 0 ? "warn" : "default" },
    ]
    : user.permissions.includes("hr:read") && data.hrKpis ? [
      { title: "Headcount", value: data.hrKpis.headcount, hint: `${data.hrKpis.activeStaff} active staff`, icon: Users, accent: "teal" },
      { title: "On leave today", value: data.hrKpis.onLeaveToday, hint: "approved absence", icon: CalendarX2, accent: "amber", tone: data.hrKpis.onLeaveToday > 0 ? "warn" : "default" },
      { title: "Pending leave", value: data.hrKpis.pendingLeaves, hint: "awaiting decision", icon: CalendarClock, accent: "violet", tone: data.hrKpis.pendingLeaves > 0 ? "warn" : "default" },
      { title: "Certs expiring", value: data.hrKpis.certsExpiring, hint: "within 30 days", icon: ListTodo, accent: "rose", tone: data.hrKpis.certsExpiring > 0 ? "warn" : "default" },
    ] : [];

  // Per-widget render registry. Every widget is independently permission-gated
  // server-side too; this map renders only what the configuration allowed.
  const widgetMap: Record<DashboardWidgetId, React.ReactNode> = {
    "kpi-band": (
      <div key="kpi-band" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
    ),
    "quick-actions": (
      <section key="quick-actions" aria-label="Quick actions" className="curvilo-rise flex flex-wrap gap-2 rounded-xl border bg-white p-3" style={{ animationDelay: "300ms" }}>
        {(config.quickActions ?? []).map((a) => {
          const Icon = QUICK_ICON[a.icon] ?? Activity;
          return (
            <button
              key={a.id}
              onClick={() => navigate(a.view as never)}
              className="group flex items-center gap-1.5 rounded-full border border-teal-100 bg-teal-50/60 px-3 py-1.5 text-xs font-medium text-teal-800 transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-[0_4px_14px_rgba(13,148,136,0.15)]"
            >
              <Icon className="h-3.5 w-3.5 text-teal-600" aria-hidden />
              {a.label}
              <ArrowRight className="h-3 w-3 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden />
            </button>
          );
        })}
      </section>
    ),
    "revenue-trend": (
      <section key="revenue-trend" aria-label="Revenue trend" className={`curvilo-card curvilo-rise rounded-xl border bg-white p-4 lg:col-span-2 ${hasRevenueTrend ? "" : "hidden lg:block"}`} style={{ animationDelay: "480ms" }}>
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
    ),
    "payment-mix": (
      <section key="payment-mix" aria-label="Payment mix" className="curvilo-card curvilo-rise rounded-xl border bg-white p-4" style={{ animationDelay: "540ms" }}>
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
    ),
    "patient-volume": (
      <section key="patient-volume" aria-label="Patient volume" className="curvilo-card curvilo-rise rounded-xl border bg-white p-4" style={{ animationDelay: "600ms" }}>
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
    ),
    "live-queue": (
      <section key="live-queue" aria-label="Live queue" className="curvilo-card curvilo-rise rounded-xl border bg-white" style={{ animationDelay: "660ms" }}>
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
    ),
    "alerts-low-stock": (
      <section key="alerts-low-stock" aria-label="Operational alerts" className="curvilo-card curvilo-rise rounded-xl border bg-white" style={{ animationDelay: "720ms" }}>
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
    ),
    "recent-payments": (
      <section key="recent-payments" aria-label="Recent payments" className="curvilo-card curvilo-rise rounded-xl border bg-white" style={{ animationDelay: "780ms" }}>
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
    ),
    "today-appointments": (
      <section key="today-appointments" aria-label="Today's appointments" className="curvilo-card curvilo-rise rounded-xl border bg-white" style={{ animationDelay: "500ms" }}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><CalendarClock className="h-4 w-4 text-teal-600" aria-hidden /> Today&apos;s appointments</h2>
          <button className="flex items-center gap-1 text-xs text-teal-700 hover:underline" onClick={() => navigate("appointments")}>
            <Link2 className="h-3 w-3" /> All
          </button>
        </div>
        {(data.todayAppointments?.length ?? 0) === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No appointments scheduled for today.</p>
        ) : (
          <ul className="max-h-64 divide-y overflow-y-auto">
            {(data.todayAppointments ?? []).map((a, i) => (
              <li key={a.id} className="curvilo-rise flex items-center gap-3 px-4 py-2.5 text-sm" style={{ animationDelay: `${540 + i * 45}ms` }}>
                <span className="w-12 shrink-0 rounded bg-teal-50 px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums text-teal-800">
                  {new Date(a.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {a.patient}
                  {a.with ? <span className="ml-1.5 text-xs text-muted-foreground">· {a.with}</span> : null}
                </span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${
                  a.status === "CHECKED_IN" ? "border-teal-300 bg-teal-50 text-teal-700" :
                  a.status === "COMPLETED" ? "border-emerald-200 bg-emerald-50 text-emerald-700" :
                  a.status === "NO_SHOW" ? "border-red-200 bg-red-50 text-red-600" :
                  "border-stone-200 bg-stone-50 text-stone-600"
                }`}>
                  {a.status.replaceAll("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    ),
    "expiring-stock": (
      <section key="expiring-stock" aria-label="Expiring stock" className="curvilo-card curvilo-rise rounded-xl border bg-white" style={{ animationDelay: "700ms" }}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><CalendarX2 className="h-4 w-4 text-amber-500" aria-hidden /> Expiring within 30 days</h2>
          <button className="flex items-center gap-1 text-xs text-teal-700 hover:underline" onClick={() => navigate("inventory")}>
            <Link2 className="h-3 w-3" /> Inventory
          </button>
        </div>
        {(data.expiringLots?.length ?? 0) === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No lots expiring soon.</p>
        ) : (
          <ul className="divide-y">
            {(data.expiringLots ?? []).map((l, i) => (
              <li key={l.id} className="curvilo-rise flex items-center justify-between px-4 py-2.5 text-sm" style={{ animationDelay: `${740 + i * 45}ms` }}>
                <span className="min-w-0 truncate">
                  {l.item}
                  <span className="ml-1.5 text-xs text-muted-foreground">batch {l.batchNo}</span>
                </span>
                <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                  {l.qtyRemaining} left · {l.expiresAt ? new Date(l.expiresAt).toLocaleDateString([], { day: "numeric", month: "short" }) : "-"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    ),
    "today-sales": (
      <section key="today-sales" aria-label="Today's sales" className="curvilo-card curvilo-rise flex flex-col justify-between rounded-xl border bg-white p-4" style={{ animationDelay: "560ms" }}>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><ShoppingCart className="h-4 w-4 text-teal-600" aria-hidden /> Today&apos;s sales</h2>
          <button className="flex items-center gap-1 text-xs text-teal-700 hover:underline" onClick={() => navigate("pos")}>
            <Link2 className="h-3 w-3" /> POS
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-2xl font-bold tabular-nums text-stone-800">{data.todaySales?.count ?? 0}</p>
            <p className="text-[11px] text-muted-foreground">transactions</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-teal-700">{fullMoney(data.todaySales?.grossMinor ?? 0)}</p>
            <p className="text-[11px] text-muted-foreground">gross</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-rose-600">{fullMoney(data.todaySales?.returnsMinor ?? 0)}</p>
            <p className="text-[11px] text-muted-foreground">refunds</p>
          </div>
        </div>
      </section>
    ),
    "pending-results": (
      <section key="pending-results" aria-label="Pending results" className="curvilo-card curvilo-rise rounded-xl border bg-white" style={{ animationDelay: "560ms" }}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><FlaskConical className="h-4 w-4 text-cyan-600" aria-hidden /> Pending results</h2>
          <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-700">{data.pendingResults?.count ?? 0} open</span>
        </div>
        {(data.pendingResults?.orders?.length ?? 0) === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No diagnostics waiting on results.</p>
        ) : (
          <ul className="divide-y">
            {(data.pendingResults?.orders ?? []).map((o, i) => (
              <li key={o.id} className="curvilo-rise flex items-center justify-between px-4 py-2.5 text-sm" style={{ animationDelay: `${600 + i * 45}ms` }}>
                <span className="min-w-0 truncate">
                  {o.test}
                  <span className="ml-1.5 text-xs text-muted-foreground">{o.patient}</span>
                </span>
                <span className="shrink-0 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] text-cyan-700">
                  {o.status.replaceAll("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    ),
    "team-messages": <TeamMessagesWidget />,
    "my-tasks": (
      <section key="my-tasks" aria-label="My tasks" className="curvilo-card curvilo-rise rounded-xl border bg-white" style={{ animationDelay: "740ms" }}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><ListTodo className="h-4 w-4 text-violet-500" aria-hidden /> My tasks</h2>
        </div>
        {(data.myTasks?.length ?? 0) === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No open tasks for your role.</p>
        ) : (
          <ul className="divide-y">
            {(data.myTasks ?? []).map((t, i) => (
              <li key={t.id} className="curvilo-rise flex items-center gap-2.5 px-4 py-2.5 text-sm" style={{ animationDelay: `${780 + i * 45}ms` }}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${
                  t.priority === "URGENT" ? "bg-red-500" : t.priority === "HIGH" ? "bg-amber-500" : "bg-teal-400"
                }`} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                {t.role ? <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">{t.role}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    ),
    "expense-pipeline": (
      <section key="expense-pipeline" aria-label="Expense pipeline" className="curvilo-card curvilo-rise rounded-xl border bg-white p-4" style={{ animationDelay: "560ms" }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><TrendingDown className="h-4 w-4 text-amber-600" aria-hidden /> Expense pipeline</h2>
          <button className="flex items-center gap-1 text-xs text-teal-700 hover:underline" onClick={() => navigate("accounting")}>
            <Link2 className="h-3 w-3" /> Accounting
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg bg-stone-50 p-3">
            <p className="text-xl font-bold tabular-nums text-stone-800">{fullMoney(data.accountingKpis?.monthExpensesMinor ?? 0)}</p>
            <p className="text-[11px] text-muted-foreground">booked this month</p>
          </div>
          <div className="rounded-lg bg-amber-50/70 p-3">
            <p className="text-xl font-bold tabular-nums text-amber-700">{data.accountingKpis?.pendingExpenses ?? 0}</p>
            <p className="text-[11px] text-muted-foreground">awaiting approval</p>
          </div>
        </div>
      </section>
    ),
    "hr-requests": (
      <section key="hr-requests" aria-label="People and leave" className="curvilo-card curvilo-rise rounded-xl border bg-white p-4" style={{ animationDelay: "560ms" }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><CalendarOff className="h-4 w-4 text-teal-600" aria-hidden /> People &amp; leave</h2>
          <button className="flex items-center gap-1 text-xs text-teal-700 hover:underline" onClick={() => navigate("hr")}>
            <Link2 className="h-3 w-3" /> HR
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-2xl font-bold tabular-nums text-stone-800">{data.hrKpis?.headcount ?? 0}</p>
            <p className="text-[11px] text-muted-foreground">headcount</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-amber-600">{data.hrKpis?.pendingLeaves ?? 0}</p>
            <p className="text-[11px] text-muted-foreground">pending leave</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-stone-800">{data.hrKpis?.onLeaveToday ?? 0}</p>
            <p className="text-[11px] text-muted-foreground">on leave today</p>
          </div>
        </div>
      </section>
    ),
  };

  const heroLabel = s.profile ? s.profile.replace(/_/g, " ").toLowerCase() : "general";
  const contextChip = [user.facilityName, heroLabel, user.department].filter(Boolean).join(" · ");

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
              {contextChip} workspace · figures refresh every 30s
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="relative flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
              <span className="relative flex h-2 w-2 text-emerald-300">
                <span className="curvilo-ping relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
              </span>
              Live
            </span>
            <WidgetPrefsButton
              config={config.widgets.map((w) => w.id)}
              prefs={prefs}
              onSave={(next) => void savePrefs(next)}
            />
          </div>
        </div>
      </section>

      {/* Config-driven widget grid: role layout + permission gates + personalization */}
      <WidgetGrid widgets={config.widgets} map={widgetMap} />
    </div>
  );
}

/**
 * Renders widgets in configured order, one pass. Wide widgets span the full
 * width; consecutive standard widgets pair up two-per-row. KPI band and quick
 * actions are full-width by nature.
 */
function WidgetGrid({
  widgets,
  map,
}: {
  widgets: { id: DashboardWidgetId; span?: "wide" | "half" }[];
  map: Record<DashboardWidgetId, React.ReactNode>;
}) {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < widgets.length) {
    const w = widgets[i];
    const node = map[w.id];
    if (!node) {
      i += 1;
      continue;
    }
    if (w.span === "wide") {
      nodes.push(<div key={w.id} className="grid gap-4 lg:grid-cols-3">{node}</div>);
      i += 1;
      continue;
    }
    if (w.id === "kpi-band" || w.id === "quick-actions") {
      nodes.push(<div key={w.id}>{node}</div>);
      i += 1;
      continue;
    }
    // Standard widget: pair with the next standard widget when possible.
    const next = widgets[i + 1];
    const nextNode = next ? map[next.id] : null;
    if (next && next.span !== "wide" && nextNode &&
        next.id !== "kpi-band" && next.id !== "quick-actions") {
      nodes.push(
        <div key={`${w.id}+${next.id}`} className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          {node}
          {nextNode}
        </div>
      );
      i += 2;
    } else {
      nodes.push(
        <div key={w.id} className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          {node}
        </div>
      );
      i += 1;
    }
  }
  return <div className="space-y-4">{nodes}</div>;
}

// ─── Personalization popover (spec §40) ─────────────────────────────────────

function WidgetPrefsButton({
  config,
  prefs,
  onSave,
}: {
  config: DashboardWidgetId[];
  prefs: DashboardPrefs | null;
  onSave: (p: DashboardPrefs) => void;
}) {
  const [open, setOpen] = useState(false);
  const hidden = new Set(prefs?.hidden ?? []);
  const order = prefs?.order ?? [];

  const labels: Record<DashboardWidgetId, string> = {
    "kpi-band": "KPI cards",
    "quick-actions": "Quick actions",
    "today-appointments": "Today's appointments",
    "live-queue": "Live queue",
    "revenue-trend": "Revenue trend",
    "payment-mix": "Payment mix",
    "patient-volume": "Patient volume",
    "recent-payments": "Recent payments",
    "alerts-low-stock": "Low stock alerts",
    "expiring-stock": "Expiring stock",
    "today-sales": "Today's sales",
    "pending-results": "Pending results",
    "my-tasks": "My tasks",
    "team-messages": "Team messages",
    "expense-pipeline": "Expense pipeline",
    "hr-requests": "People & leave",
  };

  const orderKey = order.join(",");
  const orderedWidgets = useMemo(() => {
    const ord = orderKey ? orderKey.split(",") : [];
    return [...config].sort((a, b) => {
      const ia = ord.indexOf(a);
      const ib = ord.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  }, [config, orderKey]);

  const commit = (nextHidden: Set<string>, nextOrder: string[]) =>
    onSave({ hidden: [...nextHidden], order: nextOrder });

  const move = (id: DashboardWidgetId, dir: -1 | 1) => {
    const arr = orderedWidgets.slice();
    const i = arr.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    commit(hidden, arr);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-white/25"
          aria-label="Personalize dashboard"
        >
          <Settings2 className="h-3.5 w-3.5" aria-hidden /> Personalize
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="text-sm font-semibold">Personalize dashboard</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Show, hide or reorder widgets. Only widgets your role permits are listed.
        </p>
        <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
          {orderedWidgets.map((id) => (
            <li key={id} className="flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-sm">
              <span className="flex-1 truncate">{labels[id]}</span>
              <button
                className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
                aria-label={hidden.has(id) ? `Show ${labels[id]}` : `Hide ${labels[id]}`}
                onClick={() => {
                  const next = new Set(hidden);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  commit(next, orderedWidgets);
                }}
              >
                {hidden.has(id) ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
              </button>
              <button className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600" aria-label={`Move ${labels[id]} up`} onClick={() => move(id, -1)}>
                <ArrowUp className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600" aria-label={`Move ${labels[id]} down`} onClick={() => move(id, 1)}>
                <ArrowDown className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full text-muted-foreground"
          onClick={() => onSave({ hidden: [], order: [] })}
        >
          Reset to role default
        </Button>
      </PopoverContent>
    </Popover>
  );
}
