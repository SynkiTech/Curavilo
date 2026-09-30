"use client";

// Reports - revenue, patient volume, pharmacy sales (deterministic, printable) (spec §32)
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, formatMoney, formatDate, formatDateTime } from "./api";
import { LoadingState, ErrorState, PageHeader, StatCard } from "./ui-kit";
import { PagePrintButton } from "./print";
import { useApp } from "./store";

function monthBounds(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

export function Reports() {
  const { session } = useApp();
  const user = session?.user;
  const perms = user?.permissions ?? [];
  const [type, setType] = useState<"revenue" | "volume" | "pharmacy">(perms.includes("billing:read") ? "revenue" : perms.includes("reports:read") ? "volume" : "pharmacy");
  const [range, setRange] = useState(monthBounds);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["report", type, range.from, range.to],
    queryFn: () => apiGet<Record<string, unknown>>(`/api/reports?type=${type}&from=${range.from}&to=${range.to}`),
    enabled: perms.includes("billing:read") || perms.includes("reports:read") || perms.includes("pos:sell"),
  });

  const tabs: { key: "revenue" | "volume" | "pharmacy"; label: string; perm?: string }[] = ([
    { key: "revenue", label: "Revenue", perm: "billing:read" },
    { key: "volume", label: "Patient volume", perm: "reports:read" },
    { key: "pharmacy", label: "Pharmacy sales", perm: "pos:sell" },
  ] as const).filter((t) => !t.perm || perms.includes(t.perm));

  return (
    <div className="print-area-parent">
      <PageHeader
        title="Reports"
        subtitle="Deterministic figures computed from the ledgers - never estimated."
        actions={<PagePrintButton />}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3 no-print">
        <div className="flex gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setType(t.key)}
              className={`rounded-full border px-3 py-1 text-xs transition ${type === t.key ? "border-teal-600 bg-teal-50 font-medium text-teal-800" : "border-stone-200 text-stone-500 hover:border-teal-400"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-end gap-2">
          <div className="space-y-0.5">
            <Label htmlFor="r-from" className="text-xs">From</Label>
            <Input id="r-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="h-8 w-36" />
          </div>
          <div className="space-y-0.5">
            <Label htmlFor="r-to" className="text-xs">To</Label>
            <Input id="r-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="h-8 w-36" />
          </div>
        </div>
      </div>

      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}
      {data ? <ReportBody type={type} data={data} currency={user?.currency ?? "NGN"} timezone={user?.timezone ?? "Africa/Lagos"} period={`${formatDate(range.from)} to ${formatDate(range.to)}`} /> : null}
    </div>
  );
}

function ReportBody({ type, data, currency, timezone, period }: { type: string; data: Record<string, unknown>; currency: string; timezone: string; period: string }) {
  if (type === "revenue") {
    const d = data as { totalMinor: number; paymentCount: number; invoicesIssued: number; outstandingMinor: number; byMethod: Record<string, number>; payments: { id: string; number: string; method: string; amountMinor: number; createdAt: string; invoiceNumber?: string; patient?: string | null }[] };
    return (
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">Period: {period} · generated {formatDateTime(new Date().toISOString(), timezone)}</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
    return (
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">Period: {period} · generated {formatDateTime(new Date().toISOString(), timezone)}</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard title="Encounters" value={d.total} />
          <StatCard title="Female / Male" value={`${d.bySex.FEMALE} / ${d.bySex.MALE}`} />
          <StatCard title="Avg encounter duration" value={`${d.avgEncounterMinutes} min`} />
          <StatCard title="Busiest day" value={d.byDay.length ? `${[...d.byDay].sort((a, b) => b.count - a.count)[0].count}` : "0"} hint="encounters" />
        </div>
        <div className="rounded-lg border bg-white p-4 print-area" style={{ height: 300 }}>
          <h3 className="mb-3 text-sm font-semibold">Encounters per day</h3>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={d.byDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={28} />
              <ChartTooltip />
              <Bar dataKey="count" fill="#0f766e" radius={[3, 3, 0, 0]} name="Encounters" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  const d = data as { totalMinor: number; salesCount: number; byDay: { date: string; total: number }[]; topItems: { name: string; qty: number; totalMinor: number }[] };
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Period: {period} · generated {formatDateTime(new Date().toISOString(), timezone)}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
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
