"use client";

// Central print engine (ADR 0004): document data + facility branding + print profile
// → renderer → browser print. Reprint keeps the original transaction.
import { ReactNode, useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type PrintProfileKey = "A4_STANDARD" | "A5_STANDARD" | "LETTER_STANDARD" | "THERMAL_58MM" | "THERMAL_80MM";

export interface PrintProfile {
  key: PrintProfileKey;
  label: string;
  page: string; // @page size
  width: string;
  padding: string;
  mono: boolean;
  scale: string;
}

export const PRINT_PROFILES: Record<PrintProfileKey, PrintProfile> = {
  A4_STANDARD: { key: "A4_STANDARD", label: "A4 (210×297mm)", page: "A4 portrait", width: "210mm", padding: "14mm", mono: false, scale: "1" },
  A5_STANDARD: { key: "A5_STANDARD", label: "A5 (148×210mm)", page: "A5 portrait", width: "148mm", padding: "10mm", mono: false, scale: "1" },
  LETTER_STANDARD: { key: "LETTER_STANDARD", label: "Letter (8.5×11in)", page: "letter portrait", width: "216mm", padding: "14mm", mono: false, scale: "1" },
  THERMAL_58MM: { key: "THERMAL_58MM", label: "Thermal 58mm", page: "58mm auto", width: "58mm", padding: "3mm", mono: true, scale: "0.9" },
  THERMAL_80MM: { key: "THERMAL_80MM", label: "Thermal 80mm", page: "80mm auto", width: "80mm", padding: "4mm", mono: true, scale: "0.95" },
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
  kind: "RECEIPT" | "SALE_RECEIPT" | "INVOICE";
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
  const [profileKey, setProfileKey] = useState<PrintProfileKey>(defaultProfile);
  const profile = PRINT_PROFILES[profileKey];
  const printedRef = useRef(false);

  const isReceiptKind = data.kind !== "INVOICE";

  const doPrint = () => {
    printedRef.current = true;
    window.print();
    onPrinted?.();
  };

  // Inject @page rule for the selected profile while mounted
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-print-profile", "true");
    style.textContent = `@media print { @page { size: ${profile.page}; margin: 0; } }`;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [profile]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 no-print">
        <Select value={profileKey} onValueChange={(v) => setProfileKey(v as PrintProfileKey)}>
          <SelectTrigger className="w-[220px]" aria-label="Print profile">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.values(PRINT_PROFILES).map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={doPrint} size="sm">
          <Printer className="mr-2 h-4 w-4" /> Print / Save PDF
        </Button>
        {data.reprint ? (
          <span className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">REPRINT</span>
        ) : null}
      </div>

      <div
        className={`print-area mx-auto bg-white text-stone-900 shadow-sm ${profile.mono ? "font-mono" : "font-sans"}`}
        style={{
          width: profile.width,
          padding: profile.padding,
          fontSize: profile.mono ? "10px" : "12px",
          lineHeight: 1.45,
        }}
      >
        <DocBody branding={branding} data={data} profile={profile} />
      </div>
    </div>
  );
}

function DocBody({ branding, data, profile }: { branding: Branding; data: ReceiptDocData; profile: PrintProfile }) {
  const money = (m: number) => {
    try {
      return new Intl.NumberFormat("en-NG", { style: "currency", currency: branding.currency }).format(m / 100);
    } catch {
      return `${branding.currency} ${(m / 100).toFixed(2)}`;
    }
  };
  const isInvoice = data.kind === "INVOICE";
  const center = profile.mono ? "text-center" : "text-center";
  const gap = profile.mono ? "my-1.5 border-t border-dashed border-stone-400" : "my-2 border-t border-stone-200";

  return (
    <div>
      <div className={center}>
        {branding.logoData ? (
           
          <img
            src={branding.logoData}
            alt={`${branding.facilityName} logo`}
            className={`mx-auto mb-1 ${profile.mono ? "h-8" : "h-14"} object-contain`}
          />
        ) : null}
        <div className={profile.mono ? "text-[11px] font-bold uppercase" : "text-base font-bold uppercase tracking-wide"}>
          {branding.facilityName}
        </div>
        <div className="text-[10px] text-stone-600">
          {branding.address ? <div>{branding.address}</div> : null}
          {branding.phone ? <div>Tel: {branding.phone}</div> : null}
        </div>
        <div className="mt-1 font-semibold">{isInvoice ? "INVOICE" : "OFFICIAL RECEIPT"}</div>
      </div>

      <div className={gap} />

      <div className="grid grid-cols-2 gap-x-2 text-[10px]">
        <div>No: <span className="font-semibold">{data.number}</span></div>
        <div className="text-right">{data.dateTime}</div>
        <div className="col-span-2">Patient/Customer: <span className="font-semibold">{data.issuedTo}</span></div>
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
        <div className="flex justify-between text-[11px] font-bold"><span>{isInvoice ? "Total due" : "Total"}</span><span>{money(data.totalMinor)}</span></div>
        {!isInvoice ? (
          <>
            <div className="flex justify-between"><span>Paid ({data.method})</span><span>{money(data.amountPaidMinor ?? data.totalMinor)}</span></div>
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
