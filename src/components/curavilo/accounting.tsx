"use client";

// Accounting - expense ledger, P&L, receivables aging (deterministic, printable).
// The accountant records expenses, approves/rejects/pays them and exports the
// books as CSV or PDF via the Generate Report flow.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Plus, CircleCheck, CircleX, Banknote, TrendingDown, Wallet, Receipt, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiSend, formatMoney, formatDate } from "./api";
import { LoadingState, ErrorState, EmptyState, PageHeader, StatCard, PermissionDenied } from "./ui-kit";
import { PagePrintButton } from "./print";
import { toCsv, downloadTextFile } from "./report-export";
import { useApp, can } from "./store";
import { toast } from "sonner";

interface ExpenseRow {
  id: string; category: string; description: string; vendor: string | null; reference: string | null;
  amountMinor: number; currency: string; method: string; status: string; incurredAt: string;
  paidAt: string | null; requestedByName: string; approvedByName: string | null; note: string | null;
}

interface AccountingSummary {
  period: { from: string; to: string };
  revenueMinor: number; expensesMinor: number; netMinor: number; paymentCount: number; invoicesIssued: number;
  byMethod: Record<string, number>; byCategory: Record<string, number>;
  outstandingMinor: number;
  aging: { current: number; d30: number; d60: number; d90: number; d90plus: number };
  receivables: { number: string; patient: string | null; dueMinor: number; daysOutstanding: number }[];
  pendingExpenseCount: number; pendingExpenseMinor: number; currency: string;
}

const CATEGORIES = ["RENT", "UTILITIES", "SALARIES", "SUPPLIES", "EQUIPMENT", "MAINTENANCE", "MARKETING", "INSURANCE", "TRANSPORT", "TAX", "OPERATIONS", "OTHER"];
const METHODS = ["CASH", "TRANSFER", "CARD", "POS", "CHEQUE"];

function todayIso() { return new Date().toISOString().slice(0, 10); }
function daysAgoIso(n: number) { return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10); }

export function Accounting() {
  const { session } = useApp();
  const perms = session?.user?.permissions ?? [];
  const qc = useQueryClient();

  if (!can("accounting:read")) return <PermissionDenied what="the accounting books" />;

  return (
    <div className="print-area-parent">
      <PageHeader
        title="Accounting"
        subtitle="Expenses, profit and loss, and receivables - computed from the ledgers, never estimated."
        actions={
          <div className="flex items-center gap-1.5 no-print">
            <PagePrintButton />
          </div>
        }
      />
      <AccountingTabs perms={perms} qc={qc} />
    </div>
  );
}

