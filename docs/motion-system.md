# Curavilo Motion System

Motion exists to communicate: entering, leaving, loading, success, failure, progress, hierarchy, focus, relationships, system activity. Motion that does not earn its place is removed (spec §12, §109).

## 1. Tokens

Defined once, used everywhere. Never hard-code durations.

### CSS (`src/app/globals.css`)

```css
--motion-instant: 100ms;   /* state flips, focus */
--motion-fast: 180ms;      /* micro-interactions: hover, press */
--motion-normal: 260ms;    /* content transitions, page enter */
--motion-slow: 400ms;      /* section reveals, orchestrated entrances */

--ease-standard: cubic-bezier(0.22, 1, 0.36, 1);  /* default */
--ease-enter:    cubic-bezier(0.16, 1, 0.3, 1);
--ease-exit:     cubic-bezier(0.4, 0, 1, 1);
```

### TypeScript (`src/components/curavilo/motion.tsx`)

```ts
MOTION.duration.instant | fast | normal | slow
MOTION.ease.standard | enter | exit
MOTION.spring                         // stiffness 380, damping 30
tokenTransition("normal", reduced)    // collapses to ~instant under reduced motion
```

## 2. Primitives (framer-motion v12)

| Primitive | Purpose | Notes |
|-----------|---------|-------|
| `PageTransition` | Routed screen enter | 260ms fade + 10px rise; no exit animation, navigation must feel fast |
| `SectionReveal` | Viewport-entry reveal for below-fold content | IntersectionObserver via `whileInView`, fires once |
| `Stagger` / `StaggerItem` | Orchestrated entrance (dashboard §14) | 55ms stagger, total perceived delay kept tiny |
| `ActionButton` | Async CTA morph: idle -> loading -> success -> idle | Preserves dimensions, blocks double clicks (§15) |
| `ActivityIndicator` | idle / processing / success / error states (§63) | Success = spring check; error = controlled shake |
| `FlowStrip` | Signature patient-flow visualization (§61, §22) | Animated dashed connectors, bottleneck ("Busiest") highlight |
| `LoadingSkeleton` / `DashboardSkeleton` | Directional shimmer skeletons (§45) | Movement, not bright full-page sparkle |
| `ScrollCue` | Gentle nudge when more content is below | Disappears after first scroll |

## 3. CSS keyframe classes

| Class | Effect |
|-------|--------|
| `.curvilo-rise` | Staggered entrance: fade + rise, cubic-bezier(0.22,1,0.36,1) |
| `.curvilo-card` | Hover lift + teal border glow |
| `.curvilo-flow-line` | Animated dashed SVG connector (flow, workflow edges) |
| `.curvilo-skeleton` | Directional shimmer for skeleton blocks |
| `.curvilo-ping` | Live/presence pulse ring |
| `.curvilo-hero`, `.curvilo-aurora`, `.curvilo-blob-*`, `.curvilo-float` | Environmental accents on landing/auth surfaces only |
| `.curvilo-spin-slow` | Brand mark conic glow rotation |

## 4. Timing rules

- Micro-interactions: 150-250ms. Content transitions: 200-400ms. Longer only for special moments (onboarding finish).
- Never intentionally slow the application to show animation (§14). Entrance staggers must stay under ~800ms total.
- GPU-friendly properties only: `transform`, `opacity`, SVG `stroke-dashoffset`. Never animate `width`/`height`/`top`/`left` where transforms suffice. The one exception is the sidebar collapse, a discrete user-initiated action.

## 5. Reduced motion (§66) and performance (§65)

- Every primitive checks `useReducedMotion()` and collapses to instant/near-instant.
- All CSS animation classes are disabled under `prefers-reduced-motion: reduce` in globals.css.
- Status remains fully communicated without motion (color + icon + text).
- `requestAnimationFrame` count-ups cancel their frames on unmount; `ActionButton` clears its timers; observers/listeners are always removed. No leaks (§122).
- Isolate animated components so a moving element never re-renders the dashboard tree (§123).

## 6. Do / Don't

**Do**: animate patient arrival, queue updates, result availability, workflow execution, chart viewport entry, success confirmations.

**Don't**: bounce whole dashboards, animate every trivial number, run continuous background loops in operational screens, fake AI "thinking" theatrics, or add confetti (except a rare major milestone).
