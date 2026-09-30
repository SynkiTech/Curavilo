"use client";

// Lab & Radiology - diagnostic orders lifecycle (spec §137):
// ORDERED → SPECIMEN_COLLECTED → RESULT_ENTERED → VERIFIED → RELEASED
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Plus, CheckCircle2, Send, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet, apiSend, formatDateTime } from "./api";
import { LoadingState, ErrorState, EmptyState, PageHeader, StatusBadge } from "./ui-kit";
import { useApp } from "./store";
import { toast } from "sonner";

interface DiagnosticOrder {
  id: string;
  kind: string;
  testName: string;
  modality?: string | null;
  priority: string;
  status: string;
  orderedAt: string;
  releasedAt?: string | null;
  turnaroundMin?: number | null;
  reportNumber?: string | null;
  resultsJson?: string | null;
  impression?: string | null;
  patient: { mrn: string; firstName: string; lastName: string };
}

interface OrderRowProps { order: DiagnosticOrder; onOpen: (o: DiagnosticOrder) => void }

function OrderRow({ order, onOpen }: OrderRowProps) {
  return (
    <TableRow>
      <TableCell className="font-medium">{order.testName}</TableCell>
      <TableCell>
        <span className="text-sm">{order.patient.firstName} {order.patient.lastName}</span>
        <span className="ml-1.5 text-xs text-muted-foreground">{order.patient.mrn}</span>
      </TableCell>
      <TableCell><Badge variant="outline" className="text-[10px]">{order.kind === "LAB" ? "LAB" : order.modality ?? "IMAGING"}</Badge></TableCell>
      <TableCell>{order.priority === "URGENT" ? <Badge className="bg-red-50 text-red-700 border border-red-200 text-[10px]">URGENT</Badge> : <span className="text-xs text-muted-foreground">Routine</span>}</TableCell>
      <TableCell><StatusBadge status={order.status} /></TableCell>
      <TableCell className="text-xs text-muted-foreground">{formatDateTime(order.orderedAt)}</TableCell>
      <TableCell className="text-right">
        <Button size="sm" variant="outline" onClick={() => onOpen(order)}>Open</Button>
      </TableCell>
    </TableRow>
  );
}

