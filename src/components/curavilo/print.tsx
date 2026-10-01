"use client";

// Central print engine (ADR 0004): document data + facility branding + print profile
// → renderer → browser print. Reprint keeps the original transaction.
//
// Versatile paper model: named presets (A3…A6, Letter, Legal, Tabloid, Executive,
// thermal 58/80/112 mm) plus a fully custom sheet (width x height in mm or inch),
// portrait/landscape, margin control and text scale. Settings persist locally so
// the same choice is reused across receipts, invoices and POS sales.

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Printer, RotateCcw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type PrintProfileKey =
  | "A3" | "A4_STANDARD" | "A5_STANDARD" | "A6"
  | "LETTER_STANDARD" | "LEGAL" | "TABLOID" | "EXECUTIVE"
  | "THERMAL_58MM" | "THERMAL_80MM" | "THERMAL_112MM"
  | "CUSTOM";

export interface PrintProfile {
  key: PrintProfileKey;
  label: string;
  widthMm: number;
  heightMm: number | null; // null = continuous feed (thermal), height auto
  mono: boolean;
}

export const PRINT_PROFILES: Record<Exclude<PrintProfileKey, "CUSTOM">, PrintProfile> = {
  A3: { key: "A3", label: "A3 (297 x 420 mm)", widthMm: 297, heightMm: 420, mono: false },
  A4_STANDARD: { key: "A4_STANDARD", label: "A4 (210 x 297 mm)", widthMm: 210, heightMm: 297, mono: false },
  A5_STANDARD: { key: "A5_STANDARD", label: "A5 (148 x 210 mm)", widthMm: 148, heightMm: 210, mono: false },
  A6: { key: "A6", label: "A6 (105 x 148 mm)", widthMm: 105, heightMm: 148, mono: false },
  LETTER_STANDARD: { key: "LETTER_STANDARD", label: "Letter (8.5 x 11 in)", widthMm: 215.9, heightMm: 279.4, mono: false },
  LEGAL: { key: "LEGAL", label: "Legal (8.5 x 14 in)", widthMm: 215.9, heightMm: 355.6, mono: false },
  TABLOID: { key: "TABLOID", label: "Tabloid (11 x 17 in)", widthMm: 279.4, heightMm: 431.8, mono: false },
  EXECUTIVE: { key: "EXECUTIVE", label: "Executive (7.25 x 10.5 in)", widthMm: 184.15, heightMm: 266.7, mono: false },
  THERMAL_58MM: { key: "THERMAL_58MM", label: "Thermal 58 mm (roll)", widthMm: 58, heightMm: null, mono: true },
  THERMAL_80MM: { key: "THERMAL_80MM", label: "Thermal 80 mm (roll)", widthMm: 80, heightMm: null, mono: true },
  THERMAL_112MM: { key: "THERMAL_112MM", label: "Thermal 112 mm (roll)", widthMm: 112, heightMm: null, mono: true },
};

export interface Branding {
  orgName: string;
  facilityName: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logoData?: string | null;
  reportFooter?: string | null;
  receiptFooter?: string | null;
  timezone: string;
  currency: string;
}

export interface DocLine {
  name: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}

export interface ReceiptDocData {
  kind: "RECEIPT" | "SALE_RECEIPT" | "INVOICE" | "CREDIT_NOTE";
  number: string;
  issuedTo: string;
  dateTime: string;
  cashier: string;
  lines: DocLine[];
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  amountPaidMinor?: number;
  method?: string;
  reference?: string | null;
  reprint?: boolean;
  status?: string;
}

type Orientation = "portrait" | "landscape";
type Unit = "mm" | "in";

interface PrintSettings {
  profileKey: PrintProfileKey;
  orientation: Orientation;
  customWidthMm: number;
  customHeightMm: number;
  customUnit: Unit;
  marginMm: number;
  scalePct: number; // 80..140
}

const DEFAULTS: PrintSettings = {
  profileKey: "THERMAL_80MM",
  orientation: "portrait",
  customWidthMm: 210,
  customHeightMm: 297,
  customUnit: "mm",
  marginMm: 6,
  scalePct: 100,
};

const MARGIN_PRESETS: { label: string; mm: number }[] = [
  { label: "No margin (0 mm)", mm: 0 },
  { label: "Narrow (6 mm)", mm: 6 },
  { label: "Normal (12 mm)", mm: 12 },
  { label: "Wide (20 mm)", mm: 20 },
];

const STORAGE_KEY = "curavilo.print.settings.v2";
const MM_PER_IN = 25.4;
const PX_PER_MM = 96 / 25.4;

