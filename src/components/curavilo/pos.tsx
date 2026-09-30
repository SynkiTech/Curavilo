"use client";

// POS / Pharmacy — cart, payment, transactional sale + receipt (spec §21)
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Minus, Plus, ScanBarcode, ShoppingCart as CartIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiGet, apiSend, formatMoney, formatDateTime, type InventoryItem, type Sale } from "./api";
import { LoadingState, ErrorState, EmptyState, PageHeader } from "./ui-kit";
import { useApp } from "./store";
import { DocumentRenderer, type ReceiptDocData } from "./print";
import { toast } from "sonner";

interface CartLine { item: InventoryItem; qty: number }

export function POS() {
  const { session } = useApp();
  const user = session?.user;
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptDocData | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["pos-items", query],
    queryFn: () => apiGet<{ items: InventoryItem[] }>(`/api/inventory?q=${encodeURIComponent(query)}`),
  });

  const recentSales = useQuery({
    queryKey: ["sales"],
    queryFn: () => apiGet<{ sales: Sale[] }>("/api/sales?limit=10"),
    refetchInterval: 60_000,
  });

  const subtotalMinor = cart.reduce((s, l) => s + l.item.sellingPriceMinor * l.qty, 0);
  const discountMinor = Math.min(Math.round((parseFloat(discount || "0") || 0) * 100), subtotalMinor);
  const totalMinor = subtotalMinor - discountMinor;

  const addToCart = (item: InventoryItem) => {
    setCart((prev) => {
      const found = prev.find((l) => l.item.id === item.id);
      if (found) {
        return prev.map((l) => (l.item.id === item.id ? { ...l, qty: Math.min(l.qty + 1, (item.stockOnHand ?? 0) || 1) } : l));
      }
      return [...prev, { item, qty: 1 }];
    });
  };

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
      amountPaidMinor: sale.totalMinor,
      method: sale.method,
    });
  };

  return (
    <div>
      <PageHeader title="POS / Pharmacy" subtitle="Sell items, deduct stock transactionally, print thermal receipts." />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="mb-3 flex items-center gap-2">
            <ScanBarcode className="h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              placeholder="Scan barcode or search name/generic/SKU… (Enter adds first match)"
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
                <li className="px-4 py-10 text-center text-sm text-muted-foreground">Cart is empty — tap items to add.</li>
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
              <div className="flex items-center justify-between text-sm">
                <Label htmlFor="pos-discount" className="text-muted-foreground">Discount</Label>
                <Input id="pos-discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} className="h-8 w-24 text-right" placeholder="0.00" />
              </div>
              <div className="flex items-center justify-between border-t pt-2 text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney(totalMinor, user?.currency)}</span>
              </div>
              <Button className="w-full bg-teal-700 hover:bg-teal-800" disabled={cart.length === 0} onClick={() => setPayOpen(true)}>
                Charge {formatMoney(totalMinor, user?.currency)}
              </Button>
            </div>
          </div>

          <div className="mt-4 rounded-lg border bg-white">
            <div className="border-b px-4 py-2.5 text-sm font-semibold">Recent sales</div>
            {(recentSales.data?.sales ?? []).length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No sales yet today.</p>
            ) : (
              <ul className="divide-y text-sm">
                {(recentSales.data?.sales ?? []).slice(0, 6).map((s) => (
                  <li key={s.id} className="flex items-center justify-between px-4 py-2">
                    <span className="font-mono text-xs">{s.number}</span>
                    <span className="tabular-nums">{formatMoney(s.totalMinor, user?.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <CheckoutDialog open={payOpen} onOpenChange={setPayOpen} totalMinor={totalMinor} discountMinor={discountMinor} cart={cart}
        onCompleted={(sale) => {
          setCart([]);
          setDiscount("");
          queryClient.invalidateQueries({ queryKey: ["pos-items"] });
          queryClient.invalidateQueries({ queryKey: ["sales"] });
          checkoutDone(sale);
        }} />

      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Sale receipt</DialogTitle>
            <DialogDescription>Thermal 80mm selected by default — choose another profile if needed.</DialogDescription>
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
              onPrinted={() => apiSend("POST", "/api/audit", { event: "document.printed", docNumber: receipt.number, docType: "SALE_RECEIPT", printProfile: "THERMAL_80MM" }).catch(() => undefined)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CheckoutDialog({ open, onOpenChange, totalMinor, discountMinor, cart, onCompleted }: {
  open: boolean; onOpenChange: (o: boolean) => void; totalMinor: number; discountMinor: number; cart: CartLine[]; onCompleted: (sale: Sale) => void;
}) {
  const [method, setMethod] = useState("CASH");
  const [customerName, setCustomerName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        idempotencyKey,
      });
      onCompleted(res.sale);
      onOpenChange(false);
      setCustomerName("");
      toast.success(`Sale ${res.sale.number} completed.`);
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
              <option value="CASH">Cash</option>
              <option value="TRANSFER">Transfer</option>
              <option value="CARD">Card</option>
              <option value="MOBILE">Mobile money</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pos-customer">Customer name (optional)</Label>
            <Input id="pos-customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </div>
          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button className="w-full bg-teal-700 hover:bg-teal-800" disabled={busy} onClick={() => void pay()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Complete sale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