function AccountingTabs({ perms, qc }: { perms: string[]; qc: ReturnType<typeof useQueryClient> }) {
  const [tab, setTab] = useState<"overview" | "expenses" | "receivables">("overview");
  const canWrite = perms.includes("accounting:write");

  const tabs: { key: typeof tab; label: string }[] = [
    { key: "overview", label: "Profit & Loss" },
    { key: "expenses", label: "Expense ledger" },
    { key: "receivables", label: "Receivables" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 no-print">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full border px-3 py-1 text-xs transition ${tab === t.key ? "border-teal-600 bg-teal-50 font-medium text-teal-800" : "border-stone-200 text-stone-500 hover:border-teal-400"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "overview" ? <PnLView /> : null}
      {tab === "expenses" ? <ExpenseLedger canWrite={canWrite} qc={qc} /> : null}
      {tab === "receivables" ? <ReceivablesView /> : null}
    </div>
  );
}

/* ─── Profit & Loss (period report with Generate + export) ─────────────────── */

function PnLView() {
  const { session } = useApp();
  const [range, setRange] = useState({ from: daysAgoIso(89), to: todayIso() });
  const [generated, setGenerated] = useState<{ from: string; to: string } | null>(null);

  const query = useQuery({
    queryKey: ["accounting", "summary", generated?.from, generated?.to],
    queryFn: () => apiGet<AccountingSummary>(`/api/accounting?view=summary&from=${generated?.from}&to=${generated?.to}`),
    enabled: !!generated,
  });

  const currency = session?.user?.currency ?? "NGN";
  const d = query.data;

  const exportCsv = () => {
    if (!d) { toast.error("Generate the report first, then export."); return; }
    try {
      const rows: unknown[][] = [
        ["Curavilo accounting report", "Profit & Loss"],
        ["Period", `${d.period.from} to ${d.period.to}`],
        ["Currency", d.currency],
        ["Generated at", new Date().toISOString()],
        [],
        ["Summary"],
        ["Revenue collected", (d.revenueMinor / 100).toFixed(2)],
        ["Expenses booked", (d.expensesMinor / 100).toFixed(2)],
        ["Net position", (d.netMinor / 100).toFixed(2)],
        ["Payments", d.paymentCount],
        ["Invoices issued", d.invoicesIssued],
        ["Outstanding receivables", (d.outstandingMinor / 100).toFixed(2)],
        [],
        ["Expenses by category"],
        ...Object.entries(d.byCategory).map(([k, v]) => [k, (v / 100).toFixed(2)]),
        [],
        ["Revenue by method"],
        ...Object.entries(d.byMethod).map(([k, v]) => [k, (v / 100).toFixed(2)]),
        [],
        ["Receivables aging"],
        ["Current", (d.aging.current / 100).toFixed(2)],
        ["31-60 days", (d.aging.d30 / 100).toFixed(2)],
        ["61-90 days", (d.aging.d60 / 100).toFixed(2)],
        ["91-120 days", (d.aging.d90 / 100).toFixed(2)],
        ["120+ days", (d.aging.d90plus / 100).toFixed(2)],
      ];
      downloadTextFile(`curavilo-accounting-${d.period.from}-to-${d.period.to}.csv`, toCsv(rows));
      toast.success("CSV exported.");
    } catch (e) {
      toast.error((e as Error).message || "Could not build the CSV file.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 no-print">
        <div className="space-y-0.5">
          <Label className="text-xs">From</Label>
          <Input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="h-8 w-36" />
        </div>
        <div className="space-y-0.5">
          <Label className="text-xs">To</Label>
          <Input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="h-8 w-36" />
        </div>
        <Button
          size="sm" className="bg-teal-700 hover:bg-teal-800"
          onClick={() => {
            if (range.to < range.from) { toast.error("The end date is before the start date."); return; }
            setGenerated({ ...range });
          }}
        >
          <Receipt className="mr-2 h-4 w-4" /> Generate Report
        </Button>
        <div className="ml-auto flex gap-1.5">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!d}>
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => (d ? window.print() : toast.error("Generate the report first, then export."))} disabled={!d}>
            <FileText className="mr-2 h-4 w-4" /> PDF
          </Button>
        </div>
      </div>

      {!generated ? (
        <EmptyState title="No report generated yet" hint="Pick a date range and select Generate Report to build the Profit & Loss statement." />
      ) : query.isLoading ? (
        <LoadingState label="Generating report…" />
      ) : query.isError ? (
        <ErrorState message={(query.error as Error)?.message} onRetry={() => void query.refetch()} />
      ) : d ? (
        <div className="space-y-4 print-area">
          <p className="text-xs text-muted-foreground">Period: {formatDate(d.period.from)} to {formatDate(d.period.to)} · generated {new Date().toLocaleString()}</p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard title="Revenue collected" value={formatMoney(d.revenueMinor, d.currency)} />
            <StatCard title="Expenses booked" value={formatMoney(d.expensesMinor, d.currency)} tone={d.expensesMinor > d.revenueMinor ? "warn" : "default"} />
            <StatCard title="Net position" value={formatMoney(d.netMinor, d.currency)} tone={d.netMinor < 0 ? "warn" : "default"} />
            <StatCard title="Outstanding receivables" value={formatMoney(d.outstandingMinor, d.currency)} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border bg-white p-4 print-area">
              <h3 className="mb-3 text-sm font-semibold">Expenses by category</h3>
              {Object.keys(d.byCategory).length === 0 ? (
                <p className="text-sm text-muted-foreground">No expenses booked in this period.</p>
              ) : (
                <ul className="space-y-1.5">
                  {Object.entries(d.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between text-sm">
                      <span className="capitalize">{k.toLowerCase().replace("_", " ")}</span>
                      <span className="font-semibold tabular-nums">{formatMoney(v, d.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-lg border bg-white p-4 print-area">
              <h3 className="mb-3 text-sm font-semibold">Revenue by payment method</h3>
              {Object.keys(d.byMethod).length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments collected in this period.</p>
              ) : (
                <ul className="space-y-1.5">
                  {Object.entries(d.byMethod).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between text-sm">
                      <span className="capitalize">{k.toLowerCase()}</span>
                      <span className="font-semibold tabular-nums">{formatMoney(v, d.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4 print-area">
            <h3 className="mb-3 text-sm font-semibold">Receivables aging</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                ["Current", d.aging.current], ["31-60 days", d.aging.d30], ["61-90 days", d.aging.d60],
                ["91-120 days", d.aging.d90], ["120+ days", d.aging.d90plus],
              ].map(([label, v]) => (
                <div key={String(label)} className="rounded-lg border bg-stone-50/60 p-2.5 text-center">
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                  <div className="text-sm font-semibold tabular-nums">{formatMoney(Number(v), d.currency)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ─── Expense ledger ───────────────────────────────────────────────────────── */

function ExpenseLedger({ canWrite, qc }: { canWrite: boolean; qc: ReturnType<typeof useQueryClient> }) {
  const { session } = useApp();
  const [filters, setFilters] = useState<{ status: string; category: string; q: string }>({ status: "", category: "", q: "" });
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; expense: ExpenseRow } | null>(null);

  const qs = new URLSearchParams({ view: "expenses" });
  if (filters.status) qs.set("status", filters.status);
  if (filters.category) qs.set("category", filters.category);
  if (filters.q) qs.set("q", filters.q);

  const query = useQuery({
    queryKey: ["accounting", "expenses", filters],
    queryFn: () => apiGet<{ expenses: ExpenseRow[]; totals: { allMinor: number; pendingMinor: number; approvedMinor: number; paidMinor: number }; currency: string }>(`/api/accounting?${qs.toString()}`),
  });

  const act = useMutation({
    mutationFn: (input: { id: string; action: "approve" | "reject" | "mark-paid" }) => apiSend("PATCH", "/api/accounting", input),
    onSuccess: (_data, vars) => {
      toast.success(vars.action === "approve" ? "Expense approved." : vars.action === "reject" ? "Expense rejected." : "Payment recorded.");
      void qc.invalidateQueries({ queryKey: ["accounting"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const d = query.data;
  const currency = session?.user?.currency ?? "NGN";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 no-print">
        <Select value={filters.status || "all"} onValueChange={(v) => setFilters((f) => ({ ...f, status: v === "all" ? "" : v }))}>
          <SelectTrigger className="h-8 w-[150px]" aria-label="Status filter"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {["PENDING", "APPROVED", "PAID", "REJECTED"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.category || "all"} onValueChange={(v) => setFilters((f) => ({ ...f, category: v === "all" ? "" : v }))}>
          <SelectTrigger className="h-8 w-[160px]" aria-label="Category filter"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" aria-hidden />
          <Input
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="Search description, vendor…"
            className="h-8 w-56 pl-8"
            aria-label="Search expenses"
          />
        </div>
        {canWrite ? (
          <Button size="sm" className="ml-auto bg-teal-700 hover:bg-teal-800" onClick={() => setDialog({ mode: "add" })}>
            <Plus className="mr-2 h-4 w-4" /> Record expense
          </Button>
        ) : null}
      </div>

      {d ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard title="Ledger total" value={formatMoney(d.totals.allMinor, d.currency)} />
          <StatCard title="Pending approval" value={formatMoney(d.totals.pendingMinor, d.currency)} tone={d.totals.pendingMinor > 0 ? "warn" : "default"} />
          <StatCard title="Approved (unpaid)" value={formatMoney(d.totals.approvedMinor, d.currency)} />
          <StatCard title="Paid" value={formatMoney(d.totals.paidMinor, d.currency)} />
        </div>
      ) : null}

      {query.isLoading ? <LoadingState /> : query.isError ? (
        <ErrorState message={(query.error as Error)?.message} onRetry={() => void query.refetch()} />
      ) : !d || d.expenses.length === 0 ? (
        <EmptyState title="No expenses found" hint="Record your first expense or relax the filters." />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white print-area">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                {canWrite ? <TableHead className="text-right no-print">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.expenses.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatDate(e.incurredAt)}</TableCell>
                  <TableCell>
                    <div className="max-w-[260px] truncate font-medium" title={e.description}>{e.description}</div>
                    {e.vendor ? <div className="text-xs text-muted-foreground">{e.vendor}</div> : null}
                  </TableCell>
                  <TableCell className="text-xs">{e.category}</TableCell>
                  <TableCell className="text-xs">{e.method}</TableCell>
                  <TableCell><ExpenseStatusBadge status={e.status} /></TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatMoney(e.amountMinor, currency)}</TableCell>
                  {canWrite ? (
                    <TableCell className="no-print">
                      <div className="flex justify-end gap-1">
                        {e.status === "PENDING" ? (
                          <>
                            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => act.mutate({ id: e.id, action: "approve" })} aria-label="Approve expense">
                              <CircleCheck className="h-3.5 w-3.5 text-emerald-600" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => act.mutate({ id: e.id, action: "reject" })} aria-label="Reject expense">
                              <CircleX className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          </>
                        ) : null}
                        {e.status === "APPROVED" ? (
                          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => act.mutate({ id: e.id, action: "mark-paid" })}>
                            <Banknote className="h-3.5 w-3.5 text-emerald-600" /> Pay
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {dialog ? (
        <ExpenseDialog
          mode={dialog.mode}
          expense={dialog.mode === "edit" ? dialog.expense : null}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void qc.invalidateQueries({ queryKey: ["accounting"] }); }}
        />
      ) : null}
    </div>
  );
}

function ExpenseStatusBadge({ status }: { status: string }) {
  const tone = status === "PAID" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : status === "APPROVED" ? "bg-teal-50 text-teal-700 border-teal-200"
    : status === "REJECTED" ? "bg-red-50 text-red-600 border-red-200"
    : "bg-amber-50 text-amber-700 border-amber-200";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>{status}</span>;
}

function ExpenseDialog({ mode, expense, onClose, onSaved }: {
  mode: "add" | "edit"; expense: ExpenseRow | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    category: expense?.category ?? "OPERATIONS",
    description: expense?.description ?? "",
    vendor: expense?.vendor ?? "",
    amount: expense ? (expense.amountMinor / 100).toFixed(2) : "",
    method: expense?.method ?? "CASH",
    incurredAt: expense?.incurredAt ?? todayIso(),
    note: expense?.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    const amountMinor = Math.round(parseFloat(form.amount) * 100);
    if (!form.description.trim()) { toast.error("Describe the expense."); return; }
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) { toast.error("Enter a valid amount."); return; }
    setBusy(true);
    try {
      if (mode === "add") {
        await apiSend("POST", "/api/accounting", {
          category: form.category, description: form.description.trim(),
          vendor: form.vendor.trim() || null, amountMinor, method: form.method,
          incurredAt: form.incurredAt, note: form.note.trim() || null,
        });
        toast.success("Expense recorded for approval.");
      } else if (expense) {
        await apiSend("PATCH", "/api/accounting", {
          id: expense.id, action: "update", category: form.category,
          description: form.description.trim(), vendor: form.vendor.trim() || null,
          amountMinor, method: form.method, incurredAt: form.incurredAt, note: form.note.trim() || null,
        });
        toast.success("Expense updated.");
      }
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "Record expense" : "Edit expense"}</DialogTitle>
          <DialogDescription>
            {mode === "add" ? "New expenses start as PENDING until the accountant approves them." : "Paid or rejected expenses can no longer be edited."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="exp-desc">Description</Label>
            <Input id="exp-desc" value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Generator diesel refill" maxLength={300} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="exp-amount">Amount</Label>
              <Input id="exp-amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0.00" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-date">Date incurred</Label>
              <Input id="exp-date" type="date" value={form.incurredAt} onChange={(e) => set({ incurredAt: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => set({ category: v })}>
                <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Payment method</Label>
              <Select value={form.method} onValueChange={(v) => set({ method: v })}>
                <SelectTrigger aria-label="Payment method"><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-vendor">Vendor (optional)</Label>
            <Input id="exp-vendor" value={form.vendor} onChange={(e) => set({ vendor: e.target.value })} placeholder="Supplier or payee" maxLength={160} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-note">Note (optional)</Label>
            <Textarea id="exp-note" value={form.note} onChange={(e) => set({ note: e.target.value })} rows={2} maxLength={600} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-teal-700 hover:bg-teal-800" disabled={busy} onClick={() => void submit()}>
            {busy ? "Saving…" : mode === "add" ? "Record expense" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Receivables ──────────────────────────────────────────────────────────── */

function ReceivablesView() {
  const [generated, setGenerated] = useState<{ from: string; to: string } | null>({ from: daysAgoIso(89), to: todayIso() });
  const query = useQuery({
    queryKey: ["accounting", "summary", generated?.from, generated?.to],
    queryFn: () => apiGet<AccountingSummary>(`/api/accounting?view=summary&from=${generated?.from}&to=${generated?.to}`),
    enabled: !!generated,
  });
  const d = query.data;

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState message={(query.error as Error)?.message} onRetry={() => void query.refetch()} />;
  if (!d) return null;

  return (
    <div className="space-y-4 print-area">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Total outstanding" value={formatMoney(d.outstandingMinor, d.currency)} tone={d.outstandingMinor > 0 ? "warn" : "default"} />
        <StatCard title="Current" value={formatMoney(d.aging.current, d.currency)} />
        <StatCard title="31-90 days" value={formatMoney(d.aging.d30 + d.aging.d60, d.currency)} />
        <StatCard title="Over 90 days" value={formatMoney(d.aging.d90 + d.aging.d90plus, d.currency)} tone={d.aging.d90 + d.aging.d90plus > 0 ? "warn" : "default"} />
      </div>
      <div className="overflow-hidden rounded-lg border bg-white print-area">
        {d.receivables.length === 0 ? (
          <div className="p-6"><EmptyState title="No open invoices" hint="Every issued invoice has been settled. A clean book." /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead className="text-right">Days outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.receivables.map((r) => (
                <TableRow key={r.number}>
                  <TableCell className="font-mono text-xs">{r.number}</TableCell>
                  <TableCell>{r.patient ?? "-"}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatMoney(r.dueMinor, d.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.daysOutstanding}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

/* ─── Dashboard widget: expense pipeline ───────────────────────────────────── */

export function ExpensePipelineWidget({ data }: { data: { currency: string; monthExpensesMinor: number; pendingExpenses: number; pendingExpensesMinor: number; outstandingMinor: number } | undefined }) {
  if (!data) return null;
  return (
    <section aria-label="Expense pipeline" className="curvilo-card curvilo-rise rounded-xl border bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <TrendingDown className="h-4 w-4 text-amber-600" aria-hidden />
        <h2 className="text-sm font-semibold">Expense pipeline</h2>
        <Wallet className="ml-auto h-3.5 w-3.5 text-stone-400" aria-hidden />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-stone-50 p-2">
          <div className="text-[11px] text-muted-foreground">Booked this month</div>
          <div className="font-semibold tabular-nums">{formatMoney(data.monthExpensesMinor, data.currency)}</div>
        </div>
        <div className="rounded-lg bg-amber-50/70 p-2">
          <div className="text-[11px] text-muted-foreground">Awaiting approval</div>
          <div className="font-semibold tabular-nums">{formatMoney(data.pendingExpensesMinor, data.currency)} <span className="text-xs font-normal">({data.pendingExpenses})</span></div>
        </div>
      </div>
    </section>
  );
}
