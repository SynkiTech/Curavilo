"use client";

// Inventory: items + lots, receive/adjust/dispose, stocktake, suppliers,
// purchase orders, valuation & expiry reports (spec §22-23, §112)
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, PackagePlus, History, TriangleAlert, Plus, Pencil, Trash2,
  ClipboardCheck, Truck, FileText, Archive, ArchiveRestore, PackageX, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { apiGet, apiSend, formatMoney, formatDate, formatDateTime, type InventoryItem, type Supplier, type PurchaseOrder } from "./api";
import { LoadingState, ErrorState, EmptyState, PageHeader } from "./ui-kit";
import { useApp } from "./store";
import { toast } from "sonner";

const CATEGORIES = ["PHARMACEUTICAL", "CONSUMABLE", "LAB", "EQUIPMENT", "OFFICE", "OTHER"] as const;
type Tab = "items" | "stocktake" | "suppliers" | "orders" | "reports";

export function Inventory() {
  const { session } = useApp();
  const user = session?.user;
  const canWrite = user?.permissions.includes("inventory:write");
  const [tab, setTab] = useState<Tab>("items");

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Stock lots with batch/expiry tracking, suppliers, purchase orders, stocktake and valuation."
      />

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border bg-white p-1 text-sm" role="tablist" aria-label="Inventory sections">
        {([
          ["items", "Items", <PackagePlus key="i" className="h-3.5 w-3.5" />],
          ["stocktake", "Stocktake", <ClipboardCheck key="i" className="h-3.5 w-3.5" />],
          ["suppliers", "Suppliers", <Truck key="i" className="h-3.5 w-3.5" />],
          ["orders", "Purchase orders", <FileText key="i" className="h-3.5 w-3.5" />],
          ["reports", "Reports", <BarChart3 key="i" className="h-3.5 w-3.5" />],
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

      {tab === "items" ? <ItemsTab canWrite={!!canWrite} /> : null}
      {tab === "stocktake" ? <StocktakeTab /> : null}
      {tab === "suppliers" ? <SuppliersTab canWrite={!!canWrite} /> : null}
      {tab === "orders" ? <OrdersTab canWrite={!!canWrite} /> : null}
      {tab === "reports" ? <ReportsTab /> : null}
    </div>
  );
}

/* ─── Items tab ─────────────────────────────────────────────────────────── */

function ItemsTab({ canWrite }: { canWrite: boolean }) {
  const { session } = useApp();
  const user = session?.user;
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [receiveItem, setReceiveItem] = useState<InventoryItem | null>(null);
  const [detailsItem, setDetailsItem] = useState<InventoryItem | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["inventory", category, q, lowOnly],
    queryFn: () => apiGet<{ items: InventoryItem[] }>(`/api/inventory?category=${category}&q=${encodeURIComponent(q)}&lowStockOnly=${lowOnly}`),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    queryClient.invalidateQueries({ queryKey: ["pos-items"] });
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="Search name, SKU, barcode..." value={q} onChange={(e) => setQ(e.target.value)} className="w-56" aria-label="Search inventory" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category filter" className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c.replaceAll("_", " ")}</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="h-4 w-4 accent-teal-700" />
          Low stock only
        </label>
        {canWrite ? (
          <Button className="ml-auto bg-teal-700 hover:bg-teal-800" onClick={() => setAddItemOpen(true)}><Plus className="mr-2 h-4 w-4" /> Add item</Button>
        ) : null}
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
                      <TableCell className="hidden md:table-cell text-muted-foreground">{item.nextExpiry ? formatDate(item.nextExpiry, user?.timezone) : "-"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(item.sellingPriceMinor, user?.currency)}</TableCell>
                      {canWrite ? (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => setReceiveItem(item)}><PackagePlus className="mr-1 h-3.5 w-3.5" /> Receive</Button>
                            <Button size="sm" variant="ghost" title="Lots, adjust, dispose and movement ledger" onClick={() => setDetailsItem(item)}><History className="h-3.5 w-3.5" /></Button>
                            <Button size="sm" variant="ghost" title="Edit item" onClick={() => setEditItem(item)}><Pencil className="h-3.5 w-3.5" /></Button>
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

      <ItemFormDialog open={addItemOpen} onOpenChange={setAddItemOpen} onSaved={refresh} />
      <ItemFormDialog open={!!editItem} item={editItem} onOpenChange={(o) => !o && setEditItem(null)} onSaved={refresh} />
      <ReceiveDialog item={receiveItem} onOpenChange={(o) => !o && setReceiveItem(null)} onDone={refresh} />
      <ItemDetailsDialog item={detailsItem} onOpenChange={(o) => !o && setDetailsItem(null)} onChanged={refresh} />
    </div>
  );
}

function ItemFormDialog({ open, item, onOpenChange, onSaved }: {
  open: boolean; item?: InventoryItem | null; onOpenChange: (o: boolean) => void; onSaved: () => void;
}) {
  const editing = !!item;
  const [form, setForm] = useState(() => ({
    name: item?.name ?? "",
    sku: item?.sku ?? "",
    genericName: item?.genericName ?? "",
    dosageForm: item?.dosageForm ?? "",
    barcode: item?.barcode ?? "",
    category: item?.category ?? "PHARMACEUTICAL",
    unit: item?.unit ?? "unit",
    sellingPrice: item ? (item.sellingPriceMinor / 100).toFixed(2) : "",
    purchasePrice: item ? (item.purchasePriceMinor / 100).toFixed(2) : "",
    reorderLevel: String(item?.reorderLevel ?? 10),
    active: item?.active ?? true,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form whenever a different item is loaded for editing.
  const [loadedFor, setLoadedFor] = useState<string | null>(item?.id ?? null);
  if (open && (item?.id ?? null) !== loadedFor) {
    setLoadedFor(item?.id ?? null);
    setForm({
      name: item?.name ?? "",
      sku: item?.sku ?? "",
      genericName: item?.genericName ?? "",
      dosageForm: item?.dosageForm ?? "",
      barcode: item?.barcode ?? "",
      category: item?.category ?? "PHARMACEUTICAL",
      unit: item?.unit ?? "unit",
      sellingPrice: item ? (item.sellingPriceMinor / 100).toFixed(2) : "",
      purchasePrice: item ? (item.purchasePriceMinor / 100).toFixed(2) : "",
      reorderLevel: String(item?.reorderLevel ?? 10),
      active: item?.active ?? true,
    });
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim().toUpperCase(),
        genericName: form.genericName.trim() || null,
        dosageForm: form.dosageForm.trim() || null,
        barcode: form.barcode.trim() || null,
        category: form.category,
        unit: form.unit || "unit",
        sellingPriceMinor: Math.round(parseFloat(form.sellingPrice || "0") * 100),
        purchasePriceMinor: Math.round(parseFloat(form.purchasePrice || "0") * 100),
        reorderLevel: parseInt(form.reorderLevel || "10", 10) || 0,
      };
      if (editing && item) {
        await apiSend("PATCH", "/api/inventory?action=UPDATE_ITEM", { itemId: item.id, ...payload, active: form.active });
        toast.success("Item updated.");
      } else {
        await apiSend("POST", "/api/inventory", payload);
        toast.success("Item created.");
      }
      onOpenChange(false);
      onSaved();
      if (!editing) {
        setForm({ name: "", sku: "", genericName: "", dosageForm: "", barcode: "", category: "PHARMACEUTICAL", unit: "unit", sellingPrice: "", purchasePrice: "", reorderLevel: "10", active: true });
      }
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
          <DialogTitle>{editing ? `Edit ${item?.name}` : "Add inventory item"}</DialogTitle>
          {editing ? <DialogDescription>Price and reorder changes apply to new sales immediately. Stock history is untouched.</DialogDescription> : null}
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="inv-name">Name *</Label>
            <Input id="inv-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-sku">SKU *</Label>
            <Input id="inv-sku" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} disabled={editing} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-barcode">Barcode</Label>
            <Input id="inv-barcode" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-generic">Generic name</Label>
            <Input id="inv-generic" value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-dosage">Dosage form</Label>
            <Input id="inv-dosage" value={form.dosageForm} onChange={(e) => setForm({ ...form, dosageForm: e.target.value })} placeholder="tablet, syrup, drops..." />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-cat">Category</Label>
            <select id="inv-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replaceAll("_", " ")}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-unit">Unit</Label>
            <Input id="inv-unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
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
          {editing ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-teal-700" />
              Active (unchecked items disappear from the POS but keep their history)
            </label>
          ) : null}
        </div>
        {error ? <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
        <DialogFooter>
          <Button className="bg-teal-700 hover:bg-teal-800" disabled={busy || !form.name.trim() || (!editing && !form.sku.trim())} onClick={() => void submit()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} {editing ? "Save changes" : "Create item"}
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
  const [reason, setReason] = useState("Purchase received");
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
        reason: reason.trim() || "Purchase received",
      });
      toast.success(`Received ${quantity} × ${item.name}.`);
      onOpenChange(false);
      setBatchNo("");
      setQuantity("");
      setExpiresAt("");
      setReason("Purchase received");
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
          <DialogTitle>Receive stock - {item?.name}</DialogTitle>
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
          <div className="space-y-1">
            <Label htmlFor="rc-reason">Reason / reference</Label>
            <Input id="rc-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Supplier invoice number, donation, transfer in..." />
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

function ItemDetailsDialog({ item, onOpenChange, onChanged }: {
  item: InventoryItem | null; onOpenChange: (o: boolean) => void; onChanged: () => void;
}) {
  const { session } = useApp();
  const tz = session?.user?.timezone;
  const canWrite = session?.user?.permissions.includes("inventory:write");
  const [adjustLot, setAdjustLot] = useState<string | null>(null);
  const [newQty, setNewQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [disposeLot, setDisposeLot] = useState<string | null>(null);
  const [disposeQty, setDisposeQty] = useState("");
  const [disposeType, setDisposeType] = useState("DAMAGE");
  const [disposeReason, setDisposeReason] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["movements", item?.id],
    queryFn: () => apiGet<{ movements: { id: string; type: string; quantity: number; reason?: string | null; createdAt: string; lotId?: string | null }[] }>(`/api/inventory?itemId=${item?.id}`),
    enabled: !!item,
  });

  const submitAdjust = async () => {
    if (!item || !adjustLot) return;
    setBusy(true);
    try {
      await apiSend("PATCH", "/api/inventory", { action: "ADJUST", itemId: item.id, lotId: adjustLot, newQty: parseInt(newQty, 10) || 0, reason: adjustReason.trim() });
      toast.success("Stock adjusted.");
      setAdjustLot(null);
      setNewQty("");
      setAdjustReason("");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitDispose = async () => {
    if (!item || !disposeLot) return;
    setBusy(true);
    try {
      await apiSend("PATCH", "/api/inventory", { action: "DISPOSE", itemId: item.id, lotId: disposeLot, quantity: parseInt(disposeQty, 10) || 0, reason: disposeReason.trim(), type: disposeType });
      toast.success("Stock written off.");
      setDisposeLot(null);
      setDisposeQty("");
      setDisposeReason("");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const lots = item?.lots ?? [];

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Stock details - {item?.name}</DialogTitle>
          <DialogDescription>Lots with expiry tracking, adjustments, write-offs and the append-only movement ledger.</DialogDescription>
        </DialogHeader>

        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stock lots</h4>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                {canWrite ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lots.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="py-4 text-center text-sm text-muted-foreground">No lots yet. Use Receive to add stock.</TableCell></TableRow>
              ) : (
                lots.map((lot) => {
                  const expired = lot.expiresAt ? new Date(lot.expiresAt).getTime() < Date.now() : false;
                  return (
                    <TableRow key={lot.id}>
                      <TableCell className="font-mono text-xs">{lot.batchNo}</TableCell>
                      <TableCell className={expired ? "text-xs font-semibold text-red-600" : "text-xs text-muted-foreground"}>
                        {lot.expiresAt ? formatDate(lot.expiresAt, tz) : "no expiry"}{expired ? " (expired)" : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{lot.qtyRemaining} / {lot.qtyReceived}</TableCell>
                      {canWrite ? (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => { setAdjustLot(lot.id); setNewQty(String(lot.qtyRemaining)); setAdjustReason(""); }}>
                              <Pencil className="mr-1 h-3 w-3" /> Adjust
                            </Button>
                            <Button size="sm" variant="ghost" className="text-red-600" onClick={() => { setDisposeLot(lot.id); setDisposeQty(""); setDisposeType("DAMAGE"); setDisposeReason(""); }}>
                              <PackageX className="mr-1 h-3 w-3" /> Write off
                            </Button>
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {adjustLot ? (
          <div className="grid gap-2 rounded-md border bg-stone-50 p-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input type="number" min={0} value={newQty} onChange={(e) => setNewQty(e.target.value)} placeholder="New quantity" aria-label="New quantity" />
            <Input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Reason (count correction, damage found...)" />
            <div className="flex gap-1">
              <Button size="sm" className="bg-teal-700 hover:bg-teal-800" disabled={busy || adjustReason.trim().length < 3} onClick={() => void submitAdjust()}>Apply</Button>
              <Button size="sm" variant="ghost" onClick={() => setAdjustLot(null)}>Cancel</Button>
            </div>
          </div>
        ) : null}

        {disposeLot ? (
          <div className="grid gap-2 rounded-md border border-red-200 bg-red-50/50 p-3 sm:grid-cols-[100px_130px_1fr_auto]">
            <Input type="number" min={1} value={disposeQty} onChange={(e) => setDisposeQty(e.target.value)} placeholder="Qty" aria-label="Quantity to write off" />
            <select value={disposeType} onChange={(e) => setDisposeType(e.target.value)} aria-label="Write-off type" className="flex h-9 rounded-md border border-input bg-transparent px-2 text-sm">
              <option value="DAMAGE">Damaged</option>
              <option value="EXPIRED">Expired</option>
            </select>
            <Input value={disposeReason} onChange={(e) => setDisposeReason(e.target.value)} placeholder="Reason" />
            <div className="flex gap-1">
              <Button size="sm" className="bg-red-600 hover:bg-red-700" disabled={busy || disposeReason.trim().length < 3 || !parseInt(disposeQty, 10)} onClick={() => void submitDispose()}>Write off</Button>
              <Button size="sm" variant="ghost" onClick={() => setDisposeLot(null)}>Cancel</Button>
            </div>
          </div>
        ) : null}

        <h4 className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Movement ledger</h4>
        {isLoading ? <LoadingState /> : null}
        {data ? (
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {data.movements.length === 0 ? (
              <li className="py-6 text-center text-muted-foreground">No movements yet.</li>
            ) : (
              data.movements.map((m) => (
                <li key={m.id} className="flex items-center justify-between rounded border px-3 py-2">
                  <div>
                    <Badge variant="outline" className="mr-2 text-[10px]">{m.type}</Badge>
                    <span className="text-xs text-muted-foreground">{m.reason ?? ""} · {formatDateTime(m.createdAt, tz)}</span>
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

/* ─── Stocktake tab ─────────────────────────────────────────────────────── */

function StocktakeTab() {
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("Physical stock count");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ name: string; systemQty: number; countedQty: number; variance: number }[] | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["inventory", "stocktake"],
    queryFn: () => apiGet<{ items: InventoryItem[] }>("/api/inventory"),
  });

  const items = data?.items ?? [];
  const totalVariances = useMemo(
    () => items.reduce((acc, item) => {
      const raw = counted[item.id];
      if (raw === undefined || raw === "") return acc;
      const variance = (parseInt(raw, 10) || 0) - (item.stockOnHand ?? 0);
      return variance !== 0 ? acc + 1 : acc;
    }, 0),
    [items, counted]
  );

  const apply = async () => {
    const lines = items
      .filter((item) => counted[item.id] !== undefined && counted[item.id] !== "")
      .map((item) => ({ itemId: item.id, countedQty: parseInt(counted[item.id], 10) || 0 }));
    if (lines.length === 0) {
      toast.error("Enter at least one counted quantity.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiSend<{ results: { name: string; systemQty: number; countedQty: number; variance: number }[] }>("PATCH", "/api/inventory", { action: "STOCKTAKE", reason: reason.trim() || "Physical stock count", lines });
      setResults(res.results);
      setCounted({});
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["pos-items"] });
      const changed = res.results.filter((r) => r.variance !== 0).length;
      toast.success(`Stocktake saved: ${changed} of ${res.results.length} item(s) adjusted.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} className="w-72" aria-label="Stocktake reason" placeholder="Reason (e.g. monthly count)" />
        <span className="text-sm text-muted-foreground">{totalVariances} item(s) with variance</span>
        <Button className="ml-auto bg-teal-700 hover:bg-teal-800" disabled={busy || totalVariances === 0} onClick={() => void apply()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-2 h-4 w-4" />} Apply stocktake
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Enter the physically counted quantity. Shrinkage is deducted from the soonest-expiring lots first; surplus lands on the latest-expiring lot.</p>

      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} /> : null}

      {results ? (
        <div className="mb-4 rounded-lg border bg-teal-50/60 p-3">
          <h4 className="mb-2 text-sm font-semibold">Last stocktake result</h4>
          <ul className="space-y-1 text-sm">
            {results.filter((r) => r.variance !== 0).map((r) => (
              <li key={r.name} className="flex justify-between">
                <span>{r.name}</span>
                <span className="tabular-nums">system {r.systemQty} → counted {r.countedQty} ({r.variance > 0 ? "+" : ""}{r.variance})</span>
              </li>
            ))}
            {results.every((r) => r.variance === 0) ? <li className="text-muted-foreground">All counted quantities matched the system.</li> : null}
          </ul>
        </div>
      ) : null}

      {data ? (
        <div className="overflow-hidden rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">System qty</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const raw = counted[item.id];
                const variance = raw === undefined || raw === "" ? null : (parseInt(raw, 10) || 0) - (item.stockOnHand ?? 0);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}<span className="ml-2 text-xs text-muted-foreground">{item.sku}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{item.stockOnHand ?? 0}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number" min={0}
                        value={raw ?? ""}
                        onChange={(e) => setCounted((p) => ({ ...p, [item.id]: e.target.value }))}
                        className="ml-auto h-8 w-24 text-right"
                        aria-label={`Counted quantity for ${item.name}`}
                      />
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${variance === null ? "text-muted-foreground" : variance === 0 ? "text-emerald-600" : variance > 0 ? "text-teal-700" : "text-red-600"}`}>
                      {variance === null ? "-" : `${variance > 0 ? "+" : ""}${variance}`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

/* ─── Suppliers tab ─────────────────────────────────────────────────────── */

function SuppliersTab({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [edit, setEdit] = useState<Supplier | "new" | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiGet<{ suppliers: Supplier[] }>("/api/suppliers?includeInactive=true"),
  });

  const toggleActive = useMutation({
    mutationFn: (s: Supplier) => apiSend("PATCH", "/api/suppliers", { supplierId: s.id, active: !s.active }),
    onSuccess: () => {
      toast.success("Supplier updated.");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div>
      <div className="mb-3 flex items-center">
        <p className="text-sm text-muted-foreground">Suppliers feed purchase orders and item sourcing.</p>
        {canWrite ? (
          <Button className="ml-auto bg-teal-700 hover:bg-teal-800" onClick={() => setEdit("new")}><Plus className="mr-2 h-4 w-4" /> Add supplier</Button>
        ) : null}
      </div>

      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}

      {data ? (
        data.suppliers.length === 0 ? (
          <EmptyState title="No suppliers yet" hint={canWrite ? "Add a supplier to start raising purchase orders." : undefined} />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="hidden sm:table-cell">Phone</TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead className="hidden md:table-cell">Address</TableHead>
                  <TableHead>Status</TableHead>
                  {canWrite ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.suppliers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="hidden sm:table-cell">{s.phone ?? "-"}</TableCell>
                    <TableCell className="hidden md:table-cell">{s.email ?? "-"}</TableCell>
                    <TableCell className="hidden max-w-48 truncate md:table-cell">{s.address ?? "-"}</TableCell>
                    <TableCell><Badge variant="outline" className={s.active ? "text-emerald-700" : "text-stone-500"}>{s.active ? "Active" : "Archived"}</Badge></TableCell>
                    {canWrite ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEdit(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => toggleActive.mutate(s)}>
                            {s.active ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : null}

      <SupplierDialog supplier={edit === "new" ? null : edit} open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} onSaved={() => queryClient.invalidateQueries({ queryKey: ["suppliers"] })} />
    </div>
  );
}

function SupplierDialog({ supplier, open, onOpenChange, onSaved }: {
  supplier: Supplier | null; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void;
}) {
  const editing = !!supplier;
  const [form, setForm] = useState(() => ({
    name: supplier?.name ?? "", phone: supplier?.phone ?? "", email: supplier?.email ?? "", address: supplier?.address ?? "", notes: supplier?.notes ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [loadedFor, setLoadedFor] = useState<string | null>(supplier?.id ?? null);
  if (open && (supplier?.id ?? null) !== loadedFor) {
    setLoadedFor(supplier?.id ?? null);
    setForm({
      name: supplier?.name ?? "", phone: supplier?.phone ?? "", email: supplier?.email ?? "", address: supplier?.address ?? "", notes: supplier?.notes ?? "",
    });
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await apiSend("PATCH", "/api/suppliers", { supplierId: supplier!.id, ...form });
      } else {
        await apiSend("POST", "/api/suppliers", form);
      }
      toast.success(editing ? "Supplier updated." : "Supplier created.");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{editing ? `Edit ${supplier?.name}` : "Add supplier"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="sup-name">Name *</Label>
            <Input id="sup-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sup-phone">Phone</Label>
            <Input id="sup-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sup-email">Email</Label>
            <Input id="sup-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="sup-address">Address</Label>
            <Input id="sup-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="sup-notes">Notes</Label>
            <Input id="sup-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        {error ? <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
        <DialogFooter>
          <Button className="bg-teal-700 hover:bg-teal-800" disabled={busy || !form.name.trim()} onClick={() => void submit()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} {editing ? "Save changes" : "Create supplier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Purchase orders tab ───────────────────────────────────────────────── */

function OrdersTab({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => apiGet<{ orders: PurchaseOrder[] }>("/api/purchase-orders"),
  });

  const setStatus = useMutation({
    mutationFn: ({ purchaseOrderId, status }: { purchaseOrderId: string; status: "SUBMITTED" | "CANCELLED" }) =>
      apiSend("PATCH", "/api/purchase-orders", { action: "SET_STATUS", purchaseOrderId, status }),
    onSuccess: (_res, vars) => {
      toast.success(vars.status === "SUBMITTED" ? "Order submitted to supplier." : "Order cancelled.");
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div>
      <div className="mb-3 flex items-center">
        <p className="text-sm text-muted-foreground">Raise orders to suppliers and receive stock against them (partial receiving supported).</p>
        {canWrite ? (
          <Button className="ml-auto bg-teal-700 hover:bg-teal-800" onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" /> New order</Button>
        ) : null}
      </div>

      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}

      {data ? (
        data.orders.length === 0 ? (
          <EmptyState title="No purchase orders" hint={canWrite ? "Create an order to track expected deliveries." : undefined} />
        ) : (
          <div className="space-y-2">
            {data.orders.map((po) => (
              <div key={po.id} className="rounded-lg border bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold">{po.number}</span>
                  <Badge variant="outline" className={
                    po.status === "RECEIVED" ? "text-emerald-700" :
                    po.status === "CANCELLED" ? "text-stone-500" :
                    po.status === "PARTIAL" ? "text-amber-600" : "text-teal-700"
                  }>{po.status}</Badge>
                  <span className="text-sm font-medium">{po.supplier?.name}</span>
                  <span className="text-xs text-muted-foreground">raised {formatDate(po.createdAt)}{po.expectedAt ? ` · expected ${formatDate(po.expectedAt)}` : ""}</span>
                  <div className="ml-auto flex gap-1">
                    {canWrite && (po.status === "DRAFT" || po.status === "PARTIAL" || po.status === "SUBMITTED") ? (
                      <Button size="sm" variant="outline" className="text-teal-700" onClick={() => setReceiving(po)}><Truck className="mr-1 h-3.5 w-3.5" /> Receive</Button>
                    ) : null}
                    {canWrite && po.status === "DRAFT" ? (
                      <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ purchaseOrderId: po.id, status: "SUBMITTED" })}>Submit</Button>
                    ) : null}
                    {canWrite && (po.status === "DRAFT" || po.status === "SUBMITTED" || po.status === "PARTIAL") ? (
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setStatus.mutate({ purchaseOrderId: po.id, status: "CANCELLED" })}>Cancel</Button>
                    ) : null}
                  </div>
                </div>
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {(po.items ?? []).map((l) => (
                    <li key={l.id} className="flex justify-between">
                      <span>{l.item?.name} ({l.item?.sku})</span>
                      <span className="tabular-nums">{l.quantityReceived}/{l.quantity} received{po.status !== "DRAFT" && l.quantityReceived > 0 ? "" : ""} · {formatMoney(l.unitCostMinor)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )
      ) : null}

      <CreatePODialog open={creating} onOpenChange={setCreating} onSaved={() => queryClient.invalidateQueries({ queryKey: ["purchase-orders"] })} />
      <ReceivePODialog po={receiving} onOpenChange={(o) => !o && setReceiving(null)} onSaved={() => {
        queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        queryClient.invalidateQueries({ queryKey: ["inventory"] });
        queryClient.invalidateQueries({ queryKey: ["pos-items"] });
      }} />
    </div>
  );
}

function CreatePODialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [supplierId, setSupplierId] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<{ itemId: string; quantity: string; unitCost: string }[]>([{ itemId: "", quantity: "", unitCost: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => apiGet<{ suppliers: Supplier[] }>("/api/suppliers"), enabled: open });
  const items = useQuery({ queryKey: ["inventory", ""], queryFn: () => apiGet<{ items: InventoryItem[] }>("/api/inventory"), enabled: open });

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/api/purchase-orders", {
        supplierId,
        expectedAt: expectedAt || null,
        notes: notes.trim() || null,
        items: lines
          .filter((l) => l.itemId && parseInt(l.quantity, 10) > 0)
          .map((l) => ({ itemId: l.itemId, quantity: parseInt(l.quantity, 10), unitCostMinor: Math.round((parseFloat(l.unitCost || "0") || 0) * 100) })),
      });
      toast.success("Purchase order created.");
      onOpenChange(false);
      setSupplierId("");
      setExpectedAt("");
      setNotes("");
      setLines([{ itemId: "", quantity: "", unitCost: "" }]);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
          <DialogDescription>Pick a supplier and the items to order. Receive deliveries later, fully or partially.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="po-sup">Supplier *</Label>
              <select id="po-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="">Select supplier</option>
                {(suppliers.data?.suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="po-exp">Expected date</Label>
              <Input id="po-exp" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Order lines</Label>
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_90px_100px_32px] gap-2">
                <select
                  aria-label={`Item for line ${idx + 1}`}
                  value={line.itemId}
                  onChange={(e) => setLines((p) => p.map((l, i) => (i === idx ? { ...l, itemId: e.target.value } : l)))}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Select item</option>
                  {(items.data?.items ?? []).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.sku})</option>)}
                </select>
                <Input type="number" min={1} placeholder="Qty" value={line.quantity} onChange={(e) => setLines((p) => p.map((l, i) => (i === idx ? { ...l, quantity: e.target.value } : l)))} aria-label={`Quantity for line ${idx + 1}`} />
                <Input inputMode="decimal" placeholder="Unit cost" value={line.unitCost} onChange={(e) => setLines((p) => p.map((l, i) => (i === idx ? { ...l, unitCost: e.target.value } : l)))} aria-label={`Unit cost for line ${idx + 1}`} />
                <Button variant="ghost" size="icon" className="h-9 w-8" aria-label={`Remove line ${idx + 1}`} onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLines((p) => [...p, { itemId: "", quantity: "", unitCost: "" }])}><Plus className="mr-1 h-3.5 w-3.5" /> Add line</Button>
          </div>
          <div className="space-y-1">
            <Label htmlFor="po-notes">Notes</Label>
            <Input id="po-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button className="bg-teal-700 hover:bg-teal-800" disabled={busy || !supplierId || lines.every((l) => !l.itemId || !parseInt(l.quantity, 10))} onClick={() => void submit()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Create order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceivePODialog({ po, onOpenChange, onSaved }: { po: PurchaseOrder | null; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [rows, setRows] = useState<Record<string, { quantity: string; batchNo: string; expiresAt: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (po && po.id !== loadedFor) {
    setLoadedFor(po.id);
    setRows(Object.fromEntries((po.items ?? []).filter((l) => l.quantityReceived < l.quantity).map((l) => [l.id, { quantity: String(l.quantity - l.quantityReceived), batchNo: "", expiresAt: "" }])));
  }
  if (!po && loadedFor) setLoadedFor(null);

  const submit = async () => {
    if (!po) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend("PATCH", "/api/purchase-orders", {
        action: "RECEIVE",
        purchaseOrderId: po.id,
        lines: Object.entries(rows)
          .filter(([, r]) => parseInt(r.quantity, 10) > 0 && r.batchNo.trim())
          .map(([poItemId, r]) => ({ poItemId, quantity: parseInt(r.quantity, 10), batchNo: r.batchNo.trim(), expiresAt: r.expiresAt || null })),
      });
      toast.success("Goods received into stock.");
      onOpenChange(false);
      setRows({});
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!po} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Receive goods - {po?.number}</DialogTitle>
          <DialogDescription>Each received line creates a stock lot (batch + expiry) and a RECEIPT movement.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {(po?.items ?? []).filter((l) => l.quantityReceived < l.quantity).map((l) => {
            const row = rows[l.id] ?? { quantity: "", batchNo: "", expiresAt: "" };
            const pending = l.quantity - l.quantityReceived;
            return (
              <div key={l.id} className="rounded-md border p-3">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium">{l.item?.name}</span>
                  <span className="text-xs text-muted-foreground">{l.quantityReceived}/{l.quantity} received · {pending} pending</span>
                </div>
                <div className="grid grid-cols-[80px_1fr_140px] gap-2">
                  <Input type="number" min={1} max={pending} value={row.quantity} onChange={(e) => setRows((p) => ({ ...p, [l.id]: { ...row, quantity: e.target.value } }))} aria-label={`Receive quantity for ${l.item?.name}`} />
                  <Input value={row.batchNo} onChange={(e) => setRows((p) => ({ ...p, [l.id]: { ...row, batchNo: e.target.value } }))} placeholder="Batch/lot number *" aria-label={`Batch for ${l.item?.name}`} />
                  <Input type="date" value={row.expiresAt} onChange={(e) => setRows((p) => ({ ...p, [l.id]: { ...row, expiresAt: e.target.value } }))} aria-label={`Expiry for ${l.item?.name}`} />
                </div>
              </div>
            );
          })}
          {(po?.items ?? []).every((l) => l.quantityReceived >= l.quantity) ? (
            <p className="text-center text-sm text-muted-foreground">All lines fully received.</p>
          ) : null}
          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button className="bg-teal-700 hover:bg-teal-800" disabled={busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />} Receive into stock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Reports tab ───────────────────────────────────────────────────────── */

function ReportsTab() {
  const { session } = useApp();
  const user = session?.user;
  const summary = useQuery({
    queryKey: ["inventory-summary"],
    queryFn: () => apiGet<{ summary: {
      itemCount: number; purchaseValueMinor: number; retailValueMinor: number;
      lowStock: number; outOfStock: number; expiredQty: number; expiredValueMinor: number; expiringSoonQty: number;
      categoryValue: Record<string, number>;
    } }>("/api/inventory?summary=1"),
    refetchInterval: 60_000,
  });

  const expiring = useQuery({
    queryKey: ["inventory-expiring"],
    queryFn: () => apiGet<{ lots: { id: string; batchNo: string; expiresAt: string; qtyRemaining: number; item: { name: string; sku: string; purchasePriceMinor: number } }[] }>("/api/inventory?expiringDays=90"),
  });

  const lowStock = useQuery({
    queryKey: ["inventory", "low"],
    queryFn: () => apiGet<{ items: InventoryItem[] }>("/api/inventory?lowStockOnly=true"),
  });

  const s = summary.data?.summary;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <ReportCard label="Items tracked" value={String(s?.itemCount ?? 0)} />
        <ReportCard label="Stock value (cost)" value={formatMoney(s?.purchaseValueMinor ?? 0, user?.currency)} />
        <ReportCard label="Stock value (retail)" value={formatMoney(s?.retailValueMinor ?? 0, user?.currency)} />
        <ReportCard label="Low / out of stock" value={`${s?.lowStock ?? 0} / ${s?.outOfStock ?? 0}`} tone={(s?.lowStock ?? 0) + (s?.outOfStock ?? 0) > 0 ? "warn" : undefined} />
        <ReportCard label="Expiring in 30 days" value={`${s?.expiringSoonQty ?? 0} units`} tone={(s?.expiringSoonQty ?? 0) > 0 ? "warn" : undefined} />
        <ReportCard label="Expired on shelf" value={`${s?.expiredQty ?? 0} units`} tone={(s?.expiredQty ?? 0) > 0 ? "warn" : undefined} />
        <ReportCard label="Expired value (cost)" value={formatMoney(s?.expiredValueMinor ?? 0, user?.currency)} tone={(s?.expiredValueMinor ?? 0) > 0 ? "warn" : undefined} />
      </div>

      {s ? (
        <div className="rounded-lg border bg-white p-3">
          <h4 className="mb-2 text-sm font-semibold">Value by category (cost)</h4>
          <ul className="grid gap-1 text-sm sm:grid-cols-3">
            {Object.entries(s.categoryValue).sort((a, b) => b[1] - a[1]).map(([cat, val]) => (
              <li key={cat} className="flex justify-between rounded border px-3 py-1.5">
                <span>{cat.replaceAll("_", " ")}</span>
                <span className="tabular-nums font-medium">{formatMoney(val, user?.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-lg border bg-white">
        <div className="border-b px-4 py-2.5 text-sm font-semibold">Lots expiring within 90 days</div>
        {expiring.isLoading ? <LoadingState /> : null}
        {expiring.data ? (
          expiring.data.lots.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing expiring soon.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Cost value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expiring.data.lots.map((lot) => {
                  const expired = new Date(lot.expiresAt).getTime() < Date.now();
                  return (
                    <TableRow key={lot.id}>
                      <TableCell className="font-medium">{lot.item.name}</TableCell>
                      <TableCell className="font-mono text-xs">{lot.batchNo}</TableCell>
                      <TableCell className={expired ? "text-xs font-semibold text-red-600" : "text-xs text-muted-foreground"}>{formatDate(lot.expiresAt)}{expired ? " (expired)" : ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{lot.qtyRemaining}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(lot.qtyRemaining * lot.item.purchasePriceMinor, user?.currency)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )
        ) : null}
      </div>

      <div className="rounded-lg border bg-white">
        <div className="border-b px-4 py-2.5 text-sm font-semibold">Low stock items (at or below reorder level)</div>
        {lowStock.isLoading ? <LoadingState /> : null}
        {lowStock.data ? (
          lowStock.data.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">All items are above their reorder levels.</p>
          ) : (
            <ul className="divide-y text-sm">
              {lowStock.data.items.map((i) => (
                <li key={i.id} className="flex items-center justify-between px-4 py-2">
                  <span className="font-medium">{i.name} <span className="text-xs text-muted-foreground">{i.sku}</span></span>
                  <span className="tabular-nums font-semibold text-amber-600">{i.stockOnHand ?? 0} left · reorder at {i.reorderLevel}</span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}

function ReportCard({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone === "warn" ? "border-amber-200 bg-amber-50/60" : "bg-white"}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
