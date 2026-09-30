"use client";

// Encounters - list + specialty form rendering from service profile (spec §19, §61)
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiGet, apiSend, formatMoney, formatDateTime, type Encounter as EncounterType, type ServiceItem } from "./api";
import { LoadingState, ErrorState, EmptyState, PageHeader, StatusBadge } from "./ui-kit";
import { useApp } from "./store";
import { toast } from "sonner";

// Encounter form templates (mirrors of lib/service-profiles templates used for rendering)
import { ENCOUNTER_FORMS } from "./encounter-forms";

export function Encounters() {
  const { navigate, session } = useApp();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["encounters"],
    queryFn: () => apiGet<{ encounters: EncounterType[] }>("/api/encounters"),
  });

  const open = data?.encounters.filter((e) => e.status === "OPEN") ?? [];
  const completed = data?.encounters.filter((e) => e.status === "COMPLETED") ?? [];

  return (
    <div>
      <PageHeader title="Encounters" subtitle="Clinical records - specialty forms load from the facility service profile." />
      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}
      {data ? (
        <div className="space-y-6">
          <section aria-label="Open encounters">
            <h2 className="mb-2 text-sm font-semibold text-stone-600">Open ({open.length})</h2>
            {open.length === 0 ? (
              <p className="rounded-lg border bg-white px-4 py-6 text-center text-sm text-muted-foreground">No open encounters. Start one from the queue.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {open.map((e) => (
                  <li key={e.id} className="rounded-lg border bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{e.patient ? `${e.patient.firstName} ${e.patient.lastName}` : "-"}</span>
                      <StatusBadge status={e.status} />
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">Started {formatDateTime(e.startedAt, session?.user?.timezone)} · {e.formKey.replaceAll("_", " ")}</div>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => navigate("encounter-detail", { encounterId: e.id })}>Open record</Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Completed encounters">
            <h2 className="mb-2 text-sm font-semibold text-stone-600">Recent completed</h2>
            {completed.length === 0 ? (
              <EmptyState title="No completed encounters yet" />
            ) : (
              <ul className="overflow-hidden rounded-lg border bg-white divide-y">
                {completed.slice(0, 10).map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                    <span>
                      <span className="font-medium">{e.patient ? `${e.patient.firstName} ${e.patient.lastName}` : "-"}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{formatDateTime(e.startedAt, session?.user?.timezone)}{e.diagnosis ? ` · ${e.diagnosis}` : ""}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusBadge status={e.status} />
                      <button className="text-xs text-teal-700 hover:underline" onClick={() => navigate("encounter-detail", { encounterId: e.id })}>View →</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

export function EncounterDetail({ encounterId }: { encounterId: string }) {
  const { session, navigate } = useApp();
  const user = session?.user;
  const queryClient = useQueryClient();
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [diagnosis, setDiagnosis] = useState("");
  const [plan, setPlan] = useState("");
  const [selectedCharges, setSelectedCharges] = useState<Record<string, boolean>>({});
  const [followUpDays, setFollowUpDays] = useState("0");
  const [completeOpen, setCompleteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["encounter", encounterId],
    queryFn: () => apiGet<{ encounter: EncounterType }>(`/api/encounters?id=${encounterId}`),
  });

  const services = useQuery({
    queryKey: ["services"],
    queryFn: () => apiGet<{ services: ServiceItem[] }>("/api/services"),
  });

  const formKey = data?.encounter.formKey ?? "GENERAL_CONSULT";
  const formTemplate = useMemo(() => ENCOUNTER_FORMS[formKey] ?? ENCOUNTER_FORMS.GENERAL_CONSULT, [formKey]);

  const complete = useMutation({
    mutationFn: () =>
      apiSend<{ invoice: { id: string; number: string } | null }>("PATCH", "/api/encounters", {
        encounterId,
        formData: formValues,
        diagnosis: diagnosis.trim() || null,
        plan: plan.trim() || null,
        chargeItemIds: Object.entries(selectedCharges).filter(([, v]) => v).map(([k]) => k),
        followUpDays: Number(followUpDays) || null,
      }),
    onSuccess: (res) => {
      toast.success(res.invoice ? `Encounter completed - invoice ${res.invoice.number} issued.` : "Encounter completed.");
      queryClient.invalidateQueries({ queryKey: ["encounters"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["encounter", encounterId] });
      setCompleteOpen(false);
      if (res.invoice) navigate("invoice-detail", { invoiceId: res.invoice.id });
    },
    onError: (e) => setActionError((e as Error).message),
  });

  if (isLoading) return <LoadingState label="Loading encounter…" />;
  if (isError) return <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />;
  if (!data || !user) return null;

  const e = data.encounter;
  const savedFormData = JSON.parse(e.formData || "{}") as Record<string, string>;
  const isCompleted = e.status === "COMPLETED";
  const selectedTotal = (services.data?.services ?? []).filter((s) => selectedCharges[s.id]).reduce((sum, s) => sum + s.priceMinor, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{formTemplate.title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {e.patient ? `${e.patient.firstName} ${e.patient.lastName} (${e.patient.mrn})` : "-"} · started {formatDateTime(e.startedAt, user.timezone)}
          </p>
        </div>
        <StatusBadge status={e.status} />
      </div>

      <div className="space-y-4">
        {formTemplate.sections.map((section) => (
          <Card key={section.title}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{section.title}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {section.fields.map((field) => (
                <div key={field.key} className={field.type === "textarea" ? "space-y-1 sm:col-span-2" : "space-y-1"}>
                  <Label htmlFor={`f-${field.key}`}>
                    {field.label}{field.required ? " *" : ""}{field.unit ? ` (${field.unit})` : ""}
                  </Label>
                  {field.type === "textarea" ? (
                    <Textarea
                      id={`f-${field.key}`}
                      rows={2}
                      disabled={isCompleted}
                      value={formValues[field.key] ?? savedFormData[field.key] ?? ""}
                      onChange={(ev) => setFormValues({ ...formValues, [field.key]: ev.target.value })}
                    />
                  ) : field.type === "select" ? (
                    <select
                      id={`f-${field.key}`}
                      disabled={isCompleted}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                      value={formValues[field.key] ?? savedFormData[field.key] ?? ""}
                      onChange={(ev) => setFormValues({ ...formValues, [field.key]: ev.target.value })}
                    >
                      <option value="">-</option>
                      {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <Input
                      id={`f-${field.key}`}
                      type={field.type}
                      disabled={isCompleted}
                      value={formValues[field.key] ?? savedFormData[field.key] ?? ""}
                      onChange={(ev) => setFormValues({ ...formValues, [field.key]: ev.target.value })}
                    />
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}

        {isCompleted ? (
          <div className="rounded-lg border bg-white p-4 text-sm text-muted-foreground">
            <p><span className="font-medium text-stone-700">Diagnosis:</span> {e.diagnosis || "-"}</p>
            <p className="mt-1"><span className="font-medium text-stone-700">Plan:</span> {e.plan || "-"}</p>
            <p className="mt-2 text-xs">Clinical records are completed once; corrections are made via the audit trail, never by silent overwrites.</p>
          </div>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Outcome</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="space-y-1">
                  <Label htmlFor="dx">Diagnosis</Label>
                  <Input id="dx" value={diagnosis} onChange={(ev) => setDiagnosis(ev.target.value)} placeholder="e.g. Allergic conjunctivitis" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="plan">Plan / management</Label>
                  <Input id="plan" value={plan} onChange={(ev) => setPlan(ev.target.value)} placeholder="e.g. Antihistamine drops, review 4 weeks" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Charges (creates the invoice)</CardTitle>
              </CardHeader>
              <CardContent>
                {services.isLoading ? <LoadingState label="Loading service catalogue…" /> : null}
                {services.data ? (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {services.data.services.map((s) => (
                      <li key={s.id}>
                        <label className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border p-2.5 text-sm transition ${selectedCharges[s.id] ? "border-teal-600 bg-teal-50/60" : "hover:border-teal-400"}`}>
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={!!selectedCharges[s.id]}
                              onChange={(ev) => setSelectedCharges({ ...selectedCharges, [s.id]: ev.target.checked })}
                              className="h-4 w-4 accent-teal-700"
                              aria-label={`Charge for ${s.name}`}
                            />
                            {s.name}
                          </span>
                          <span className="font-medium tabular-nums">{formatMoney(s.priceMinor, user.currency)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm">
                  <span className="text-muted-foreground">Selected total</span>
                  <span className="font-semibold tabular-nums">{formatMoney(selectedTotal, user.currency)}</span>
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-white p-4">
              <div className="space-y-1">
                <Label htmlFor="fu-days">Follow-up (days from today, 0 = none)</Label>
                <Input id="fu-days" type="number" min={0} max={365} value={followUpDays} onChange={(ev) => setFollowUpDays(ev.target.value)} className="w-40" />
              </div>
              <Button className="bg-teal-700 hover:bg-teal-800" onClick={() => { setActionError(null); setCompleteOpen(true); }}>
                <Save className="mr-2 h-4 w-4" /> Complete encounter
              </Button>
            </div>
          </>
        )}
        {actionError ? null : null}
      </div>

      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Complete encounter?</DialogTitle>
            <DialogDescription>
              This closes the record, issues {selectedTotal > 0 ? `an invoice of ${formatMoney(selectedTotal, user.currency)}` : "no invoice (no charges selected)"}{Number(followUpDays) > 0 ? `, schedules a follow-up in ${followUpDays} days` : ""} and triggers configured workflows.
            </DialogDescription>
          </DialogHeader>
          {actionError ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{actionError}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteOpen(false)}>Cancel</Button>
            <Button className="bg-teal-700 hover:bg-teal-800" disabled={complete.isPending} onClick={() => complete.mutate()}>
              {complete.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Receipt className="mr-2 h-4 w-4" />} Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
