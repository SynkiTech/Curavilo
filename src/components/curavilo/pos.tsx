"use client";

// POS / Pharmacy: sell, hold/resume, history + receipt recovery, returns/refunds (spec §21)
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Minus, Plus, ScanBarcode, ShoppingCart as CartIcon, Trash2,
  PauseCircle, History, Undo2, Archive, RefreshCcw, Ban, RotateCcw, Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { apiGet, apiSend, formatMoney, formatDateTime, type InventoryItem, type Sale, type SaleForReturn, type HeldSale } from "./api";
import { LoadingState, ErrorState, EmptyState, PageHeader } from "./ui-kit";
import { useApp } from "./store";
import { DocumentRenderer, type ReceiptDocData } from "./print";
import { toast } from "sonner";

interface CartLine { item: InventoryItem; qty: number }
interface HeldLine { itemId: string; name: string; sku?: string | null; quantity: number; unitPriceMinor: number }

type Tab = "sell" | "held" | "history" | "returns";

const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash", TRANSFER: "Transfer", CARD: "Card", MOBILE: "Mobile money", CREDIT: "Store credit",
};

export function POS() {
  const { session } = useApp();
  const user = session?.user;
  const canRefund = user?.permissions.includes("pos:refund");
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>("sell");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [receipt, setReceipt] = useState<ReceiptDocData | null>(null);
  const [returnSaleId, setReturnSaleId] = useState<string | null>(null);

  const subtotalMinor = cart.reduce((s, l) => s + l.item.sellingPriceMinor * l.qty, 0);
  const discountMinor = Math.min(Math.round((parseFloat(discount || "0") || 0) * 100), subtotalMinor);
  const totalMinor = subtotalMinor - discountMinor;

  const summary = useQuery({
    queryKey: ["pos-summary"],
    queryFn: () => apiGet<{ summary: { count: number; grossMinor: number; returnsCount: number; returnsMinor: number; netMinor: number; voidedCount: number } }>("/api/sales?summary=1"),
    refetchInterval: 60_000,
  });

  const held = useQuery({
    queryKey: ["pos-held"],
    queryFn: () => apiGet<{ held: HeldSale[] }>("/api/sales?held=1"),
    refetchInterval: 60_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["pos-items"] });
    queryClient.invalidateQueries({ queryKey: ["sales"] });
    queryClient.invalidateQueries({ queryKey: ["pos-summary"] });
    queryClient.invalidateQueries({ queryKey: ["pos-held"] });
  };

  const resumeHeld = (h: HeldSale) => {
    try {
      const lines = JSON.parse(h.itemsJson) as HeldLine[];
      // Re-hydrate against live inventory so current prices/stock win.
      apiGet<{ items: InventoryItem[] }>("/api/inventory").then((res) => {
        const map = new Map(res.items.map((i) => [i.id, i]));
        const next: CartLine[] = [];
        for (const l of lines) {
          const live = map.get(l.itemId);
          if (live && (live.stockOnHand ?? 0) > 0) {
            next.push({ item: live, qty: Math.min(l.quantity, live.stockOnHand ?? l.quantity) });
          } else if (live) {
            next.push({ item: live, qty: 1 });
          }
        }
        setCart(next);
        setDiscount(((h.discountMinor ?? 0) / 100).toFixed(2));
        setCustomerName(h.customerName ?? "");
        setTab("sell");
        toast.success(`Resumed parked sale with ${next.length} line(s).`);
      }).catch(() => toast.error("Could not load inventory to resume the sale."));
    } catch {
      toast.error("Parked sale data is unreadable.");
    }
  };

  const discardHeld = useMutation({
    mutationFn: (heldId: string) => apiSend("DELETE", `/api/sales?heldId=${heldId}`),
    onSuccess: () => {
      toast.success("Parked sale discarded.");
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const checkoutDone = (sale: Sale) => {
    setReceipt({
      kind: "SALE_RECEIPT",
      number: sale.number,
      issuedTo: sale.customerName || "Walk-in customer",
      dateTime: formatDateTime(sale.createdAt, user?.timezone),
      cashier: user?.name ?? "",
      lines: (sale.items ?? []).map((i) => ({ name: i.name, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, totalMinor: i.totalMinor })),
      subtotalMinor: sale.subtotalMinor,
      discountMinor: sale.discountMinor,
      totalMinor: sale.totalMinor,
      amountPaidMinor: sale.amountPaidMinor ?? sale.totalMinor,
      method: sale.method,
    });
  };

  const startReturn = (saleId: string) => {
    setReturnSaleId(saleId);
    setTab("returns");
  };

  const heldCount = held.data?.held.length ?? 0;

  return (
    <div>
      <PageHeader title="POS / Pharmacy" subtitle="Sell, park sales, reprint receipts, process returns. Stock deducts FEFO inside one transaction." />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryChip label="Sales today" value={String(summary.data?.summary.count ?? 0)} />
        <SummaryChip label="Gross" value={formatMoney(summary.data?.summary.grossMinor ?? 0, user?.currency)} />
        <SummaryChip label="Returns" value={`${summary.data?.summary.returnsCount ?? 0} / ${formatMoney(summary.data?.summary.returnsMinor ?? 0, user?.currency)}`} />
        <SummaryChip label="Net takings" value={formatMoney(summary.data?.summary.netMinor ?? 0, user?.currency)} strong />
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border bg-white p-1 text-sm" role="tablist" aria-label="POS sections">
        {([
          ["sell", "Sell", <CartIcon key="i" className="h-3.5 w-3.5" />],
          ["held", `Parked${heldCount ? ` (${heldCount})` : ""}`, <PauseCircle key="i" className="h-3.5 w-3.5" />],
          ["history", "Sales history", <History key="i" className="h-3.5 w-3.5" />],
          ["returns", "Returns & refunds", <Undo2 key="i" className="h-3.5 w-3.5" />],
        ] as [Tab, string, React.ReactNode][]).map(([key, label, icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 transition ${tab === key ? "bg-teal-700 font-medium text-white shadow-sm" : "text-muted-foreground hover:bg-stone-100"}`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === "sell" ? (
        <SellTab
          cart={cart} setCart={setCart}
          discount={discount} setDiscount={setDiscount}
          customerName={customerName} setCustomerName={setCustomerName}
          subtotalMinor={subtotalMinor} discountMinor={discountMinor} totalMinor={totalMinor}
          onCompleted={(sale) => { invalidate(); checkoutDone(sale); }}
          onHeld={() => { setCart([]); setDiscount(""); setCustomerName(""); invalidate(); toast.success("Sale parked. Resume it any time from the Parked tab."); }}
          canRefund={!!canRefund}
        />
      ) : null}

      {tab === "held" ? (
        <HeldTab
          held={held.data?.held ?? []}
          isLoading={held.isLoading}
          onResume={resumeHeld}
          onDiscard={(id) => discardHeld.mutate(id)}
          busy={discardHeld.isPending}
        />
      ) : null}

      {tab === "history" ? (
        <HistoryTab
          canRefund={!!canRefund}
          onReprint={(sale) => setReceipt(saleReceipt(sale, user?.name ?? "", user?.timezone, true))}
          onVoid={invalidate}
          onStartReturn={startReturn}
        />
      ) : null}

      {tab === "returns" ? (
        <ReturnsTab
          initialSaleId={returnSaleId}
          onDone={(creditNote) => {
            invalidate();
            setReceipt({
              kind: "CREDIT_NOTE",
              number: creditNote.number,
              issuedTo: creditNote.saleNumber,
              dateTime: formatDateTime(creditNote.createdAt, user?.timezone),
              cashier: user?.name ?? "",
              lines: (creditNote.items ?? []).map((i) => ({ name: i.name, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, totalMinor: i.totalMinor })),
              subtotalMinor: creditNote.totalMinor,
              discountMinor: 0,
              totalMinor: creditNote.totalMinor,
              amountPaidMinor: creditNote.totalMinor,
              method: creditNote.method,
              reference: `Original sale ${creditNote.saleNumber}`,
            });
          }}
        />
      ) : null}

      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{receipt?.kind === "CREDIT_NOTE" ? "Credit note" : "Sale receipt"}</DialogTitle>
            <DialogDescription>Thermal 80mm selected by default - choose another profile if needed.</DialogDescription>
          </DialogHeader>
          {receipt ? (
            <DocumentRenderer
              branding={{
                orgName: user?.orgName ?? "",
                facilityName: user?.facilityName ?? "",
                address: session?.branding?.address ?? null,
                phone: session?.branding?.phone ?? null,
                logoData: session?.branding?.logoData ?? null,
                receiptFooter: session?.branding?.receiptFooter ?? null,
                timezone: user?.timezone ?? "Africa/Lagos",
                currency: user?.currency ?? "NGN",
              }}
              data={receipt}
              defaultProfile="THERMAL_80MM"
              onPrinted={() => apiSend("POST", "/api/audit", { event: "document.printed", docNumber: receipt.number, docType: receipt.kind, printProfile: "THERMAL_80MM" }).catch(() => undefined)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function saleReceipt(sale: Sale, cashier: string, timezone?: string, reprint = false): ReceiptDocData {
  return {
    kind: "SALE_RECEIPT",
    number: sale.number,
    issuedTo: sale.customerName || "Walk-in customer",
    dateTime: formatDateTime(sale.createdAt, timezone),
    cashier,
    lines: (sale.items ?? []).map((i) => ({ name: i.name, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, totalMinor: i.totalMinor })),
    subtotalMinor: sale.subtotalMinor,
    discountMinor: sale.discountMinor,
    totalMinor: sale.totalMinor,
    amountPaidMinor: sale.amountPaidMinor ?? sale.totalMinor,
    method: sale.method,
    reprint,
    status: sale.status,
  };
}

function SummaryChip({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-lg border bg-white px-3 py-2 ${strong ? "border-teal-200 bg-teal-50/60" : ""}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm tabular-nums ${strong ? "font-bold text-teal-800" : "font-semibold"}`}>{value}</div>
    </div>
  );
}

/* ─── Sell tab ──────────────────────────────────────────────────────────── */

function SellTab({
  cart, setCart, discount, setDiscount, customerName, setCustomerName,
  subtotalMinor, discountMinor, totalMinor, onCompleted, onHeld,
}: {
  cart: CartLine[]; setCart: React.Dispatch<React.SetStateAction<CartLine[]>>;
  discount: string; setDiscount: (v: string) => void;
  customerName: string; setCustomerName: (v: string) => void;
  subtotalMinor: number; discountMinor: number; totalMinor: number;
  onCompleted: (sale: Sale) => void; onHeld: () => void; canRefund: boolean;
}) {
  const { session } = useApp();
  const user = session?.user;
  const [query, setQuery] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [busyHold, setBusyHold] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["pos-items", query],
    queryFn: () => apiGet<{ items: InventoryItem[] }>(`/api/inventory?q=${encodeURIComponent(query)}`),
  });

  const addToCart = (item: InventoryItem) => {
    setCart((prev) => {
      const found = prev.find((l) => l.item.id === item.id);
      if (found) {
        return prev.map((l) => (l.item.id === item.id ? { ...l, qty: Math.min(l.qty + 1, (item.stockOnHand ?? 0) || 1) } : l));
      }
      return [...prev, { item, qty: 1 }];
    });
  };

  const hold = async () => {
    setBusyHold(true);
    try {
      await apiSend("PATCH", "/api/sales", {
        action: "HOLD",
        customerName: customerName.trim() || null,
        discountMinor,
        items: cart.map((l) => ({ itemId: l.item.id, name: l.item.name, sku: l.item.sku, quantity: l.qty, unitPriceMinor: l.item.sellingPriceMinor })),
      });
      onHeld();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyHold(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <div className="mb-3 flex items-center gap-2">
          <ScanBarcode className="h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Scan barcode or search name/generic/SKU... (Enter adds first match)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && data?.items.length) {
                addToCart(data.items[0]);
                setQuery("");
              }
            }}
            aria-label="Scan or search items"
          />
        </div>

        {isLoading ? <LoadingState /> : null}
        {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}
        {data ? (
          data.items.length === 0 ? (
            <EmptyState title="No items found" hint="Add items in Inventory first." />
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {data.items.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => addToCart(item)}
                    className="w-full rounded-lg border bg-white p-3 text-left transition hover:border-teal-500 hover:shadow-sm disabled:opacity-40"
                    disabled={(item.stockOnHand ?? 0) <= 0}
                  >
                    <div className="truncate text-sm font-medium">{item.name}</div>
                    <div className="text-[11px] text-muted-foreground">{item.sku} · {(item.stockOnHand ?? 0)} in stock</div>
                    <div className="mt-1 text-sm font-semibold tabular-nums">{formatMoney(item.sellingPriceMinor, user?.currency ?? "NGN")}</div>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      <div className="lg:col-span-2">
        <div className="rounded-lg border bg-white" aria-label="Cart">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <CartIcon className="h-4 w-4 text-teal-700" aria-hidden />
            <h2 className="text-sm font-semibold">Cart ({cart.length})</h2>
            {cart.length > 0 ? (
              <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs text-red-600" onClick={() => setCart([])}>Clear</Button>
            ) : null}
          </div>
          <ul className="divide-y">
            {cart.length === 0 ? (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">Cart is empty - tap items to add.</li>
            ) : (
              cart.map((line) => (
                <li key={line.item.id} className="flex items-center gap-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{line.item.name}</div>
                    <div className="text-xs tabular-nums text-muted-foreground">{formatMoney(line.item.sellingPriceMinor, user?.currency ?? "NGN")} × {line.qty}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-7 w-7" aria-label={`Decrease ${line.item.name}`} onClick={() => setCart((p) => p.map((l) => (l.item.id === line.item.id ? { ...l, qty: Math.max(1, l.qty - 1) } : l)))}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-6 text-center text-sm tabular-nums">{line.qty}</span>
                    <Button variant="outline" size="icon" className="h-7 w-7" aria-label={`Increase ${line.item.name}`} onClick={() => setCart((p) => p.map((l) => (l.item.id === line.item.id ? { ...l, qty: l.qty + 1 } : l)))}>
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-stone-400" aria-label={`Remove ${line.item.name}`} onClick={() => setCart((p) => p.filter((l) => l.item.id !== line.item.id))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))
            )}
          </ul>
          <div className="space-y-2 border-t px-4 py-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="pos-customer" className="w-24 shrink-0 text-muted-foreground">Customer</Label>
              <Input id="pos-customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="h-8" placeholder="Walk-in customer" />
            </div>
            <div className="flex items-center justify-between text-sm">
              <Label htmlFor="pos-discount" className="text-muted-foreground">Discount</Label>
              <Input id="pos-discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} className="h-8 w-24 text-right" placeholder="0.00" />
            </div>
            <div className="flex items-center justify-between border-t pt-2 text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(totalMinor, user?.currency)}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled={cart.length === 0 || busyHold} onClick={() => void hold()} title="Park this sale and resume later">
                {busyHold ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PauseCircle className="mr-2 h-4 w-4" />} Hold
              </Button>
              <Button className="flex-[2] bg-teal-700 hover:bg-teal-800" disabled={cart.length === 0} onClick={() => setPayOpen(true)}>
                Charge {formatMoney(totalMinor, user?.currency)}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <CheckoutDialog
        open={payOpen} onOpenChange={setPayOpen}
        totalMinor={totalMinor} discountMinor={discountMinor} cart={cart}
        customerName={customerName} setCustomerName={setCustomerName}
        onCompleted={(sale) => {
          setCart([]);
          setDiscount("");
          setCustomerName("");
          onCompleted(sale);
        }}
      />
    </div>
  );
}

function CheckoutDialog({ open, onOpenChange, totalMinor, discountMinor, cart, customerName, setCustomerName, onCompleted }: {
  open: boolean; onOpenChange: (o: boolean) => void; totalMinor: number; discountMinor: number; cart: CartLine[];
  customerName: string; setCustomerName: (v: string) => void; onCompleted: (sale: Sale) => void;
}) {
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const [tendered, setTendered] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tenderedMinor = Math.round((parseFloat(tendered || "0") || 0) * 100);
  const changeMinor = method === "CASH" && tenderedMinor > 0 ? tenderedMinor - totalMinor : 0;
  const cashShort = method === "CASH" && tenderedMinor > 0 && tenderedMinor < totalMinor;

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const idempotencyKey = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await apiSend<{ sale: Sale; idempotentReplay: boolean }>("POST", "/api/sales", {
        customerName: customerName.trim() || null,
        items: cart.map((l) => ({ itemId: l.item.id, quantity: l.qty, unitPriceMinor: l.item.sellingPriceMinor })),
        discountMinor,
        method,
        reference: reference.trim() || null,
        amountTenderedMinor: method === "CASH" && tenderedMinor > 0 ? tenderedMinor : null,
        idempotencyKey,
      });
      if (res.idempotentReplay) {
        toast.info(`Sale ${res.sale.number} was already recorded.`);
      } else {
        toast.success(`Sale ${res.sale.number} completed.`);
      }
      if (method === "CASH" && changeMinor > 0) {
        toast.info(`Change due: ${formatMoney(changeMinor)}`);
      }
      onCompleted(res.sale);
      onOpenChange(false);
      setReference("");
      setTendered("");
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
          <DialogTitle>Charge {formatMoney(totalMinor)}</DialogTitle>
          <DialogDescription>Stock deducts from the earliest-expiring lots (FEFO) inside one transaction.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pos-method">Payment method</Label>
            <select id="pos-method" value={method} onChange={(e) => setMethod(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm">
              {Object.entries(METHOD_LABEL).filter(([k]) => k !== "CREDIT").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {method === "CASH" ? (
            <div className="space-y-1">
              <Label htmlFor="pos-tendered">Cash tendered</Label>
              <Input id="pos-tendered" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder="0.00" className="text-right" />
              {tenderedMinor > 0 ? (
                <p className={`text-sm font-semibold tabular-nums ${cashShort ? "text-red-600" : "text-emerald-700"}`}>
                  {cashShort ? `Short by ${formatMoney(totalMinor - tenderedMinor)}` : `Change due: ${formatMoney(changeMinor)}`}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="pos-ref">Payment reference</Label>
              <Input id="pos-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction / auth code" />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="pos-customer2">Customer name (optional)</Label>
            <Input id="pos-customer2" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </div>
          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button className="w-full bg-teal-700 hover:bg-teal-800" disabled={busy || cashShort} onClick={() => void pay()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Complete sale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Parked sales ──────────────────────────────────────────────────────── */

function HeldTab({ held, isLoading, onResume, onDiscard, busy }: {
  held: HeldSale[]; isLoading: boolean;
  onResume: (h: HeldSale) => void; onDiscard: (id: string) => void; busy: boolean;
}) {
  const { session } = useApp();
  const tz = session?.user?.timezone;
  if (isLoading) return <LoadingState />;
  if (held.length === 0) {
    return <EmptyState title="No parked sales" hint="Use the Hold button on the Sell tab to park a sale and resume it later." />;
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Parked at</TableHead>
            <TableHead>Label / customer</TableHead>
            <TableHead className="hidden sm:table-cell">Lines</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {held.map((h) => {
            const lines = (() => { try { return (JSON.parse(h.itemsJson) as HeldLine[]).length; } catch { return 0; } })();
            return (
              <TableRow key={h.id}>
                <TableCell className="text-xs text-muted-foreground">{formatDateTime(h.createdAt, tz)}</TableCell>
                <TableCell className="font-medium">{h.label || h.customerName || "Walk-in customer"}</TableCell>
                <TableCell className="hidden sm:table-cell">{lines}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(h.totalMinor)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" className="text-teal-700" onClick={() => onResume(h)}><Play className="mr-1 h-3.5 w-3.5" /> Resume</Button>
                    <Button size="sm" variant="ghost" className="text-red-600" disabled={busy} onClick={() => onDiscard(h.id)}><Trash2 className="mr-1 h-3.5 w-3.5" /> Discard</Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ─── Sales history + receipt recovery + void ───────────────────────────── */

function HistoryTab({ canRefund, onReprint, onVoid, onStartReturn }: {
  canRefund: boolean;
  onReprint: (sale: Sale) => void;
  onVoid: () => void;
  onStartReturn: (saleId: string) => void;
}) {
  const { session } = useApp();
  const user = session?.user;
  const [q, setQ] = useState("");
  const [voidTarget, setVoidTarget] = useState<Sale | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["sales", q],
    queryFn: () => apiGet<{ sales: Sale[] }>(`/api/sales?limit=100&q=${encodeURIComponent(q)}`),
    refetchInterval: 60_000,
  });

  const voidMutation = useMutation({
    mutationFn: ({ saleId, reason }: { saleId: string; reason: string }) =>
      apiSend("PATCH", "/api/sales", { action: "VOID", saleId, reason }),
    onSuccess: () => {
      toast.success("Sale voided and stock returned.");
      setVoidTarget(null);
      onVoid();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Input placeholder="Search by receipt number or customer..." value={q} onChange={(e) => setQ(e.target.value)} className="w-72" aria-label="Search sales" />
        <Button variant="outline" size="sm" onClick={() => void refetch()}><RefreshCcw className="mr-1 h-3.5 w-3.5" /> Refresh</Button>
      </div>

      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}
      {data ? (
        data.sales.length === 0 ? (
          <EmptyState title="No sales found" hint="Completed POS sales appear here with their receipts." />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead className="hidden sm:table-cell">Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden md:table-cell">Items</TableHead>
                  <TableHead className="hidden md:table-cell">Method</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.sales.map((s) => (
                  <TableRow key={s.id} className={s.status === "VOID" ? "opacity-50" : ""}>
                    <TableCell className="font-mono text-xs">
                      {s.number}
                      {s.status === "VOID" ? <Badge variant="outline" className="ml-2 text-[10px] text-red-600">VOID</Badge> : null}
                      {(s.returns?.length ?? 0) > 0 ? <Badge variant="outline" className="ml-1 text-[10px] text-amber-600">PART-RETURNED</Badge> : null}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{formatDateTime(s.createdAt, user?.timezone)}</TableCell>
                    <TableCell>{s.customerName || "Walk-in"}</TableCell>
                    <TableCell className="hidden md:table-cell">{(s.items ?? []).length}</TableCell>
                    <TableCell className="hidden md:table-cell text-xs">{METHOD_LABEL[s.method] ?? s.method}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(s.totalMinor, user?.currency)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => onReprint(s)}><Archive className="mr-1 h-3.5 w-3.5" /> Receipt</Button>
                        {canRefund && s.status === "COMPLETED" ? (
                          <>
                            <Button size="sm" variant="ghost" className="text-amber-700" onClick={() => onStartReturn(s.id)}><Undo2 className="mr-1 h-3.5 w-3.5" /> Return</Button>
                            <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setVoidTarget(s)}><Ban className="mr-1 h-3.5 w-3.5" /> Void</Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : null}

      <Dialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Void sale {voidTarget?.number}</DialogTitle>
            <DialogDescription>The full sale is reversed and all items return to stock. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <VoidForm busy={voidMutation.isPending} onSubmit={(reason) => voidTarget && voidMutation.mutate({ saleId: voidTarget.id, reason })} onCancel={() => setVoidTarget(null)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VoidForm({ busy, onSubmit, onCancel }: { busy: boolean; onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="void-reason">Reason *</Label>
        <Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong items, customer changed mind" />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button className="bg-red-600 hover:bg-red-700" disabled={busy || reason.trim().length < 3} onClick={() => onSubmit(reason.trim())}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Void sale
        </Button>
      </DialogFooter>
    </div>
  );
}

/* ─── Returns / refunds (drug returns) ──────────────────────────────────── */

function ReturnsTab({ initialSaleId, onDone }: { initialSaleId: string | null; onDone: (creditNote: { number: string; saleNumber: string; method: string; totalMinor: number; createdAt: string; items?: { name: string; quantity: number; unitPriceMinor: number; totalMinor: number }[] }) => void }) {
  const { session } = useApp();
  const user = session?.user;
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<SaleForReturn | null>(null);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("CASH");
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load a sale passed from History.
  const [loadedInitial, setLoadedInitial] = useState<string | null>(null);
  if (initialSaleId && initialSaleId !== loadedInitial && !selected) {
    setLoadedInitial(initialSaleId);
    apiGet<SaleForReturn>(`/api/sales?forReturn=${initialSaleId}`)
      .then((res) => { setSelected(res); setQtys({}); })
      .catch((e) => toast.error((e as Error).message));
  }

  const search = useQuery({
    queryKey: ["return-search", q],
    queryFn: () => apiGet<{ sales: Sale[] }>(`/api/sales?limit=20&q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });

  const returnsHistory = useQuery({
    queryKey: ["returns-history"],
    queryFn: () => apiGet<{ returns: { id: string; number: string; saleNumber: string; reason: string; method: string; totalMinor: number; createdAt: string; restocked: boolean }[] }>("/api/sales?returns=1"),
  });

  const pick = async (saleId: string) => {
    setError(null);
    try {
      const res = await apiGet<SaleForReturn>(`/api/sales?forReturn=${saleId}`);
      setSelected(res);
      setQtys({});
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submit = async () => {
    if (!selected) return;
    const lines = Object.entries(qtys).filter(([, qty]) => qty > 0).map(([saleItemId, quantity]) => ({ saleItemId, quantity }));
    if (lines.length === 0) {
      setError("Enter at least one return quantity.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ return: { number: string; saleNumber: string; method: string; totalMinor: number; createdAt: string; items?: { name: string; quantity: number; unitPriceMinor: number; totalMinor: number }[] } }>("PATCH", "/api/sales", {
        action: "RETURN",
        saleId: selected.sale.id,
        reason: reason.trim(),
        method,
        restock,
        lines,
      });
      toast.success(`Credit note ${res.return.number} issued.`);
      setSelected(null);
      setQtys({});
      setReason("");
      onDone(res.return);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const refundTotal = selected
    ? selected.lines.reduce((s, l) => s + (qtys[l.id] ?? 0) * l.unitPriceMinor, 0)
    : 0;

  return (
    <div className="space-y-4">
      {!selected ? (
        <div className="rounded-lg border bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">Find the sale to return</h3>
          <Input
            placeholder="Search receipt number or customer..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full sm:w-96"
            aria-label="Search sales to return"
          />
          {search.isLoading ? <LoadingState /> : null}
          {q.trim().length >= 2 ? (
            <ul className="mt-2 divide-y rounded border">
              {(search.data?.sales ?? []).filter((s) => s.status === "COMPLETED").map((s) => (
                <li key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div>
                    <span className="font-mono text-xs">{s.number}</span>
                    <span className="ml-2 text-muted-foreground">{s.customerName || "Walk-in"} · {formatDateTime(s.createdAt, user?.timezone)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums">{formatMoney(s.totalMinor, user?.currency)}</span>
                    <Button size="sm" variant="outline" onClick={() => void pick(s.id)}>Select</Button>
                  </div>
                </li>
              ))}
              {(search.data?.sales ?? []).length === 0 ? <li className="px-3 py-4 text-center text-sm text-muted-foreground">No matching sales.</li> : null}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <div className="flex-1">
              <h3 className="text-sm font-semibold">Return items from {selected.sale.number}</h3>
              <p className="text-xs text-muted-foreground">
                {selected.sale.customerName || "Walk-in"} · paid by {METHOD_LABEL[selected.sale.method] ?? selected.sale.method}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setSelected(null); setQtys({}); setError(null); }}>Cancel</Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Returned</TableHead>
                <TableHead className="text-right">Return qty</TableHead>
                <TableHead className="text-right">Refund</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selected.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{l.alreadyReturned}</TableCell>
                  <TableCell className="text-right">
                    {l.returnable > 0 ? (
                      <Input
                        type="number" min={0} max={l.returnable}
                        value={qtys[l.id] ?? ""}
                        onChange={(e) => setQtys((p) => ({ ...p, [l.id]: Math.max(0, Math.min(l.returnable, parseInt(e.target.value || "0", 10) || 0)) }))}
                        className="ml-auto h-8 w-20 text-right"
                        aria-label={`Return quantity for ${l.name}`}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney((qtys[l.id] ?? 0) * l.unitPriceMinor)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="grid gap-3 border-t px-4 py-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ret-reason">Reason *</Label>
              <Input id="ret-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. expired on shelf, wrong drug, adverse reaction" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ret-method">Refund method</Label>
              <select id="ret-method" value={method} onChange={(e) => setMethod(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm">
                {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="h-4 w-4 accent-teal-700" />
              Return items to stock (uncheck for damaged/expired goods)
            </label>
            <div className="flex items-center justify-between text-base font-semibold">
              <span>Refund total</span>
              <span className="tabular-nums">{formatMoney(refundTotal, user?.currency)}</span>
            </div>
          </div>
          {error ? <p className="mx-4 mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
          <div className="border-t px-4 py-3">
            <Button className="bg-teal-700 hover:bg-teal-800" disabled={busy || refundTotal <= 0 || reason.trim().length < 3} onClick={() => void submit()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />} Issue credit note
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-white">
        <div className="border-b px-4 py-2.5 text-sm font-semibold">Recent returns</div>
        {(returnsHistory.data?.returns ?? []).length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No returns recorded yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {(returnsHistory.data?.returns ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <div>
                  <span className="font-mono text-xs">{r.number}</span>
                  <span className="ml-2 text-xs text-muted-foreground">on {r.saleNumber} · {r.reason}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{METHOD_LABEL[r.method] ?? r.method}{r.restocked ? "" : " · no restock"}</Badge>
                  <span className="tabular-nums font-semibold text-red-600">-{formatMoney(r.totalMinor, user?.currency)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
