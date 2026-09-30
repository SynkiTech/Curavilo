"use client";

// Shared UI primitives: states, cards, badges, small dialogs
import { ReactNode } from "react";
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
