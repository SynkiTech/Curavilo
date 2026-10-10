"use client";

// Curavilo Motion System (spec §11, §12, §81, §120).
// Central motion tokens + reusable animation primitives built on framer-motion.
// Every primitive respects prefers-reduced-motion and cleans up after itself.
// Durations: instant < fast < normal < slow (seconds, framer convention).
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, type Transition, type Variants } from "framer-motion";
import { Check, Loader2, AlertCircle, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Motion tokens (spec §81) ───────────────────────────────────────────────

export const MOTION = {
  duration: {
    instant: 0.1,
    fast: 0.18,
    normal: 0.26,
    slow: 0.4,
  },
  ease: {
    standard: [0.22, 1, 0.36, 1] as const,
    enter: [0.16, 1, 0.3, 1] as const,
    exit: [0.4, 0, 1, 1] as const,
  },
  spring: { type: "spring", stiffness: 380, damping: 30 } as Transition,
};

export const EASE_STANDARD = [0.22, 1, 0.36, 1] as const;

/** Resolve a token-based transition, collapsing to near-instant under reduced motion. */
export function tokenTransition(
  kind: keyof typeof MOTION.duration = "normal",
  reduced: boolean
): Transition {
  return {
    duration: reduced ? MOTION.duration.instant : MOTION.duration[kind],
    ease: reduced ? "linear" : EASE_STANDARD,
  };
}

// ─── Page transition (spec §13) ─────────────────────────────────────────────

/** Wraps a routed screen; remount-keyed enter animation. No exit delay: navigation must feel fast. */
export function PageTransition({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: reduced ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={tokenTransition("normal", !!reduced)}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── Section reveal on scroll (spec §38, §120) ──────────────────────────────

/** Fades/rises content into view the first time it enters the viewport. */
export function SectionReveal({
  children,
  className,
  delay = 0,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li";
}) {
  const reduced = useReducedMotion();
  const Comp = as === "section" ? motion.section : as === "li" ? motion.li : motion.div;
  return (
    <Comp
      initial={{ opacity: 0, y: reduced ? 0 : 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-32px" }}
      transition={{ ...tokenTransition("slow", !!reduced), delay: reduced ? 0 : delay }}
      className={className}
    >
      {children}
    </Comp>
  );
}

// ─── Stagger orchestration (spec §14, §120) ─────────────────────────────────

const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } },
};

const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: MOTION.duration.normal, ease: EASE_STANDARD } },
};

/** Parent that staggers its StaggerItem children once on mount. */
export function Stagger({ children, className, reduced }: { children: React.ReactNode; className?: string; reduced?: boolean }) {
  const prefersReduced = useReducedMotion();
  const isReduced = reduced ?? !!prefersReduced;
  return (
    <motion.div
      variants={isReduced ? undefined : staggerContainer}
      initial={isReduced ? undefined : "hidden"}
      animate={isReduced ? undefined : "show"}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div variants={staggerItem} className={className}>
      {children}
    </motion.div>
  );
}

// ─── Action button: idle -> loading -> success -> idle (spec §15) ───────────

type ActionState = "idle" | "loading" | "success";

/**
 * Button that runs an async action and morphs through loading and success
 * states while preserving its dimensions (spec §15). Returns to idle gracefully.
 */
