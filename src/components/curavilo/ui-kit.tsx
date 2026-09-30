"use client";

// Shared UI primitives: states, cards, badges, small dialogs
import { ReactNode, useEffect, useState } from "react";
import { Loader2, AlertCircle, Inbox, ShieldX, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground" role="status" aria-live="polite">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <Inbox className="h-10 w-10 text-muted-foreground/40" aria-hidden />
      <p className="font-medium">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center" role="alert">
      <AlertCircle className="h-10 w-10 text-destructive/70" aria-hidden />
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" /> Try again
        </Button>
      ) : null}
    </div>
  );
}

export function PermissionDenied({ what = "this section" }: { what?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <ShieldX className="h-10 w-10 text-muted-foreground/40" aria-hidden />
      <p className="font-medium">Permission denied</p>
      <p className="text-sm text-muted-foreground">Your role does not grant access to {what}.</p>
    </div>
  );
}

export function StatCard({ title, value, hint, tone }: { title: string; value: string | number; hint?: string; tone?: "default" | "warn" }) {
  return (
    <Card className={tone === "warn" ? "border-amber-300/60" : undefined}>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

/* ─── Animated metric card (dashboard grade) ─────────────────────────────── */

export type Accent = "teal" | "cyan" | "violet" | "amber" | "rose" | "emerald" | "indigo";

const ACCENT_CHIP: Record<Accent, string> = {
  teal: "from-teal-500 to-emerald-400",
  cyan: "from-cyan-500 to-sky-400",
  violet: "from-violet-500 to-fuchsia-400",
  amber: "from-amber-500 to-orange-400",
  rose: "from-rose-500 to-pink-400",
  emerald: "from-emerald-500 to-teal-400",
  indigo: "from-indigo-500 to-blue-400",
};

const ACCENT_TEXT: Record<Accent, string> = {
  teal: "text-teal-600",
  cyan: "text-cyan-600",
  violet: "text-violet-600",
  amber: "text-amber-600",
  rose: "text-rose-600",
  emerald: "text-emerald-600",
  indigo: "text-indigo-600",
};

/** requestAnimationFrame count-up with ease-out cubic; respects reduced motion via instant value. */
export function useCountUp(target: number, duration = 950): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      if (reduced) {
        setValue(target);
        return;
      }
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased * 100) / 100);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setValue(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

export function AnimatedNumber({ value, format }: { value: number; format?: (n: number) => string }) {
  const v = useCountUp(value);
  return <span className="tabular-nums">{format ? format(v) : Math.round(v).toLocaleString()}</span>;
}

export function MetricCard({
  title,
  value,
  hint,
  icon: Icon,
  accent = "teal",
  tone = "default",
  delay = 0,
  formatValue,
}: {
  title: string;
  value: string | number;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  accent?: Accent;
  tone?: "default" | "warn";
  delay?: number;
  formatValue?: (n: number) => string;
}) {
  const numeric = typeof value === "number";
  return (
    <Card
      className={`curvilo-card curvilo-rise relative overflow-hidden ${tone === "warn" ? "border-amber-300/70 bg-amber-50/40" : ""}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${ACCENT_CHIP[accent]}`} />
      <CardHeader className="flex-row items-center gap-2 pb-1">
        {Icon ? (
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${ACCENT_CHIP[accent]} text-white shadow-sm`}>
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </span>
        ) : null}
        <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className={`text-2xl font-bold tracking-tight ${tone === "warn" ? "text-amber-700" : ACCENT_TEXT[accent]}`}>
          {numeric ? <AnimatedNumber value={value as number} format={formatValue} /> : value}
        </div>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

const STATUS_TONES: Record<string, string> = {
  SCHEDULED: "bg-stone-100 text-stone-700 border-stone-200",
  CHECKED_IN: "bg-teal-50 text-teal-700 border-teal-200",
  WAITING: "bg-amber-50 text-amber-700 border-amber-200",
  CALLED: "bg-teal-50 text-teal-700 border-teal-200",
  IN_SERVICE: "bg-teal-100 text-teal-800 border-teal-300",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-stone-100 text-stone-500 border-stone-200",
  NO_SHOW: "bg-red-50 text-red-700 border-red-200",
  SKIPPED: "bg-stone-100 text-stone-500 border-stone-200",
  ISSUED: "bg-amber-50 text-amber-700 border-amber-200",
  PARTIALLY_PAID: "bg-amber-50 text-amber-700 border-amber-200",
  PAID: "bg-emerald-50 text-emerald-700 border-emerald-200",
  VOID: "bg-red-50 text-red-700 border-red-200",
  DRAFT: "bg-stone-100 text-stone-600 border-stone-200",
  OPEN: "bg-teal-50 text-teal-700 border-teal-200",
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  RUNNING: "bg-teal-50 text-teal-700 border-teal-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
  PUBLISHED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ARCHIVED: "bg-stone-100 text-stone-500 border-stone-200",
  DRAFT_WF: "bg-stone-100 text-stone-600 border-stone-200",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONES[status] ?? "bg-stone-100 text-stone-700 border-stone-200";
  return <Badge variant="outline" className={`${tone} whitespace-nowrap`}>{status.replaceAll("_", " ")}</Badge>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
