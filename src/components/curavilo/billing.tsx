"use client";

// Billing — invoices, payments, receipts with print profiles (spec §20, §33–37)
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Printer, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiSend, formatMoney, formatDateTime, type Invoice, type Patient, type ServiceItem } from "./api";
import { LoadingState, ErrorState, EmptyState, PageHeader, StatusBadge } from "./ui-kit";
import { useApp } from "./store";
import { DocumentRenderer, type ReceiptDocData } from "./print";
import { toast } from "sonner";

export function Billing() {
  const { session, navigate } = useApp();
  const canWrite = session?.user?.permissions.includes("billing:write");
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["invoices", status],
    queryFn: () => apiGet<{ invoices: Invoice[] }>(`/api/invoices?status=${status}`),
  });

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle="Invoices, payments and outstanding balances."
        actions={
          canWrite ? (
            <Button className="bg-teal-700 hover:bg-teal-800" onClick={() => setCreateOpen(true)}>
              <ReceiptText className="mr-2 h-4 w-4" /> New invoice
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex gap-1.5">
        {["", "ISSUED", "PARTIALLY_PAID", "PAID", "VOID"].map((s) => (
          <button
            key={s || "all"}
            onClick={() => setStatus(s)}
            className={`rounded-full border px-3 py-1 text-xs transition ${status === s ? "border-teal-600 bg-teal-50 font-medium text-teal-800" : "border-stone-200 text-stone-500 hover:border-teal-400"}`}
          >
            {s ? s.replaceAll("_", " ") : "All"}
          </button>
        ))}
      </div>

      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}

      {data ? (
        data.invoices.length === 0 ? (
          <EmptyState title="No invoices" hint="Invoices appear when encounters are completed with charges, or when created manually." />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead className="hidden sm:table-cell">Date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.invoices.map((inv) => (
                  <TableRow key={inv.id} className="cursor-pointer hover:bg-stone-50" onClick={() => navigate("invoice-detail", { invoiceId: inv.id })}>
                    <TableCell className="font-mono text-xs">{inv.number}</TableCell>
                    <TableCell className="font-medium">{inv.patient ? `${inv.patient.firstName} ${inv.patient.lastName}` : "—"}</TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">{formatDateTime(inv.createdAt, session?.user?.timezone)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(inv.totalMinor, inv.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(inv.amountPaidMinor, inv.currency)}</TableCell>
                    <TableCell><StatusBadge status={inv.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : null}

      <CreateInvoiceDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => navigate("invoice-detail", { invoiceId: id })} />
    </div>
  );
}

export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const { session } = useApp();
  const user = session?.user;
  const [payOpen, setPayOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptDocData | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: () => apiGet<{ invoice: Invoice }>(`/api/invoices?id=${invoiceId}`),
  });

  if (isLoading) return <LoadingState label="Loading invoice…" />;
  if (isError) return <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />;
  if (!data || !user) return null;

  const inv = data.invoice;
  const outstanding = inv.totalMinor - inv.amountPaidMinor;

  const openReceipt = (paymentOrInvoice: "latest" | "invoice") => {
    if (paymentOrInvoice === "invoice") {
      setReceiptData({
        kind: "INVOICE",
        number: inv.number,
        issuedTo: inv.patient ? `${inv.patient.firstName} ${inv.patient.lastName} (${inv.patient.mrn})` : "—",
        dateTime: formatDateTime(inv.issuedAt ?? inv.createdAt, user.timezone),
        cashier: user.name,
        lines: (inv.items ?? []).map((i) => ({ name: i.name, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, totalMinor: i.totalMinor })),
        subtotalMinor: inv.subtotalMinor,
        discountMinor: inv.discountMinor,
        totalMinor: inv.totalMinor,
        amountPaidMinor: inv.amountPaidMinor,
        reprint: false,
      });
    } else {
      const latest = (inv.payments ?? []).filter((p) => !p.voidedAt).slice(-1)[0];
      if (!latest) return;
      setReceiptData({
        kind: "RECEIPT",
        number: latest.number,
        issuedTo: inv.patient ? `${inv.patient.firstName} ${inv.patient.lastName} (${inv.patient.mrn})` : "—",
        dateTime: formatDateTime(latest.createdAt, user.timezone),
        cashier: user.name,
        lines: (inv.items ?? []).map((i) => ({ name: i.name, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, totalMinor: i.totalMinor })),
        subtotalMinor: inv.subtotalMinor,
        discountMinor: inv.discountMinor,
        totalMinor: inv.totalMinor,
        amountPaidMinor: latest.amountMinor,
        method: latest.method,
        reference: latest.reference,
        reprint: false,
      });
    }
    setReceiptOpen(true);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{inv.number}</h1>
            <StatusBadge status={inv.status} />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {inv.patient ? `${inv.patient.firstName} ${inv.patient.lastName} (${inv.patient.mrn})` : "—"} · issued {formatDateTime(inv.issuedAt ?? inv.createdAt, user.timezone)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => openReceipt("invoice")}><Printer className="mr-1.5 h-4 w-4" /> Print invoice</Button>
          {inv.amountPaidMinor > 0 ? (
            <Button variant="outline" size="sm" onClick={() => openReceipt("latest")}><Printer className="mr-1.5 h-4 w-4" /> Print receipt</Button>
          ) : null}
          {user.permissions.includes("payments:record") && inv.status !== "PAID" && inv.status !== "VOID" ? (
            <Button size="sm" className="bg-teal-700 hover:bg-teal-800" onClick={() => setPayOpen(true)}>Record payment</Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(inv.items ?? []).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(item.unitPriceMinor, inv.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(item.totalMinor, inv.currency)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={3} className="text-right text-muted-foreground">Subtotal</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(inv.subtotalMinor, inv.currency)}</TableCell>
                </TableRow>
                {inv.discountMinor > 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-right text-muted-foreground">Discount</TableCell>
                    <TableCell className="text-right tabular-nums text-red-600">-{formatMoney(inv.discountMinor, inv.currency)}</TableCell>
                  </TableRow>
                ) : null}
                <TableRow className="font-semibold">
                  <TableCell colSpan={3} className="text-right">Total</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(inv.totalMinor, inv.currency)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border bg-white p-4">
            <h2 className="text-sm font-semibold">Balance</h2>
            <div className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="tabular-nums">{formatMoney(inv.totalMinor, inv.currency)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="tabular-nums">{formatMoney(inv.amountPaidMinor, inv.currency)}</span></div>
              <div className="flex justify-between border-t pt-1 font-semibold"><span>Outstanding</span><span className={`tabular-nums ${outstanding > 0 ? "text-amber-600" : "text-emerald-600"}`}>{formatMoney(outstanding, inv.currency)}</span></div>
            </div>
          </div>

          <div className="rounded-lg border bg-white">
            <div className="border-b px-4 py-2.5 text-sm font-semibold">Payments</div>
            {(inv.payments ?? []).length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No payments yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {(inv.payments ?? []).map((p) => (
                  <li key={p.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">{p.number}</span>
                      <span className={`tabular-nums ${p.voidedAt ? "text-stone-400 line-through" : "font-medium"}`}>{formatMoney(p.amountMinor, p.currency)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{p.method} · {formatDateTime(p.createdAt, user.timezone)}{p.voidedAt ? " · VOIDED" : ""}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <PayDialog open={payOpen} onOpenChange={setPayOpen} invoice={inv} outstanding={outstanding}
        onPaid={(payment) => {
          queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
          queryClient.invalidateQueries({ queryKey: ["invoices"] });
          setReceiptData({
            kind: "RECEIPT",
            number: payment.number,
            issuedTo: inv.patient ? `${inv.patient.firstName} ${inv.patient.lastName} (${inv.patient.mrn})` : "—",
            dateTime: formatDateTime(payment.createdAt, user.timezone),
            cashier: user.name,
            lines: (inv.items ?? []).map((i) => ({ name: i.name, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, totalMinor: i.totalMinor })),
            subtotalMinor: inv.subtotalMinor,
            discountMinor: inv.discountMinor,
            totalMinor: inv.totalMinor,
            amountPaidMinor: payment.amountMinor,
            method: payment.method,
            reference: payment.reference,
          });
          setReceiptOpen(true);
        }} />

      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Print document</DialogTitle>
            <DialogDescription>Choose a print profile — receipts default to thermal width.</DialogDescription>
          </DialogHeader>
          {receiptData ? (
            <DocumentRenderer
              branding={{
                orgName: user.orgName,
                facilityName: user.facilityName,
                address: session?.branding?.address ?? null,
                phone: session?.branding?.phone ?? null,
                email: session?.branding?.email ?? null,
                logoData: session?.branding?.logoData ?? null,
                reportFooter: session?.branding?.reportFooter ?? null,
                receiptFooter: session?.branding?.receiptFooter ?? null,
                timezone: user.timezone,
                currency: user.currency,
              }}
              data={receiptData}
              defaultProfile={receiptData.kind === "INVOICE" ? "A4_STANDARD" : "THERMAL_80MM"}
              onPrinted={() => {
                apiSend("POST", "/api/audit", {
                  event: "document.printed",
                  docNumber: receiptData.number,
                  docType: receiptData.kind,
                  printProfile: "SELECTED",
                }).catch(() => undefined);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {actionError ? null : null}
    </div>
  );
}

interface PaymentLike { number: string; method: string; amountMinor: number; currency: string; reference?: string | null; createdAt: string }

function PayDialog({ open, onOpenChange, invoice, outstanding, onPaid }: {
  open: boolean; onOpenChange: (o: boolean) => void; invoice: Invoice; outstanding: number; onPaid: (p: PaymentLike) => void;
}) {
  const [amount, setAmount] = useState((outstanding / 100).toFixed(2));
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const idempotencyKey = `pay-${invoice.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await apiSend<{ payment: PaymentLike }>("PATCH", `/api/invoices?id=${invoice.id}`, {
        action: "PAY",
        amountMinor: Math.round(parseFloat(amount || "0") * 100),
        method,
        reference: reference.trim() || null,
        idempotencyKey,
      });
      onPaid(res.payment);
      onOpenChange(false);
      toast.success(`Payment ${res.payment.number} recorded.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Outstanding balance: {formatMoney(outstanding, invoice.currency)}. Partial payments are supported.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pay-amount">Amount (major units)</Label>
            <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pay-method">Method</Label>
            <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm">
              <option value="CASH">Cash</option>
              <option value="TRANSFER">Transfer</option>
              <option value="CARD">Card</option>
              <option value="MOBILE">Mobile money</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pay-ref">Reference</Label>
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. transfer ref" />
          </div>
          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAmount((outstanding / 100).toFixed(2))} disabled={busy}>Full amount</Button>
          <Button className="bg-teal-700 hover:bg-teal-800" disabled={busy || !parseFloat(amount)} onClick={() => void pay()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateInvoiceDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [patientId, setPatientId] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, { qty: number }>>({});
  const [discount, setDiscount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: patients } = useQuery({
    queryKey: ["patients", query],
    queryFn: () => apiGet<{ patients: Patient[] }>(`/api/patients?q=${encodeURIComponent(query)}&limit=8`),
    enabled: open,
  });
  const { data: services } = useQuery({
    queryKey: ["services"],
    queryFn: () => apiGet<{ services: ServiceItem[] }>("/api/services"),
    enabled: open,
  });
  const selectedServices = (services?.services ?? []).filter((s) => lines[s.id]);
  const subtotalMinor = selectedServices.reduce((sum, s) => sum + s.priceMinor * (lines[s.id]?.qty ?? 1), 0);
  const discountMinor = Math.round((parseFloat(discount || "0") || 0) * 100);
  const valid = patientId && selectedServices.length > 0 && discountMinor >= 0 && discountMinor <= subtotalMinor;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ invoice: Invoice }>("POST", "/api/invoices", {
        patientId,
        items: selectedServices.map((s) => ({
          serviceItemId: s.id,
          name: s.name,
          quantity: lines[s.id]?.qty ?? 1,
          unitPriceMinor: s.priceMinor,
        })),
        discountMinor,
      });
      onCreated(res.invoice.id);
      onOpenChange(false);
      setLines({});
      setDiscount("");
      setPatientId(null);
      setQuery("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>Pick a patient and services from the catalogue. Encounter-based invoices are created automatically.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="inv-patient">Patient *</Label>
          <Input id="inv-patient" placeholder="Search name, MRN or phone…" value={query} onChange={(e) => { setQuery(e.target.value); setPatientId(null); }} />
          {patients && patients.patients.length > 0 ? (
            <ul className="max-h-36 space-y-0.5 overflow-y-auto rounded-md border p-1">
              {patients.patients.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => { setPatientId(p.id); setQuery(`${p.firstName} ${p.lastName} (${p.mrn})`); }}
                    className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-stone-50 ${patientId === p.id ? "bg-teal-50 font-medium" : ""}`}
                  >
                    {p.firstName} {p.lastName} <span className="text-xs text-muted-foreground">{p.mrn}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label>Services</Label>
          <ul className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
            {(services?.services ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                <label className="flex flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-teal-700"
                    checked={!!lines[s.id]}
                    aria-label={s.name}
                    onChange={(e) => {
                      const next = { ...lines };
                      if (e.target.checked) next[s.id] = { qty: 1 };
                      else delete next[s.id];
                      setLines(next);
                    }}
                  />
                  {s.name}
                </label>
                {lines[s.id] ? (
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={lines[s.id].qty}
                    aria-label={`Quantity for ${s.name}`}
                    onChange={(e) => setLines({ ...lines, [s.id]: { qty: Math.max(1, parseInt(e.target.value || "1", 10)) } })}
                    className="h-7 w-14 rounded border px-1 text-right text-xs"
                  />
                ) : null}
                <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">{formatMoney(s.priceMinor, "NGN")}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="inv-discount">Discount (major units)</Label>
            <Input id="inv-discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
          <div className="flex items-end justify-between rounded-md border bg-stone-50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold tabular-nums">{formatMoney(subtotalMinor - discountMinor, "NGN")}</span>
          </div>
        </div>
        {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
        <DialogFooter>
          <Button className="bg-teal-700 hover:bg-teal-800" disabled={!valid || busy} onClick={() => void create()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Create invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
