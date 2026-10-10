# Curavilo Component Guidelines

How to build and evolve Curavilo UI components consistently (spec §82, §84, §110, §111).

## 1. Where components live

| Location | Contents |
|----------|----------|
| `src/components/ui/*` | shadcn/Radix base primitives. Do not restyle ad hoc; compose. |
| `src/components/curavilo/ui-kit.tsx` | Shared Curavilo widgets: `MetricCard`, `AnimatedNumber`, `useCountUp`, `StatusBadge`, `PageHeader`, `LoadingState`, `EmptyState`, `ErrorState`, `PermissionDenied`, `StatCard` |
| `src/components/curavilo/motion.tsx` | Motion primitives: `PageTransition`, `SectionReveal`, `Stagger`, `ActionButton`, `ActivityIndicator`, `FlowStrip`, `LoadingSkeleton`, `DashboardSkeleton`, `ScrollCue`, `MOTION` tokens |
| `src/components/curavilo/<view>.tsx` | View-level composition only. Business logic stays in modules/API routes. |

## 2. Rules

1. **Reuse before creating.** If `MetricCard`, `StatusBadge`, or a state component fits, use it. Check ui-kit and motion.tsx first (§129).
2. **Authorization is never decided client-side.** Widgets render what the server config sends; the client renders and re-checks nothing (rbac.ts contract).
3. **Typed props, no any.** Public component props get explicit interfaces.
4. **No thousand-line components.** Split widgets into focused functions within the view file, or promote to ui-kit when reused.
5. **Consistent states.** Every data-bound surface implements: loading (skeleton or labeled indicator), empty (`EmptyState`), error (`ErrorState` with retry), permission denied (`PermissionDenied`). Real data states, not just beautiful demo data (§127).
6. **Cleanup.** Timers, rAF, observers, listeners removed on unmount (§122).
7. **Accessibility is not optional.** Semantic landmarks, `aria-current` on nav, `role="status"` on async regions, visible focus rings, keyboard-operable everything (§67). Every interaction must work without animation.
8. **Em dashes are forbidden** in all user-facing copy and code strings. Use commas, colons, periods or parentheses.

## 3. Composition patterns

### Dashboard widget

```tsx
<WidgetCard label="Revenue trend" title="Revenue trend" badge="14d" action={<Link .../>}>
  <ResponsiveContainer ...>...</ResponsiveContainer>
</WidgetCard>
```

Entrance delays are a pure function of server widget order; never mutate state at render time.

### Async primary action

```tsx
<ActionButton action={save} idleLabel="Save Workflow" loadingLabel="Saving…"
  successLabel="Workflow Saved" onDone={close} />
```

### Status display

```tsx
<StatusBadge status={entry.status} />  // never hand-roll status colors
```

### Loading a page structure

```tsx
if (isLoading) return <DashboardSkeleton />;
```

## 4. Variant inventory (target state)

AnimatedButton (as ActionButton), StatusBadge, KPIValue (MetricCard + AnimatedNumber), MetricCard, PageTransition, SectionReveal, AnimatedTableRow (via `.curvilo-rise` rows), LoadingSkeleton, EmptyState, ErrorState, CommandPalette (shell Ctrl K), AIAssistant (ai-chat), DataSourcePanel (ai-chat sources), AnimatedChart (recharts + SectionReveal), WorkflowNode/Edge (workflow-builder), PrintPreview/ReceiptPreview (print.tsx).

Create new shared variants only when at least two views need them.

## 5. Forbidden

- Inconsistent buttons/inputs/badges/dialogs (§84)
- Random spacing or one-off animation durations
- Tooltips exposing restricted data (§115)
- Hidden-but-present sensitive fields: permission gating removes content, it does not merely `visibility: hidden` it
- New animation libraries; framer-motion + CSS covers everything (§11, §129)