function loadSettings(): PrintSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PrintSettings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

const isThermal = (key: PrintProfileKey) => key === "THERMAL_58MM" || key === "THERMAL_80MM" || key === "THERMAL_112MM";

/** Resolve the effective sheet geometry from settings. */
function resolveSheet(s: PrintSettings): { widthMm: number; heightMm: number | null; mono: boolean } {
  if (s.profileKey === "CUSTOM") {
    const w = s.customUnit === "in" ? s.customWidthMm * MM_PER_IN : s.customWidthMm;
    const h = s.customUnit === "in" ? s.customHeightMm * MM_PER_IN : s.customHeightMm;
    const [ew, eh] = s.orientation === "landscape" ? [Math.max(w, h), Math.min(w, h)] : [w, h];
    return { widthMm: ew, heightMm: eh, mono: false };
  }
  const p = PRINT_PROFILES[s.profileKey as Exclude<PrintProfileKey, "CUSTOM">];
  if (p.heightMm === null) return { widthMm: p.widthMm, heightMm: null, mono: p.mono };
  const [ew, eh] = s.orientation === "landscape" ? [p.heightMm, p.widthMm] : [p.widthMm, p.heightMm];
  return { widthMm: ew, heightMm: eh, mono: p.mono };
}

const fmtMm = (mm: number) => (Math.round(mm * 10) / 10).toString();