export function Lab() {
  const { session } = useApp();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<"LAB" | "IMAGING">("LAB");
  const [selected, setSelected] = useState<DiagnosticOrder | null>(null);
  const [resultsText, setResultsText] = useState("");
  const [impression, setImpression] = useState("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["lab-orders", kind],
    queryFn: () => apiGet<{ orders: DiagnosticOrder[] }>(`/api/lab?kind=${kind}`),
  });

  const act = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiSend("POST", "/api/lab", payload),
    onSuccess: () => {
      toast.success("Updated.");
      queryClient.invalidateQueries({ queryKey: ["lab-orders"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const openOrder = (o: DiagnosticOrder) => {
    setSelected(o);
    if (o.resultsJson) {
      try {
        const parsed = JSON.parse(o.resultsJson) as Array<{ name: string; value: string; unit?: string }>;
        setResultsText(parsed.map((r) => `${r.name}: ${r.value}${r.unit ? " " + r.unit : ""}`).join("\n"));
      } catch {
        setResultsText("");
      }
    } else {
      setResultsText("");
    }
    setImpression(o.impression ?? "");
  };

  const submitResults = () => {
    if (!selected) return;
    const results = resultsText
      .split("\n").map((line) => line.trim()).filter(Boolean)
      .map((line) => {
        const [name, ...rest] = line.split(":");
        const value = rest.join(":").trim();
        const unitMatch = /^(.*?)\s+([a-zA-Z%/°μ]+)$/.exec(value);
        return unitMatch && unitMatch[1]
          ? { name: name.trim(), value: unitMatch[1].trim(), unit: unitMatch[2] }
          : { name: name.trim(), value };
      });
    if (results.length === 0) {
      toast.error("Enter at least one result line (Name: value unit).");
      return;
    }
    act.mutate({ action: "RESULTS", orderId: selected.id, results: { results, impression: impression || null } });
    setSelected(null);
  };

  const canOperate = !!session?.user?.permissions.includes("lab:operate");

  return (
    <div>
      <PageHeader
        title="Lab & Radiology"
        subtitle="Orders flow: ordered → specimen collected → results entered → verified → released. Released results notify the patient portal and workflows."
      />
      <Tabs value={kind} onValueChange={(v) => setKind(v as "LAB" | "IMAGING")} className="mb-3">
        <TabsList>
          <TabsTrigger value="LAB"><FlaskConical className="mr-1.5 h-3.5 w-3.5" />Laboratory</TabsTrigger>
          <TabsTrigger value="IMAGING">Radiology</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}

      {data ? (
        data.orders.length === 0 ? (
          <EmptyState title={`No ${kind === "LAB" ? "lab" : "imaging"} orders`} hint="Orders appear here once clinicians request tests from encounters or the lab view." />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ordered</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.orders.map((o) => <OrderRow key={o.id} order={o} onOpen={openOrder} />)}
              </TableBody>
            </Table>
          </div>
        )
      ) : null}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-lg">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selected.testName} <StatusBadge status={selected.status} />
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {selected.patient.firstName} {selected.patient.lastName} · {selected.patient.mrn} · {formatDateTime(selected.orderedAt)}
                {selected.turnaroundMin ? ` · TAT ${selected.turnaroundMin} min` : ""}
              </p>

              {["ORDERED", "SPECIMEN_COLLECTED"].includes(selected.status) ? (
                <div className="space-y-3">
                  {selected.status === "ORDERED" ? (
                    <Card>
                      <CardContent className="pt-4">
                        <Button size="sm" disabled={!canOperate || act.isPending} onClick={() => act.mutate({ action: "COLLECT", orderId: selected.id, site: null })}>
                          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Specimen collected / patient attended
                        </Button>
                      </CardContent>
                    </Card>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="results">Results (one per line - Name: value unit)</Label>
                    <Textarea id="results" rows={5} value={resultsText} onChange={(e) => setResultsText(e.target.value)} placeholder={"Haemoglobin: 11.2 g/dL\nMalaria parasite: Not seen"} />
                    <Label htmlFor="impression">Impression (optional)</Label>
                    <Textarea id="impression" rows={2} value={impression} onChange={(e) => setImpression(e.target.value)} />
                    <Button size="sm" disabled={!canOperate || act.isPending} onClick={submitResults}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> Save results
                    </Button>
                  </div>
                </div>
              ) : null}

              {selected.status === "RESULT_ENTERED" ? (
                <Card>
                  <CardContent className="flex items-center justify-between pt-4">
                    <span className="text-sm">Results entered - verify to release to the patient.</span>
                    <Button size="sm" disabled={!canOperate || act.isPending} onClick={() => act.mutate({ action: "VERIFY", orderId: selected.id })}>
                      Verify results
                    </Button>
                  </CardContent>
                </Card>
              ) : null}

              {selected.status === "VERIFIED" ? (
                <Card>
                  <CardContent className="flex items-center justify-between pt-4">
                    <span className="text-sm">Verified - release to publish the report and notify.</span>
                    <Button size="sm" disabled={!canOperate || act.isPending} onClick={() => act.mutate({ action: "RELEASE", orderId: selected.id })}>
                      <Send className="mr-1.5 h-3.5 w-3.5" /> Release report
                    </Button>
                  </CardContent>
                </Card>
              ) : null}

              {selected.resultsJson && ["VERIFIED", "RELEASED"].includes(selected.status) ? (
                <div className="rounded-lg border bg-stone-50 p-3 text-sm">
                  <pre className="whitespace-pre-wrap font-sans text-xs">{resultsText}</pre>
                  {impression ? <p className="mt-2 text-xs text-muted-foreground">Impression: {impression}</p> : null}
                  {selected.reportNumber ? <p className="mt-1 text-xs">Report № {selected.reportNumber}</p> : null}
                </div>
              ) : null}

              {!["RELEASED", "CANCELLED", "VERIFIED"].includes(selected.status) ? (
                <DialogFooter>
                  <Button size="sm" variant="ghost" className="text-red-600" disabled={!canOperate || act.isPending}
                    onClick={() => { act.mutate({ action: "CANCEL", orderId: selected.id, reason: "Cancelled from lab view" }); setSelected(null); }}>
                    <Ban className="mr-1.5 h-3.5 w-3.5" /> Cancel order
                  </Button>
                </DialogFooter>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
