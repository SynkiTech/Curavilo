"use client";

// Animated ambient background - drifting gradient blobs, aurora sweep, subtle
// grid and floating healthcare glyphs. Purely decorative (aria-hidden) and it
// respects prefers-reduced-motion (see globals.css).

import {
  Activity,
  CalendarCheck,
  ClipboardPlus,
  Dna,
  Droplets,
  Eye,
  HeartPulse,
  Hospital,
  Microscope,
  Pill,
  ScanHeart,
  ShieldPlus,
  Stethoscope,
  Syringe,
  Thermometer,
  type LucideIcon,
} from "lucide-react";

interface FloatingIcon {
  Icon: LucideIcon;
  left: string;
  top: string;
  size: number;
  opacity: number;
  duration: number; // seconds
  delay: number; // seconds
  drift: "a" | "b" | "c";
}

const ICONS: FloatingIcon[] = [
  { Icon: HeartPulse,     left: "5%",  top: "16%", size: 52, opacity: 0.16, duration: 9.5, delay: 0,   drift: "a" },
  { Icon: Stethoscope,    left: "14%", top: "68%", size: 46, opacity: 0.13, duration: 11,  delay: 0.8, drift: "b" },
  { Icon: Eye,            left: "24%", top: "34%", size: 34, opacity: 0.12, duration: 10,  delay: 1.6, drift: "c" },
  { Icon: Pill,           left: "8%",  top: "88%", size: 38, opacity: 0.14, duration: 12,  delay: 0.4, drift: "a" },
  { Icon: Activity,       left: "33%", top: "8%",  size: 40, opacity: 0.12, duration: 9,   delay: 2.2, drift: "b" },
  { Icon: ScanHeart,      left: "45%", top: "82%", size: 48, opacity: 0.11, duration: 10.5,delay: 1.2, drift: "c" },
  { Icon: Syringe,        left: "58%", top: "14%", size: 42, opacity: 0.13, duration: 11.5,delay: 0.2, drift: "a" },
  { Icon: Thermometer,    left: "68%", top: "58%", size: 36, opacity: 0.12, duration: 9.8, delay: 2.8, drift: "b" },
  { Icon: Microscope,     left: "78%", top: "26%", size: 50, opacity: 0.13, duration: 12.5,delay: 1.9, drift: "c" },
  { Icon: CalendarCheck,  left: "88%", top: "72%", size: 40, opacity: 0.12, duration: 10.2,delay: 0.6, drift: "a" },
  { Icon: ClipboardPlus,  left: "92%", top: "12%", size: 38, opacity: 0.11, duration: 11.8,delay: 2.4, drift: "b" },
  { Icon: ShieldPlus,     left: "38%", top: "48%", size: 32, opacity: 0.09, duration: 13,  delay: 3.1, drift: "c" },
  { Icon: Droplets,       left: "52%", top: "36%", size: 30, opacity: 0.10, duration: 9.2, delay: 1.4, drift: "a" },
  { Icon: Hospital,       left: "82%", top: "90%", size: 44, opacity: 0.12, duration: 12.2,delay: 0.9, drift: "b" },
  { Icon: Dna,            left: "18%", top: "50%", size: 34, opacity: 0.10, duration: 10.8,delay: 2.6, drift: "c" },
];

export function AnimatedBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      {/* Deep cool gradient base */}
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#042f2e_0%,#083344_28%,#0c4a6e_55%,#1e1b4b_82%,#312e81_100%)]" />

      {/* Drifting aurora blobs */}
      <div className="curvilo-blob-a absolute -left-48 -top-48 h-[36rem] w-[36rem] rounded-full bg-teal-400/25 blur-3xl" />
      <div className="curvilo-blob-b absolute -right-40 top-1/4 h-[32rem] w-[32rem] rounded-full bg-violet-500/25 blur-3xl" />
      <div className="curvilo-blob-c absolute -bottom-56 left-1/4 h-[34rem] w-[34rem] rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="curvilo-blob-b absolute -bottom-32 right-1/4 h-[26rem] w-[26rem] rounded-full bg-emerald-400/20 blur-3xl" />

      {/* Slow aurora light sweep */}
      <div className="curvilo-aurora absolute inset-0" />

      {/* Faint technical grid, faded at the edges */}
      <div className="curvilo-grid absolute inset-0" />

      {/* Floating healthcare glyphs */}
      {ICONS.map(({ Icon, left, top, size, opacity, duration, delay, drift }, i) => (
        <Icon
          key={i}
          className="curvilo-float absolute text-white"
          style={{
            left,
            top,
            width: size,
            height: size,
            opacity,
            animationDuration: `${duration}s`,
            animationDelay: `${delay}s`,
            ["--drift-x" as string]: drift === "a" ? "14px" : drift === "b" ? "-16px" : "8px",
            ["--drift-r" as string]: drift === "a" ? "5deg" : drift === "b" ? "-4deg" : "3deg",
          }}
          strokeWidth={1.5}
        />
      ))}

      {/* Soft vignette so foreground content stays readable */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(2,20,25,0.45)_100%)]" />
    </div>
  );
}
