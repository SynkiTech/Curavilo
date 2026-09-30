"use client";

// Queue — live board with check-in, call, start encounter (spec §18)
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, PhoneCall, ClipboardPlus, Loader2, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet, apiSend, type Patient, type QueueEntry } from "./api";
import { LoadingState, ErrorState, EmptyState, PageHeader } from "./ui-kit";
import { useApp } from "./store";
import { toast } from "sonner";

const COLUMNS: { key: string; label: string; tone: string }[] = [
  { key: "WAITING", label: "Waiting", tone: "border-amber-200 bg-amber-50/60" },
  { key: "CALLED", label: "Called", tone: "border-teal-200 bg-teal-50/60" },
  { key: "IN_SERVICE", label: "In service", tone: "border-teal-300 bg-teal-100/60" },
  { key: "COMPLETED", label: "Completed", tone: "border-emerald-200 bg-emerald-50/60" },
];

export function Queue() {
  const { navigate, session } = useApp();
  const canOperate = session?.user?.permissions.includes("queue:operate");
  const [walkInOpen, setWalkInOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["queue"],
    queryFn: () => apiGet<{ entries: QueueEntry[] }>("/api/queue"),
    refetchInterval: 15_000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["queue"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const act = useMutation({
    mutationFn: ({ entryId, action }: { entryId: string; action: "CALL" | "SKIP" | "COMPLETE" }) =>
      apiSend("PATCH", "/api/queue", { entryId, action }),
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div>
      <PageHeader
        title="Queue"
        subtitle="Today's patient flow — check in, call, and start encounters."
        actions={canOperate ? <Button className="bg-teal-700 hover:bg-teal-800" onClick={() => setWalkInOpen(true)}><UserPlus className="mr-2 h-4 w-4" /> Walk-in check-in</Button> : null}
      />

      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}

      {data ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const entries = data.entries.filter((e) => e.status === col.key);
            return (
              <section key={col.key} aria-label={col.label} className={`rounded-lg border ${col.tone}`}>
                <div className="flex items-center justify-between border-b border-inherit px-3 py-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-600">{col.label}</h2>
                  <span className="rounded-full bg-white/80 px-2 text-xs font-semibold tabular-nums">{entries.length}</span>
                </div>
                <ul className="min-h-16 space-y-2 p-2">
                  {entries.length === 0 ? (
                    <li className="px-2 py-4 text-center text-xs text-stone-400">Empty</li>
                  ) : (
                    entries.map((entry) => (
                      <li key={entry.id} className="rounded-md border bg-white p-2.5 shadow-sm">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-bold tabular-nums">{entry.number}</span>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {entry.patient ? `${entry.patient.firstName} ${entry.patient.lastName}` : "Patient"}
                            </div>
                            <div className="text-[11px] text-muted-foreground">{entry.department} · since {new Date(entry.checkedInAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: session?.user?.timezone })}</div>
                          </div>
                        </div>
                        {canOperate && col.key !== "COMPLETED" ? (
                          <div className="mt-2 flex gap-1">
                            {col.key === "WAITING" ? (
                              <>
                                <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" disabled={act.isPending} onClick={() => act.mutate({ entryId: entry.id, action: "CALL" })}>
                                  <PhoneCall className="mr-1 h-3 w-3" /> Call
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-stone-400" aria-label="Skip" disabled={act.isPending} onClick={() => act.mutate({ entryId: entry.id, action: "SKIP" })}>
                                  <SkipForward className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            ) : null}
                            {col.key === "CALLED" || col.key === "IN_SERVICE" ? (
                              <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" disabled={act.isPending} onClick={() => act.mutate({ entryId: entry.id, action: "COMPLETE" })}>
                                Complete
                              </Button>
                            ) : null}
                            {col.key === "CALLED" ? (
                              <Button size="sm" className="h-7 flex-1 bg-teal-700 text-xs hover:bg-teal-800"
                                onClick={() => {
                                  apiSend<{ encounter: { id: string } }>("POST", "/api/encounters", { queueEntryId: entry.id })
                                    .then((r) => {
                                      refresh();
                                      navigate("encounter-detail", { encounterId: r.encounter.id });
                                    })
                                    .catch((e) => toast.error((e as Error).message));
                                }}>
                                <ClipboardPlus className="mr-1 h-3 w-3" /> Start encounter
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    ))
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      ) : null}

      <WalkInDialog open={walkInOpen} onOpenChange={setWalkInOpen} onDone={refresh} />
    </div>
  );
}

function WalkInDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [query, setQuery] = useState("");
  const [patientId, setPatientId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patients = useQuery({
    queryKey: ["patients", query],
    queryFn: () => apiGet<{ patients: Patient[] }>(`/api/patients?q=${encodeURIComponent(query)}&limit=8`),
    enabled: open,
  });

  const submit = async () => {
    if (!patientId) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/api/queue", { patientId, department: "GENERAL" });
      toast.success("Checked in to queue.");
      onDone();
      onOpenChange(false);
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Walk-in check-in</DialogTitle>
          <DialogDescription>Find the patient and assign today's queue number.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="wi-patient">Patient *</Label>
          <Input id="wi-patient" placeholder="Search name, MRN or phone…" value={query} onChange={(e) => { setQuery(e.target.value); setPatientId(null); }} />
          {patients.data && patients.data.patients.length > 0 ? (
            <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border p-1">
              {patients.data.patients.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => { setPatientId(p.id); setQuery(`${p.firstName} ${p.lastName} (${p.mrn})`); }}
                    className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-stone-50 ${patientId === p.id ? "bg-teal-50 font-medium" : ""}`}
                  >
                    {p.firstName} {p.lastName} <span className="text-xs text-muted-foreground">{p.mrn} · {p.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
        <DialogFooter>
          <Button className="bg-teal-700 hover:bg-teal-800" disabled={!patientId || busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Check in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
