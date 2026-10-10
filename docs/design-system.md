# Curavilo Design System

The visual foundation of the Curavilo healthcare operating platform. The goal: a product that feels intelligent, calm and premium, never a generic hospital admin template.

## 1. Design personality

Intelligent, not futuristic. Premium, not flashy. Calm, not sterile. Detailed, not cluttered.

## 2. Color

### Foundation

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--background` | white / oklch(1 0 0) | oklch(0.145 0 0) | App canvas |
| `--card` | white | oklch(0.205 0 0) | Primary surfaces |
| `--primary` | deep graphite | light | Base actions |
| `--destructive` | oklch(0.577 0.245 27) | oklch(0.704 0.191 22) | Errors only |

### Brand accents (defined, not accidental)

- **Teal `#0d9488` / cyan `#06b6d4`**: the Curavilo identity. Sidebar gradients (`#042f2b -> #073f3c -> #0b3550`), primary CTAs, active states.
- **Amber `#f59e0b`**: warnings, bottleneck cues, expiring stock. Restrained.
- **Rose `#f43f5e` / red**: failures and overdue only. Never decorative.
- **Violet / indigo**: chart series and AI-adjacent accents, sparingly.

### Surface hierarchy (spec §70)

```
App background (light tonal wash: stone-50 -> teal-50/40 -> cyan-50/30)
  -> Navigation (dark gradient sidebar: unmistakable color distinction)
  -> Primary surface (white cards on tonal canvas)
  -> Secondary surface (stone-50 wells, table headers)
  -> Interactive card (hover lift + teal border glow via .curvilo-card)
  -> Modal (white, larger radius, backdrop blur)
```

The dark sidebar against the light workspace is a deliberate brand signature, not a theme accident.

### Forbidden

Purple-blue SaaS gradients everywhere, neon green, cyberpunk palettes, glassmorphism on everything, rainbow dashboards. Gradients exist as rare environmental accents (login backdrop, greeting band).

## 3. Typography

- **Sans**: Geist (`--font-geist-sans`) for all UI text.
- **Mono**: Geist Mono for MRNs, session IDs, kbd hints.
- **Numerals**: always `tabular-nums` in metrics, tables, timers (see `MetricCard`, `FlowStrip`).

Scale: page title `text-xl font-semibold tracking-tight` / section `text-sm font-semibold` / card title `text-[11px] font-semibold uppercase tracking-wider text-muted-foreground` / body `text-sm` / metadata `text-xs text-muted-foreground` / tiny `text-[10px]`.

## 4. Spacing

Structured Tailwind scale only. Cards `p-4`, widget internals `px-4 py-2.5` rows, grids `gap-3`/`gap-4`, sections `mt-4`/`mt-6`. Dense where data matters (tables, queues), spacious where decisions matter (KPI bands, empty states).

## 5. Radius hierarchy (spec §8)

| Element | Radius |
|---------|--------|
| Small controls (badges, chips) | `rounded-full` only when semantic |
| Buttons/inputs | `--radius-md` (0.5rem) |
| Cards | `rounded-xl` (0.75rem) |
| Dialogs | `rounded-xl` + larger padding |
| Brand mark | `rounded-lg` with conic glow ring |

Never "everything is a pill".

## 6. Depth and shadow

Subtle borders first (`border-stone-200`, `border-teal-900/10`), soft shadows second. Interactive cards elevate via `.curvilo-card:hover` (translateY(-3px) + teal-tinted shadow). No heavy drop shadows, no floating-everything, backdrop blur reserved for overlays, the sticky header, and modal scrims (spec §96).

## 7. Status semantics (spec §62)

`StatusBadge` (ui-kit.tsx) is the single source of status styling:

| Meaning | Examples | Treatment |
|---------|----------|-----------|
| Neutral | SCHEDULED, DRAFT, CANCELLED, ARCHIVED | stone |
| Active | WAITING, PENDING, ISSUED, PARTIALLY_PAID | amber |
| Positive | COMPLETED, PAID, PUBLISHED, IN_SERVICE | teal/emerald |
| Critical | FAILED, VOID, NO_SHOW | red |

Status is never communicated by color alone: badges carry the label text, icons accompany warnings, and motion adds meaning (pulse for live, shake for error).

## 8. Iconography

Lucide only, `h-4 w-4` inside controls, `h-3.5 w-3.5` in dense rows. Icons are meaningful, not decorative. Animated states are reserved for: live indicators (ping), processing (spinner), success (check spring), error (shake). No robot faces, glowing brains, stethoscope backgrounds, or DNA helixes anywhere (spec §97, §98).

## 9. Components

Canonical list with behavior contracts lives in `docs/component-guidelines.md`.

## 10. Tokens in code

- CSS: `:root` motion/easing vars in `src/app/globals.css` (`--motion-*`, `--ease-*`).
- TS: `MOTION` tokens and primitives in `src/components/curavilo/motion.tsx`.
- Shared UI: `src/components/curavilo/ui-kit.tsx` (MetricCard, StatusBadge, states).
- Do not hard-code durations or easings in components; import tokens.
