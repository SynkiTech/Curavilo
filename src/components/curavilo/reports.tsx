"use client";

// Reports - Generate Report flow: pick a report type + date range, press
// "Generate Report", then print or export the generated report as CSV/PDF.
// Deterministic figures computed from the ledgers - never estimated (spec §32).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, formatMoney, formatDate, formatDateTime } from "./api";
import { LoadingState, ErrorState, PageHeader, StatCard, EmptyState } from "./ui-kit";
import { PagePrintButton } from "./print";
import { buildReportCsv, downloadTextFile, type ReportType } from "./report-export";
import { useApp } from "./store";
import { toast } from "sonner";

function monthBounds(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

type TabDef = { key: ReportType; label: string; perm?: string; ranged: boolean };

export function Reports() {
  const { session } = useApp();
  const user = session?.user;
  const perms = user?.permissions ?? [];

  const tabs: TabDef[] = ([
    { key: "revenue", label: "Revenue", perm: "billing:read", ranged: true },
    { key: "volume", label: "Patient volume", perm: "reports:read", ranged: true },
    { key: "pharmacy", label: "Pharmacy sales", perm: "pos:sell", ranged: true },
    { key: "inventory", label: "Inventory", perm: "inventory:read", ranged: false },
    { key: "expenses", label: "Expenses", perm: "accounting:read", ranged: true },
    { key: "people", label: "People", perm: "hr:read", ranged: false },
  ] as TabDef[]).filter((t) => !t.perm || perms.includes(t.perm));

  const [type, setType] = useState<ReportType>(tabs[0]?.key ?? "volume");
  const [range, setRange] = useState(monthBounds);
  // The Generate Report flow: nothing is fetched until the button is pressed.
  // Switching report type clears the generated report so figures always match
  // the selected type (stale data of another type would render wrong shapes).
  const [generated, setGenerated] = useState<{ type: ReportType; from?: string; to?: string } | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const selectType = (next: ReportType) => {
    setType(next);
    setGenerated(null);
    setGeneratedAt(null);
  };

  const active = generated;
  const query = useQuery({
    queryKey: ["report", active?.type, active?.from ?? "", active?.to ?? ""],
    queryFn: () => {
      const qs = new URLSearchParams({ type: active?.type ?? "volume" });
      if (active?.from) qs.set("from", active.from);
      if (active?.to) qs.set("to", active.to);
      return apiGet<Record<string, unknown>>(`/api/reports?${qs.toString()}`);
    },
    enabled: !!active,
  });

  const currentTab = tabs.find((t) => t.key === type);
  const currency = user?.currency ?? "NGN";
  const timezone = user?.timezone ?? "Africa/Lagos";
  const period = active?.type === "inventory" || active?.type === "people"
    ? "As of now"
    : `${formatDate(active?.from ?? "")} to ${formatDate(active?.to ?? "")}`;

  const generate = () => {
    if (currentTab?.ranged && range.to < range.from) {
      toast.error("The end date is before the start date.");
      return;
    }
    setGenerated({ type, ...(currentTab?.ranged ? { from: range.from, to: range.to } : {}) });
    setGeneratedAt(new Date().toISOString());
  };

  const exportCsv = () => {
    if (!query.data) { toast.error("Generate the report first, then export."); return; }
    try {
      const csv = buildReportCsv(type, query.data, currency, period, timezone);
      downloadTextFile(`curavilo-${type}-report-${active?.from ?? "snapshot"}-${active?.to ?? "latest"}.csv`, csv);
      toast.success("CSV exported.");
    } catch (e) {
      toast.error((e as Error).message || "Could not build the CSV file.");
    }
  };

  const exportPdf = () => {
    if (!query.data) { toast.error("Generate the report first, then export."); return; }
    // Opens the browser print dialog - choose "Save as PDF" as the destination.
    // Paper size/orientation come from the page print settings gear.
    window.print();
  };

  return (
    <div className="print-area-parent">
      <PageHeader
        title="Reports"
        subtitle="Generate a report for a selected date, then print it or export as CSV or PDF."
        actions={
          <div className="flex items-center gap-1.5 no-print">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!query.data} aria-label="Export as CSV">
              <Download className="mr-2 h-4 w-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportPdf} disabled={!query.data} aria-label="Export as PDF (opens print dialog)">
              <FileText className="mr-2 h-4 w-4" /> PDF
            </Button>
            <PagePrintButton />
          </div>
        }
      />

      {/* Report builder */}
      <div className="mb-4 space-y-3 rounded-xl border bg-white p-3.5 no-print" aria-label="Report builder">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1.5">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => selectType(t.key)}
                className={`rounded-full border px-3 py-1 text-xs transition ${type === t.key ? "border-teal-600 bg-teal-50 font-medium text-teal-800" : "border-stone-200 text-stone-500 hover:border-teal-400"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {currentTab?.ranged ? (
            <div className="flex items-end gap-2">
              <div className="space-y-0.5">
                <Label htmlFor="r-from" className="text-xs">From</Label>
                <Input id="r-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="h-8 w-36" />
              </div>
              <div className="space-y-0.5">
                <Label htmlFor="r-to" className="text-xs">To</Label>
                <Input id="r-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="h-8 w-36" />
              </div>
            </div>
          ) : (
            <p className="pb-1.5 text-xs text-muted-foreground">Snapshot report - always reflects the current ledger.</p>
          )}
          <Button className="ml-auto bg-teal-700 hover:bg-teal-800" onClick={generate} aria-label="Generate report">
            <BarChart3 className="mr-2 h-4 w-4" /> Generate Report
          </Button>
        </div>
      </div>

      {!generated ? (
        <EmptyState
          title="No report generated yet"
          hint="Choose a report type (and date range), then press Generate Report. Export the generated report as CSV or PDF."
        />
      ) : query.isLoading ? (
        <LoadingState label="Generating report…" />
      ) : query.isError ? (
        <ErrorState message={(query.error as Error)?.message} onRetry={() => void query.refetch()} />
      ) : query.data ? (
        <ReportBody
          type={type}
          data={query.data}
          currency={currency}
          timezone={timezone}
          period={period}
          generatedAt={generatedAt}
        />
      ) : null}
    </div>
  );
}

function ReportHeading({ title, period, generatedAt, timezone }: { title: string; period: string; generatedAt: string | null; timezone: string }) {
  return (
    <div className="print-area">
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="text-xs text-muted-foreground">
        Period: {period}{generatedAt ? ` · generated ${formatDateTime(generatedAt, timezone)}` : ""}
      </p>
    </div>
  );
}

function ReportBody({ type, data, currency, timezone, period, generatedAt }: {
  type: ReportType; data: Record<string, unknown>; currency: string; timezone: string; period: string; generatedAt: string | null;
}) {
  if (type === "revenue") {
    const d = data as { totalMinor: number; paymentCount: number; invoicesIssued: number; outstandingMinor: number; byMethod: Record<string, number>; payments: { id: string; number: string; method: string; amountMinor: number; createdAt: string; invoiceNumber?: string; patient?: string | null }[] };
    return (
      <div className="space-y-4">
        <ReportHeading title="Revenue report" period={period} generatedAt={generatedAt} timezone={timezone} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print-area">
          <StatCard title="Revenue collected" value={formatMoney(d.totalMinor, currency)} />
          <StatCard title="Payments" value={d.paymentCount} />
          <StatCard title="Invoices issued" value={d.invoicesIssued} />
          <StatCard title="Outstanding" value={formatMoney(d.outstandingMinor, currency)} tone={d.outstandingMinor > 0 ? "warn" : "default"} />
        </div>
        <div className="rounded-lg border bg-white p-4 print-area">
          <h3 className="mb-3 text-sm font-semibold">By payment method</h3>
          <ul className="flex flex-wrap gap-2">
            {Object.entries(d.byMethod).map(([m, v]) => (
              <li key={m} className="rounded-full border bg-stone-50 px-3 py-1 text-xs">{m}: <span className="font-semibold tabular-nums">{formatMoney(v, currency)}</span></li>
            ))}
          </ul>
        </div>
        <div className="overflow-hidden rounded-lg border bg-white print-area">
          <Table>
            <TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Patient</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {d.payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.number}</TableCell>
                  <TableCell>{p.patient ?? "-"}</TableCell>
                  <TableCell>{p.method}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(p.amountMinor, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  if (type === "volume") {
    const d = data as { total: number; byDay: { date: string; count: number }[]; bySex: { MALE: number; FEMALE: number }; avgEncounterMinutes: number };
    const busiest = d.byDay.length ? [...d.byDay].sort((a, b) => b.count - a.count)[0] : null;
    return (
      <div className="space-y-4">
        <ReportHeading title="Patient volume report" period={period} generatedAt={generatedAt} timezone={timezone} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print-area">
          <StatCard title="Encounters" value={d.total} />
          <StatCard title="Female / Male" value={`${d.bySex.FEMALE} / ${d.bySex.MALE}`} />
          <StatCard title="Avg encounter duration" value={`${d.avgEncounterMinutes} min`} />
          <StatCard title="Busiest day" value={busiest ? `${busiest.count}` : "0"} hint={busiest ? busiest.date : "no encounters"} />
        </div>
        <div className="rounded-lg border bg-white p-4 print-area" style={{ minHeight: 300 }}>
          <h3 className="mb-3 text-sm font-semibold">Encounters per day</h3>
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Encounters</TableHead></TableRow></TableHeader>
            <TableBody>
              {d.byDay.map((r) => (
                <TableRow key={r.date}>
                  <TableCell>{r.date}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                </TableRow>
              ))}
              {d.byDay.length === 0 ? <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No encounters in this period.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  if (type === "inventory") {
    const d = data as { items: { sku: string; name: string; category: string; onHand: number; reorderLevel: number; low: boolean; valueMinor: number; expiringLots: number }[]; totalValueMinor: number; lowStockCount: number; expiringCount: number; itemCount: number };
    return (
      <div className="space-y-4">
        <ReportHeading title="Inventory valuation report" period={period} generatedAt={generatedAt} timezone={timezone} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print-area">
          <StatCard title="Items" value={d.itemCount} />
          <StatCard title="Total stock value" value={formatMoney(d.totalValueMinor, currency)} />
          <StatCard title="Low stock" value={d.lowStockCount} tone={d.lowStockCount > 0 ? "warn" : "default"} />
          <StatCard title="Expiring in 30 days" value={d.expiringCount} tone={d.expiringCount > 0 ? "warn" : "default"} />
        </div>
        <div className="overflow-hidden rounded-lg border bg-white print-area">
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Reorder</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Flag</TableHead></TableRow></TableHeader>
            <TableBody>
              {d.items.map((i) => (
                <TableRow key={i.sku}>
                  <TableCell><span className="font-medium">{i.name}</span> <span className="ml-1 font-mono text-[10px] text-muted-foreground">{i.sku}</span></TableCell>
                  <TableCell className="text-xs">{i.category}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.onHand}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.reorderLevel}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(i.valueMinor, currency)}</TableCell>
                  <TableCell>{i.low ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">LOW</span> : i.expiringLots > 0 ? <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">EXPIRING</span> : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  if (type === "expenses") {
    const d = data as { expenses: { date: string; category: string; description: string; vendor: string | null; method: string; status: string; amountMinor: number }[]; totalMinor: number; byCategory: Record<string, number>; pendingCount: number; pendingMinor: number };
    return (
      <div className="space-y-4">
        <ReportHeading title="Expense report" period={period} generatedAt={generatedAt} timezone={timezone} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print-area">
          <StatCard title="Booked total" value={formatMoney(d.totalMinor, currency)} />
          <StatCard title="Categories" value={Object.keys(d.byCategory).length} />
          <StatCard title="Pending approvals" value={d.pendingCount} tone={d.pendingCount > 0 ? "warn" : "default"} hint={formatMoney(d.pendingMinor, currency)} />
          <StatCard title="Entries" value={d.expenses.length} />
        </div>
        <div className="rounded-lg border bg-white p-4 print-area">
          <h3 className="mb-3 text-sm font-semibold">By category</h3>
          <ul className="flex flex-wrap gap-2">
            {Object.entries(d.byCategory).sort((a, b) => b[1] - a[1]).map(([m, v]) => (
              <li key={m} className="rounded-full border bg-stone-50 px-3 py-1 text-xs">{m}: <span className="font-semibold tabular-nums">{formatMoney(v, currency)}</span></li>
            ))}
          </ul>
        </div>
        <div className="overflow-hidden rounded-lg border bg-white print-area">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Category</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {d.expenses.map((e, i) => (
                <TableRow key={`${e.date}-${i}`}>
                  <TableCell className="whitespace-nowrap text-xs">{e.date}</TableCell>
                  <TableCell className="max-w-[260px] truncate">{e.description}</TableCell>
                  <TableCell className="text-xs">{e.category}</TableCell>
                  <TableCell className="text-xs">{e.status}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(e.amountMinor, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  if (type === "people") {
    const d = data as {
      headcount: number; activeCount: number; pendingLeave: number; onLeaveToday: number;
      certificationsExpiring: { staff: string; name: string; expiresAt: string }[];
      attendanceToday: { present: number; late: number; absent: number; leave: number };
      staff: { name: string; designation: string; department: string | null; active: boolean }[];
    };
    return (
      <div className="space-y-4">
        <ReportHeading title="People report" period={period} generatedAt={generatedAt} timezone={timezone} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print-area">
          <StatCard title="Headcount" value={d.headcount} hint={`${d.activeCount} active`} />
          <StatCard title="Pending leave" value={d.pendingLeave} tone={d.pendingLeave > 0 ? "warn" : "default"} />
          <StatCard title="On leave today" value={d.onLeaveToday} />
          <StatCard title="Certs expiring (30d)" value={d.certificationsExpiring.length} tone={d.certificationsExpiring.length > 0 ? "warn" : "default"} />
        </div>
        <div className="rounded-lg border bg-white p-4 print-area">
          <h3 className="mb-3 text-sm font-semibold">Attendance today</h3>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[["Present", d.attendanceToday.present], ["Late", d.attendanceToday.late], ["Absent", d.attendanceToday.absent], ["Leave", d.attendanceToday.leave]].map(([label, v]) => (
              <div key={String(label)} className="rounded-lg border bg-stone-50/60 p-2">
                <div className="text-[11px] text-muted-foreground">{label}</div>
                <div className="text-sm font-semibold tabular-nums">{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border bg-white print-area">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Designation</TableHead><TableHead>Department</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {d.staff.map((s) => (
                <TableRow key={s.name}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-xs">{s.designation}</TableCell>
                  <TableCell className="text-xs">{s.department ?? "-"}</TableCell>
                  <TableCell className="text-xs">{s.active ? "ACTIVE" : "INACTIVE"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  // pharmacy
  const d = data as { totalMinor: number; salesCount: number; byDay: { date: string; total: number }[]; topItems: { name: string; qty: number; totalMinor: number }[] };
  return (
    <div className="space-y-4">
      <ReportHeading title="Pharmacy sales report" period={period} generatedAt={generatedAt} timezone={timezone} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 print-area">
        <StatCard title="Sales total" value={formatMoney(d.totalMinor, currency)} />
        <StatCard title="Transactions" value={d.salesCount} />
        <StatCard title="Top item" value={d.topItems[0]?.name ?? "-"} hint={d.topItems[0] ? formatMoney(d.topItems[0].totalMinor, currency) : undefined} />
      </div>
      <div className="overflow-hidden rounded-lg border bg-white print-area">
        <Table>
          <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Units sold</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow></TableHeader>
          <TableBody>
            {d.topItems.map((i) => (
              <TableRow key={i.name}>
                <TableCell>{i.name}</TableCell>
                <TableCell className="text-right tabular-nums">{i.qty}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(i.totalMinor, currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