export function ActionButton({
  action,
  idleLabel,
  loadingLabel = "Working…",
  successLabel = "Done",
  onDone,
  className,
  variant = "default",
  size,
  disabled,
  type,
}: {
  action: () => Promise<void>;
  idleLabel: React.ReactNode;
  loadingLabel?: string;
  successLabel?: string;
  /** Called after the success flash, e.g. to close a dialog or navigate. */
  onDone?: () => void;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const [state, setState] = useState<ActionState>("idle");
  const reduced = useReducedMotion();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const run = async () => {
    if (state !== "idle") return; // prevent duplicate clicks (spec §15)
    setState("loading");
    try {
      await action();
      setState("success");
      timers.current.push(
        setTimeout(() => {
          setState("idle");
          onDone?.();
        }, reduced ? 250 : 1150)
      );
    } catch {
      setState("idle"); // error toasts are surfaced by callers via sonner
    }
  };

  return (
    <Button
      type={type ?? "button"}
      variant={variant}
      size={size}
      disabled={disabled || state !== "idle"}
      onClick={() => void run()}
      className={cn("relative transition-shadow", state === "success" && "border-emerald-300 bg-emerald-600 hover:bg-emerald-600", className)}
      asChild={false}
    >
      {state === "idle" ? (
        <motion.span
          className="flex items-center gap-1.5"
          whileHover={reduced ? undefined : { scale: 1.01 }}
        >
          {idleLabel}
        </motion.span>
      ) : state === "loading" ? (
        <span className="flex items-center gap-1.5">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {loadingLabel}
        </span>
      ) : (
        <motion.span
          key="success"
          className="flex items-center gap-1.5"
          initial={reduced ? undefined : { scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={reduced ? { duration: 0 } : MOTION.spring}
        >
          <Check className="h-4 w-4" aria-hidden />
          {successLabel}
        </motion.span>
      )}
    </Button>
  );
}

// ─── Activity indicator: idle / processing / success / error (spec §63) ─────

export type ActivityState = "idle" | "processing" | "success" | "error";

export function ActivityIndicator({
  state,
  label,
  className,
}: {
  state: ActivityState;
  label?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", className)} role="status">
      {state === "idle" ? (
        <span className="h-2 w-2 rounded-full bg-stone-300" aria-hidden />
      ) : state === "processing" ? (
        <Loader2 className={cn("h-3.5 w-3.5 animate-spin text-teal-600", reduced && "animate-none")} aria-hidden />
      ) : state === "success" ? (
        <motion.span
          initial={reduced ? undefined : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={reduced ? { duration: 0 } : MOTION.spring}
          className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
          aria-hidden
        >
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        </motion.span>
      ) : (
        <motion.span
          animate={reduced ? undefined : { x: [0, -2.5, 2.5, -1.5, 0] }}
          transition={{ duration: 0.34, times: [0, 0.3, 0.55, 0.8, 1] }}
          className="flex text-rose-600"
          aria-hidden
        >
          <AlertCircle className="h-3.5 w-3.5" />
        </motion.span>
      )}
      {label ? <span className="text-muted-foreground">{label}</span> : null}
    </span>
  );
}

// ─── Patient flow strip (spec §22, §61) ─────────────────────────────────────

export interface FlowStage {
  label: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  /** e.g. queue wait hint or "completed" tone */
  hint?: string;
  tone?: "default" | "warn";
}

/**
 * Signature Curavilo visualization: an operational patient flow
 * (Registration -> Waiting -> Consultation -> Completion) with animated
 * connector lines and a bottleneck highlight. Analytical, not game-like.
 */
export function FlowStrip({ stages, className }: { stages: FlowStage[]; className?: string }) {
  const reduced = useReducedMotion();
  const max = Math.max(0, ...stages.map((s) => s.count));
  const bottleneckKey = stages.findIndex((s) => s.count === max && s.count > 0 && s.tone !== "warn" && max > 0);
  // Prefer an explicit warn stage (e.g. waiting) as bottleneck when it holds the peak.
  const warnPeak = stages.findIndex((s) => s.tone === "warn" && s.count === max && max > 0);
  const bottleneck = warnPeak >= 0 ? warnPeak : bottleneckKey;

  return (
    <div className={cn("flex items-stretch gap-0 overflow-x-auto pb-1", className)}>
      {stages.map((stage, i) => {
        const Icon = stage.icon;
        const isBottleneck = i === bottleneck;
        const isLast = i === stages.length - 1;
        return (
          <div key={stage.label} className="flex min-w-0 flex-1 items-center">
            <motion.div
              className={cn(
                "group relative flex min-w-[96px] flex-1 flex-col items-center gap-1 rounded-xl border px-3 py-3 text-center transition-colors",
                isBottleneck
                  ? "border-amber-300 bg-amber-50/70"
                  : stage.tone === "warn"
                    ? "border-amber-200 bg-amber-50/40"
                    : "border-stone-200 bg-white"
              )}
              initial={reduced ? undefined : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...tokenTransition("normal", !!reduced), delay: reduced ? 0 : i * 0.07 }}
            >
              {isBottleneck ? (
                <span className="absolute right-1.5 top-1.5 rounded-full bg-amber-400 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-amber-950">
                  Busiest
                </span>
              ) : null}
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-white shadow-sm",
                  isBottleneck || stage.tone === "warn"
                    ? "bg-gradient-to-br from-amber-500 to-orange-400"
                    : "bg-gradient-to-br from-teal-500 to-cyan-600"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="text-lg font-bold leading-none tabular-nums text-stone-800">{stage.count.toLocaleString()}</span>
              <span className="text-[11px] font-medium text-stone-500">{stage.label}</span>
              {stage.hint ? <span className="text-[10px] text-stone-400">{stage.hint}</span> : null}
            </motion.div>
            {!isLast ? (
              <svg
                width="26"
                height="12"
                viewBox="0 0 26 12"
                className="mx-0.5 shrink-0 self-center text-teal-400"
                aria-hidden
              >
                <line
                  x1="1"
                  y1="6"
                  x2="19"
                  y2="6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className={reduced ? undefined : "curvilo-flow-line"}
                />
                <path d="M19 2 L25 6 L19 10 Z" fill="currentColor" />
              </svg>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ─── Skeleton with directional movement (spec §45) ──────────────────────────

export function LoadingSkeleton({ className }: { className?: string }) {
  return <div className={cn("curvilo-skeleton rounded-md bg-stone-100", className)} aria-hidden />;
}

/** Block-level skeleton layout approximating a dashboard grid (spec §45). */
export function DashboardSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading content">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <LoadingSkeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <LoadingSkeleton className="h-64 lg:col-span-2" />
        <LoadingSkeleton className="h-64" />
      </div>
    </div>
  );
}

// ─── Scroll cue (spec §120) ─────────────────────────────────────────────────

/** Gentle downward nudge indicating more content below; disappears after first scroll. */
export function ScrollCue({ targetRef }: { targetRef: React.RefObject<HTMLElement | null> }) {
  const [gone, setGone] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollTop > 24) setGone(true);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [targetRef]);
  if (gone) return null;
  return (
    <motion.div
      className="pointer-events-none flex justify-center py-1 text-stone-400"
      animate={reduced ? undefined : { y: [0, 4, 0] }}
      transition={reduced ? undefined : { duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      aria-hidden
    >
      <ArrowDown className="h-4 w-4" />
    </motion.div>
  );
}