export function DocumentRenderer({
  branding,
  data,
  defaultProfile = "THERMAL_80MM",
  onPrinted,
}: {
  branding: Branding;
  data: ReceiptDocData;
  defaultProfile?: PrintProfileKey;
  onPrinted?: () => void;
}) {
  const [settings, setSettings] = useState<PrintSettings>(() => {
    if (typeof window === "undefined") return { ...DEFAULTS, profileKey: defaultProfile };
    const saved = loadSettings();
    return saved.profileKey ? saved : { ...saved, profileKey: defaultProfile };
  });
  const printedRef = useRef(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // storage unavailable (private mode): settings stay in memory
    }
  }, [settings]);

  const sheet = useMemo(() => resolveSheet(settings), [settings]);
  const thermal = sheet.heightMm === null;
  const paddingMm = thermal ? Math.min(settings.marginMm, 4) : settings.marginMm;
  const fontSize = (sheet.mono ? 10 : 12) * (settings.scalePct / 100);

  const update = (patch: Partial<PrintSettings>) => setSettings((prev) => ({ ...prev, ...patch }));

  // Inject @page rule for the effective sheet while mounted
  useEffect(() => {
    const size = sheet.heightMm === null ? `${fmtMm(sheet.widthMm)}mm auto` : `${fmtMm(sheet.widthMm)}mm ${fmtMm(sheet.heightMm)}mm`;
    const style = document.createElement("style");
    style.setAttribute("data-print-profile", "true");
    style.textContent = `@media print { @page { size: ${size}; margin: 0; } }`;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [sheet]);

  const doPrint = () => {
    printedRef.current = true;
    const originalTitle = document.title;
    document.title = `${data.number} - ${branding.facilityName}`;
    const restore = () => {
      document.title = originalTitle;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
    onPrinted?.();
    // Safety restore in case afterprint does not fire (some browsers + previews)
    window.setTimeout(() => {
      if (document.title !== originalTitle) restore();
    }, 4000);
  };

  return (
    <div className="space-y-3">
      {/* Controls + preview (never printed) */}
      <div className="no-print grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2.5 rounded-xl border bg-stone-50/70 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Paper size</Label>
              <Select
                value={settings.profileKey}
                onValueChange={(v) => {
                  const key = v as PrintProfileKey;
                  update({ profileKey: key, orientation: isThermal(key) ? "portrait" : settings.orientation });
                }}
              >
                <SelectTrigger className="w-[190px]" aria-label="Paper size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(PRINT_PROFILES).map((p) => (
                    <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                  ))}
                  <SelectItem value="CUSTOM">Custom size…</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {settings.profileKey === "CUSTOM" ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="pp-w" className="text-[11px] text-muted-foreground">Width</Label>
                  <Input
                    id="pp-w"
                    type="number"
                    min={10}
                    max={2000}
                    step={settings.customUnit === "mm" ? 1 : 0.05}
                    value={settings.customUnit === "mm" ? settings.customWidthMm : Math.round((settings.customWidthMm / MM_PER_IN) * 100) / 100}
                    onChange={(e) => update({ customWidthMm: Math.max(10, Number(e.target.value) || 0) * (settings.customUnit === "in" ? MM_PER_IN : 1) })}
                    className="h-9 w-24"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pp-h" className="text-[11px] text-muted-foreground">Height</Label>
                  <Input
                    id="pp-h"
                    type="number"
                    min={10}
                    max={2000}
                    step={settings.customUnit === "mm" ? 1 : 0.05}
                    value={settings.customUnit === "mm" ? settings.customHeightMm : Math.round((settings.customHeightMm / MM_PER_IN) * 100) / 100}
                    onChange={(e) => update({ customHeightMm: Math.max(10, Number(e.target.value) || 0) * (settings.customUnit === "in" ? MM_PER_IN : 1) })}
                    className="h-9 w-24"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Unit</Label>
                  <Select value={settings.customUnit} onValueChange={(v) => update({ customUnit: v as Unit })}>
                    <SelectTrigger className="w-[74px]" aria-label="Unit"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mm">mm</SelectItem>
                      <SelectItem value="in">inch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : null}

            {!thermal ? (
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Orientation</Label>
                <div className="flex h-9 overflow-hidden rounded-md border">
                  {(["portrait", "landscape"] as Orientation[]).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => update({ orientation: o })}
                      className={`px-3 text-xs transition ${settings.orientation === o ? "bg-teal-600 font-medium text-white" : "bg-white text-stone-500 hover:bg-teal-50"}`}
                    >
                      {o === "portrait" ? "Portrait" : "Landscape"}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Margin</Label>
              <Select value={String(settings.marginMm)} onValueChange={(v) => update({ marginMm: Number(v) })}>
                <SelectTrigger className="w-[150px]" aria-label="Margin"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MARGIN_PRESETS.map((m) => (
                    <SelectItem key={m.mm} value={String(m.mm)}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[170px] flex-1 space-y-1">
              <Label htmlFor="pp-scale" className="text-[11px] text-muted-foreground">Text scale: {settings.scalePct}%</Label>
              <input
                id="pp-scale"
                type="range"
                min={80}
                max={140}
                step={5}
                value={settings.scalePct}
                onChange={(e) => update({ scalePct: Number(e.target.value) })}
                className="h-9 w-full accent-teal-600"
                aria-label="Text scale"
              />
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSettings({ ...DEFAULTS, profileKey: defaultProfile })} title="Reset print settings">
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
            </Button>
            <Button onClick={doPrint} size="sm" className="ml-auto">
              <Printer className="mr-2 h-4 w-4" /> Print / Save PDF
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Sheet: {fmtMm(sheet.widthMm)} x {sheet.heightMm === null ? "auto" : fmtMm(sheet.heightMm)} mm · margin {fmtMm(paddingMm)} mm · your choice is remembered for next time.
            In the browser dialog, pick the same paper size and set margins to None for a 1:1 fit.
          </p>
        </div>

        {/* Live preview */}
        <div className="hidden flex-col items-center rounded-xl border bg-stone-100/70 p-3 sm:flex" aria-hidden>
          <span className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400">Preview</span>
          <PaperPreview sheet={sheet} paddingMm={paddingMm} fontSize={fontSize}>
            <DocBody branding={branding} data={data} mono={sheet.mono} />
          </PaperPreview>
        </div>
      </div>

      {data.reprint ? (
        <div className="no-print">
          <span className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">REPRINT</span>
        </div>
      ) : null}

      {/* Actual printable document */}
      <div
        className={`print-area mx-auto bg-white text-stone-900 shadow-sm ${sheet.mono ? "font-mono" : "font-sans"}`}
        style={
          {
            "--pp-width": `${fmtMm(sheet.widthMm)}mm`,
            width: `${fmtMm(sheet.widthMm)}mm`,
            maxWidth: "100%",
            padding: `${fmtMm(paddingMm)}mm`,
            fontSize: `${fontSize}px`,
            lineHeight: 1.45,
          } as React.CSSProperties
        }
      >
        <DocBody branding={branding} data={data} mono={sheet.mono} />
      </div>
    </div>
  );
}

/** Scaled paper mock: true aspect ratio, live doc render inside. */
function PaperPreview({
  sheet,
  paddingMm,
  fontSize,
  children,
}: {
  sheet: { widthMm: number; heightMm: number | null };
  paddingMm: number;
  fontSize: number;
  children: ReactNode;
}) {
  const PREVIEW_W = 172; // px
  const ratio = sheet.heightMm === null ? 1.5 : Math.min(1.9, sheet.heightMm / sheet.widthMm);
  const zoom = PREVIEW_W / (sheet.widthMm * PX_PER_MM); // doc laid out at true mm size, zoomed to fit
  return (
    <div
      className="relative overflow-hidden rounded-md border border-stone-300 bg-white shadow-sm"
      style={{ width: PREVIEW_W, height: Math.round(PREVIEW_W * ratio) }}
    >
      <div
        style={{
          width: `${sheet.widthMm}mm`,
          padding: `${paddingMm}mm`,
          fontSize: `${fontSize}px`,
          zoom,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function DocBody({ branding, data, mono }: { branding: Branding; data: ReceiptDocData; mono: boolean }) {
  const money = (m: number) => {
    try {
      return new Intl.NumberFormat("en-NG", { style: "currency", currency: branding.currency }).format(m / 100);
    } catch {
      return `${branding.currency} ${(m / 100).toFixed(2)}`;
    }
  };
  const isInvoice = data.kind === "INVOICE";
  const isCredit = data.kind === "CREDIT_NOTE";
  const docTitle = isInvoice ? "INVOICE" : isCredit ? "CREDIT NOTE" : "OFFICIAL RECEIPT";
  const center = "text-center";
  const gap = mono ? "my-1.5 border-t border-dashed border-stone-400" : "my-2 border-t border-stone-200";

  return (
    <div>
      <div className={center}>
        {branding.logoData ? (
          <img
            src={branding.logoData}
            alt={`${branding.facilityName} logo`}
            className={`mx-auto mb-1 ${mono ? "h-8" : "h-14"} object-contain`}
          />
        ) : null}
        <div className={mono ? "text-[11px] font-bold uppercase" : "text-base font-bold uppercase tracking-wide"}>
          {branding.facilityName}
        </div>
        <div className="text-[10px] text-stone-600">
          {branding.address ? <div>{branding.address}</div> : null}
          {branding.phone ? <div>Tel: {branding.phone}</div> : null}
        </div>
        <div className="mt-1 font-semibold">{docTitle}</div>
      </div>

      <div className={gap} />

      <div className="grid grid-cols-2 gap-x-2 text-[10px]">
        <div>No: <span className="font-semibold">{data.number}</span></div>
        <div className="text-right">{data.dateTime}</div>
        <div className="col-span-2">{isCredit ? "Credit for" : "Patient/Customer"}: <span className="font-semibold">{data.issuedTo}</span></div>
        <div className="col-span-2">Issued by: {data.cashier}</div>
      </div>

      <div className={gap} />

      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-left">
            <th className="pb-1">Item</th>
            <th className="pb-1 text-right">Qty</th>
            <th className="pb-1 text-right">Rate</th>
            <th className="pb-1 text-right">Amt</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line, i) => (
            <tr key={i} className="align-top break-inside-avoid">
              <td className="pb-1 pr-1">{line.name}</td>
              <td className="pb-1 text-right">{line.quantity}</td>
              <td className="pb-1 text-right">{money(line.unitPriceMinor)}</td>
              <td className="pb-1 text-right">{money(line.totalMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={gap} />

      <div className="space-y-0.5 text-[10px]">
        <div className="flex justify-between"><span>Subtotal</span><span>{money(data.subtotalMinor)}</span></div>
        {data.discountMinor > 0 ? (
          <div className="flex justify-between"><span>Discount</span><span>-{money(data.discountMinor)}</span></div>
        ) : null}
        <div className="flex justify-between text-[11px] font-bold">
          <span>{isInvoice ? "Total due" : isCredit ? "Refund total" : "Total"}</span>
          <span>{money(data.totalMinor)}</span>
        </div>
        {!isInvoice ? (
          <>
            <div className="flex justify-between"><span>{isCredit ? "Refund method" : "Paid"} ({data.method})</span><span>{money(data.amountPaidMinor ?? data.totalMinor)}</span></div>
            {data.reference ? <div className="flex justify-between"><span>Ref</span><span className="truncate pl-2">{data.reference}</span></div> : null}
          </>
        ) : (
          <div className="flex justify-between"><span>Amount paid</span><span>{money(data.amountPaidMinor ?? 0)}</span></div>
        )}
      </div>

      <div className={gap} />

      <div className={`${center} text-[9px] text-stone-600`}>
        {data.reprint ? <div className="mb-1 font-bold text-stone-800">** REPRINT **</div> : null}
        <div>{isInvoice ? branding.reportFooter ?? "Thank you." : branding.receiptFooter ?? "Thank you."}</div>
        <div className="mt-1">{branding.facilityName} · {data.number}</div>
      </div>
    </div>
  );
}

/* ─── Page-level print: any paper size for full-page reports ─────────────── */

const PAGE_PRINT_KEY = "curavilo.pageprint.v1";

interface PagePrintSettings {
  profileKey: PrintProfileKey;
  orientation: Orientation;
  customWidthMm: number;
  customHeightMm: number;
  customUnit: Unit;
}

const PAGE_PRINT_DEFAULTS: PagePrintSettings = {
  profileKey: "A4_STANDARD",
  orientation: "portrait",
  customWidthMm: 210,
  customHeightMm: 297,
  customUnit: "mm",
};

export function PagePrintButton({ label = "Print", className }: { label?: string; className?: string }) {
  const [cfg, setCfg] = useState<PagePrintSettings>(() => {
    if (typeof window === "undefined") return PAGE_PRINT_DEFAULTS;
    try {
      const raw = window.localStorage.getItem(PAGE_PRINT_KEY);
      return raw ? { ...PAGE_PRINT_DEFAULTS, ...(JSON.parse(raw) as Partial<PagePrintSettings>) } : PAGE_PRINT_DEFAULTS;
    } catch {
      return PAGE_PRINT_DEFAULTS;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(PAGE_PRINT_KEY, JSON.stringify(cfg));
    } catch {
      // storage unavailable
    }
    const sheet = resolveSheet({ ...cfg, marginMm: 0, scalePct: 100 });
    const size = sheet.heightMm === null ? `${fmtMm(sheet.widthMm)}mm auto` : `${fmtMm(sheet.widthMm)}mm ${fmtMm(sheet.heightMm)}mm`;
    let style = document.querySelector<HTMLStyleElement>("style[data-page-print]");
    if (!style) {
      style = document.createElement("style");
      style.setAttribute("data-page-print", "true");
      document.head.appendChild(style);
    }
    style.textContent = `@media print { @page { size: ${size}; margin: 8mm; } }`;
    return () => {
      style.textContent = "";
    };
  }, [cfg]);

  const update = (patch: Partial<PagePrintSettings>) => setCfg((prev) => ({ ...prev, ...patch }));
  const thermal = isThermal(cfg.profileKey);

  return (
    <div className="flex items-center gap-1.5 no-print">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={className} aria-label="Page print settings">
            <Settings2 className="h-4 w-4" />
            <span className="sr-only">Page print settings</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-2.5">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Paper size</Label>
            <Select value={cfg.profileKey} onValueChange={(v) => update({ profileKey: v as PrintProfileKey })}>
              <SelectTrigger aria-label="Page paper size"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(PRINT_PROFILES).map((p) => (
                  <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                ))}
                <SelectItem value="CUSTOM">Custom size…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {cfg.profileKey === "CUSTOM" ? (
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-[11px] text-muted-foreground">Width</Label>
                <Input
                  type="number"
                  min={10}
                  value={cfg.customUnit === "mm" ? cfg.customWidthMm : Math.round((cfg.customWidthMm / MM_PER_IN) * 100) / 100}
                  onChange={(e) => update({ customWidthMm: Math.max(10, Number(e.target.value) || 0) * (cfg.customUnit === "in" ? MM_PER_IN : 1) })}
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-[11px] text-muted-foreground">Height</Label>
                <Input
                  type="number"
                  min={10}
                  value={cfg.customUnit === "mm" ? cfg.customHeightMm : Math.round((cfg.customHeightMm / MM_PER_IN) * 100) / 100}
                  onChange={(e) => update({ customHeightMm: Math.max(10, Number(e.target.value) || 0) * (cfg.customUnit === "in" ? MM_PER_IN : 1) })}
                />
              </div>
              <Select value={cfg.customUnit} onValueChange={(v) => update({ customUnit: v as Unit })}>
                <SelectTrigger className="w-[70px]" aria-label="Unit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mm">mm</SelectItem>
                  <SelectItem value="in">inch</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {!thermal ? (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Orientation</Label>
              <div className="flex h-9 overflow-hidden rounded-md border">
                {(["portrait", "landscape"] as Orientation[]).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => update({ orientation: o })}
                    className={`flex-1 text-xs transition ${cfg.orientation === o ? "bg-teal-600 font-medium text-white" : "bg-white text-stone-500 hover:bg-teal-50"}`}
                  >
                    {o === "portrait" ? "Portrait" : "Landscape"}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <p className="text-[11px] text-muted-foreground">Applies to this page when you print. Your choice is remembered.</p>
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="sm" onClick={() => window.print()} className={className}>
        <Printer className="mr-2 h-4 w-4" /> {label}
      </Button>
    </div>
  );
}
