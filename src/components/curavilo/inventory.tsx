"use client";

// Inventory — items, stock lots, receive/adjust, movement ledger (spec §22–23, §112)
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PackagePlus, History, TriangleAlert, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { apiGet, apiSend, formatMoney, formatDate, type InventoryItem } from "./api";
import { LoadingState, ErrorState, EmptyState, PageHeader } from "./ui-kit";
import { useApp } from "./store";
import { toast } from "sonner";

const CATEGORIES = ["PHARMACEUTICAL", "CONSUMABLE", "LAB", "EQUIPMENT", "OFFICE", "OTHER"] as const;

export function Inventory() {
  const { session } = useApp();
  const user = session?.user;
  const canWrite = user?.permissions.includes("inventory:write");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [receiveItem, setReceiveItem] = useState<InventoryItem | null>(null);
  const [movementsItem, setMovementsItem] = useState<InventoryItem | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["inventory", category, q, lowOnly],
    queryFn: () => apiGet<{ items: InventoryItem[] }>(`/api/inventory?category=${category}&q=${encodeURIComponent(q)}&lowStockOnly=${lowOnly}`),
  });

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Stock lots with batch/expiry tracking and an append-only movement ledger."
        actions={canWrite ? <Button className="bg-teal-700 hover:bg-teal-800" onClick={() => setAddItemOpen(true)}><Plus className="mr-2 h-4 w-4" /> Add item</Button> : null}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="Search name, SKU, barcode…" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" aria-label="Search inventory" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category filter" className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c.replaceAll("_", " ")}</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="h-4 w-4 accent-teal-700" />
          Low stock only
        </label>
      </div>

      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}

      {data ? (
        data.items.length === 0 ? (
          <EmptyState title="No inventory items" hint={canWrite ? "Add your first item to start tracking stock." : "No items match your filters."} />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="hidden sm:table-cell">SKU</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="hidden md:table-cell text-right">Reorder at</TableHead>
                  <TableHead className="hidden md:table-cell">Next expiry</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  {canWrite ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item) => {
                  const low = (item.stockOnHand ?? 0) <= item.reorderLevel;
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium">{item.name}</div>
                        {item.genericName ? <div className="text-xs text-muted-foreground">{item.genericName}</div> : null}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs sm:table-cell">{item.sku}</TableCell>
                      <TableCell className="text-right">
                        <span className={`inline-flex items-center gap-1 tabular-nums ${low ? "font-semibold text-amber-600" : ""}`}>
                          {low ? <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> : null}
                          {item.stockOnHand ?? 0}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{item.reorderLevel}</TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">{item.nextExpiry ? formatDate(item.nextExpiry, user?.timezone) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(item.sellingPriceMinor, user?.currency)}</TableCell>
                      {canWrite ? (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => setReceiveItem(item)}><PackagePlus className="mr-1 h-3.5 w-3.5" /> Receive</Button>
                            <Button size="sm" variant="ghost" onClick={() => setMovementsItem(item)}><History className="h-3.5 w-3.5" /></Button>
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )
      ) : null}

      <AddItemDialog open={addItemOpen} onOpenChange={setAddItemOpen} onAdded={() => refetch()} />
      <ReceiveDialog item={receiveItem} onOpenChange={(o) => !o && setReceiveItem(null)} onDone={() => refetch()} />
      <MovementsDialog item={movementsItem} onOpenChange={(o) => !o && setMovementsItem(null)} />
    </div>
  );
}

function AddItemDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; onAdded: () => void }) {
  const [form, setForm] = useState({ name: "", sku: "", genericName: "", category: "PHARMACEUTICAL", unit: "unit", sellingPrice: "", purchasePrice: "", reorderLevel: "10" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/api/inventory", {
        name: form.name.trim(),
        sku: form.sku.trim().toUpperCase(),
        genericName: form.genericName.trim() || null,
        category: form.category,
        unit: form.unit || "unit",
        sellingPriceMinor: Math.round(parseFloat(form.sellingPrice || "0") * 100),
        purchasePriceMinor: Math.round(parseFloat(form.purchasePrice || "0") * 100),
        reorderLevel: parseInt(form.reorderLevel || "10", 10) || 0,
      });
      toast.success("Item created.");
      onOpenChange(false);
      setForm({ name: "", sku: "", genericName: "", category: "PHARMACEUTICAL", unit: "unit", sellingPrice: "", purchasePrice: "", reorderLevel: "10" });
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add inventory item</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="inv-name">Name *</Label>
            <Input id="inv-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-sku">SKU *</Label>
            <Input id="inv-sku" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-generic">Generic name</Label>
            <Input id="inv-generic" value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-cat">Category</Label>
            <select id="inv-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replaceAll("_", " ")}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-reorder">Reorder level</Label>
            <Input id="inv-reorder" type="number" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-buy">Purchase price</Label>
            <Input id="inv-buy" inputMode="decimal" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-sell">Selling price</Label>
            <Input id="inv-sell" inputMode="decimal" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} />
          </div>
        </div>
        {error ? <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
        <DialogFooter>
          <Button className="bg-teal-700 hover:bg-teal-800" disabled={busy || !form.name.trim() || !form.sku.trim()} onClick={() => void submit()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Create item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveDialog({ item, onOpenChange, onDone }: { item: InventoryItem | null; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [batchNo, setBatchNo] = useState("");
  const [quantity, setQuantity] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend("PATCH", "/api/inventory", {
        action: "RECEIVE",
        itemId: item.id,
        batchNo: batchNo.trim(),
        quantity: parseInt(quantity, 10),
        expiresAt: expiresAt || null,
        reason: "Purchase received",
      });
      toast.success(`Received ${quantity} × ${item.name}.`);
      onOpenChange(false);
      setBatchNo("");
      setQuantity("");
      setExpiresAt("");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Receive stock — {item?.name}</DialogTitle>
          <DialogDescription>Creates a stock lot and a RECEIPT movement in the ledger.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="rc-batch">Batch/lot number *</Label>
            <Input id="rc-batch" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="e.g. B-2026-041" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="rc-qty">Quantity *</Label>
              <Input id="rc-qty" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rc-exp">Expiry</Label>
              <Input id="rc-exp" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          </div>
          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button className="bg-teal-700 hover:bg-teal-800" disabled={busy || !batchNo.trim() || !parseInt(quantity, 10)} onClick={() => void submit()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Receive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MovementsDialog({ item, onOpenChange }: { item: InventoryItem | null; onOpenChange: (o: boolean) => void }) {
  const { session } = useApp();
  const { data, isLoading } = useQuery({
    queryKey: ["movements", item?.id],
    queryFn: () => apiGet<{ movements: { id: string; type: string; quantity: number; reason?: string | null; createdAt: string; lotId?: string | null }[] }>(`/api/inventory?itemId=${item?.id}`),
    enabled: !!item,
  });

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Stock movements — {item?.name}</DialogTitle>
          <DialogDescription>Append-only ledger: every quantity change is recorded.</DialogDescription>
        </DialogHeader>
        {isLoading ? <LoadingState /> : null}
        {data ? (
          <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
            {data.movements.length === 0 ? (
              <li className="py-6 text-center text-muted-foreground">No movements yet.</li>
            ) : (
              data.movements.map((m) => (
                <li key={m.id} className="flex items-center justify-between rounded border px-3 py-2">
                  <div>
                    <Badge variant="outline" className="mr-2 text-[10px]">{m.type}</Badge>
                    <span className="text-xs text-muted-foreground">{m.reason ?? ""} · {formatDate(m.createdAt, session?.user?.timezone)}</span>
                  </div>
                  <span className={`font-semibold tabular-nums ${m.quantity >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {m.quantity > 0 ? "+" : ""}{m.quantity}
                  </span>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
