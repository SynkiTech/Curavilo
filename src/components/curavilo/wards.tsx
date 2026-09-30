"use client";

// Wards & Admissions - ward/bed board, admission + discharge, referrals (spec §137)
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble, Plus, LogOut, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet, apiSend, formatDateTime, ageFrom } from "./api";
import { LoadingState, ErrorState, EmptyState, PageHeader, StatusBadge } from "./ui-kit";
import { useApp } from "./store";
import { toast } from "sonner";

interface Bed { id: string; label: string; status: string }
interface Ward { id: string; name: string; genderPolicy: string; beds: Bed[] }
interface Admission {
  id: string; reason: string; status: string; admittedAt: string; dischargedAt?: string | null;
  patient: { mrn: string; firstName: string; lastName: string; sex: string; dateOfBirth?: string | null };
  bed: { label: string; ward: { name: string } };
}
interface Referral {
  id: string; direction: string; status: string; notes?: string | null; externalFacility?: string | null;
  toServiceLine?: string | null; createdAt: string;
  patient: { mrn: string; firstName: string; lastName: string };
  toStaffMember?: { name: string } | null;
}

const BED_TONE: Record<string, string> = {
  FREE: "border-emerald-300 bg-emerald-50 text-emerald-800",
  OCCUPIED: "border-teal-700 bg-teal-700 text-white",
  MAINTENANCE: "border-stone-300 bg-stone-100 text-stone-500",
};

export function Wards() {
  const queryClient = useQueryClient();
  const { session } = useApp();
  const [tab, setTab] = useState<"wards" | "admissions" | "referrals">("wards");
  const [admitFor, setAdmitFor] = useState<Bed | null>(null);
  const [dischargeFor, setDischargeFor] = useState<Admission | null>(null);
  const [newWardOpen, setNewWardOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);

  // forms
  const [patientMrn, setPatientMrn] = useState("");
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState("");
  const [wardName, setWardName] = useState("");
  const [bedLabels, setBedLabels] = useState("");
  const [refMrn, setRefMrn] = useState("");
  const [refType, setRefType] = useState<"INTERNAL" | "EXTERNAL">("INTERNAL");
  const [refTarget, setRefTarget] = useState("");
  const [refNotes, setRefNotes] = useState("");

  const wardsQuery = useQuery({ queryKey: ["wards"], queryFn: () => apiGet<{ wards: Ward[] }>("/api/wards?scope=WARDS"), enabled: tab === "wards" });
  const admissionsQuery = useQuery({ queryKey: ["admissions"], queryFn: () => apiGet<{ admissions: Admission[] }>("/api/wards?scope=ADMISSIONS"), enabled: tab === "admissions" });
  const referralsQuery = useQuery({ queryKey: ["referrals"], queryFn: () => apiGet<{ referrals: Referral[] }>("/api/wards?scope=REFERRALS"), enabled: tab === "referrals" });

  const act = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiSend("POST", "/api/wards", payload),
    onSuccess: (_res, payload) => {
      toast.success("Done.");
      ["wards", "admissions", "referrals"].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      setAdmitFor(null); setDischargeFor(null); setNewWardOpen(false); setReferralOpen(false);
      void payload;
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const admit = () => {
    if (!admitFor) return;
    act.mutate({
      action: "ADMIT",
      admission: { patientId: patientMrn, bedId: admitFor.id, reason },
      __mrnNote: patientMrn,
    });
  };

  return (
    <div>
      <PageHeader title="Wards & Admissions" subtitle="Bed board, admissions, discharge summaries and referrals." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mb-3">
        <TabsList>
          <TabsTrigger value="wards"><BedDouble className="mr-1.5 h-3.5 w-3.5" />Ward board</TabsTrigger>
          <TabsTrigger value="admissions">Admissions</TabsTrigger>
          <TabsTrigger value="referrals"><ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />Referrals</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "wards" ? (
        <>
          <div className="mb-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setNewWardOpen(true)} disabled={!session?.user?.permissions.includes("inpatient:manage")}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> New ward
            </Button>
          </div>
          {wardsQuery.isLoading ? <LoadingState /> : null}
          {wardsQuery.isError ? <ErrorState message={(wardsQuery.error as Error).message} onRetry={() => void wardsQuery.refetch()} /> : null}
          {wardsQuery.data && wardsQuery.data.wards.length === 0 ? (
            <EmptyState title="No wards yet" hint="Create a ward with beds to start admitting patients." />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {wardsQuery.data?.wards.map((ward) => (
              <Card key={ward.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    {ward.name}
                    <Badge variant="outline" className="text-[10px]">{ward.genderPolicy}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {ward.beds.map((bed) => (
                      <button
                        key={bed.id}
                        type="button"
                        disabled={bed.status !== "FREE"}
                        onClick={() => { setAdmitFor(bed); setPatientMrn(""); setReason(""); }}
                        className={`rounded-lg border px-1 py-2.5 text-center text-xs font-medium transition ${BED_TONE[bed.status] ?? BED_TONE.FREE} ${bed.status === "FREE" ? "hover:ring-2 hover:ring-teal-400" : "cursor-not-allowed"}`}
                        aria-label={`Bed ${bed.label} - ${bed.status}`}
                        title={bed.status === "FREE" ? `Admit into bed ${bed.label}` : `Bed ${bed.label} is ${bed.status.toLowerCase()}`}
                      >
                        {bed.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {ward.beds.filter((b) => b.status === "FREE").length} free of {ward.beds.length}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {tab === "admissions" ? (
        admissionsQuery.isLoading ? <LoadingState /> :
        admissionsQuery.isError ? <ErrorState message={(admissionsQuery.error as Error).message} /> :
        admissionsQuery.data && admissionsQuery.data.admissions.length === 0 ? <EmptyState title="No admissions" /> : (
          <div className="space-y-2">
            {admissionsQuery.data?.admissions.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{a.patient.firstName} {a.patient.lastName} <span className="text-xs text-muted-foreground">{a.patient.mrn} · {ageFrom(a.patient.dateOfBirth)}</span></p>
                  <p className="text-xs text-muted-foreground">{a.bed.ward.name} / bed {a.bed.label} · admitted {formatDateTime(a.admittedAt)}</p>
                  <p className="mt-0.5 text-xs">{a.reason}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={a.status} />
                  {a.status === "ADMITTED" ? (
                    <Button size="sm" variant="outline" onClick={() => { setDischargeFor(a); setSummary(""); }}>
                      <LogOut className="mr-1.5 h-3.5 w-3.5" /> Discharge
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === "referrals" ? (
        <>
          <div className="mb-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setReferralOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> New referral
            </Button>
          </div>
          {referralsQuery.isLoading ? <LoadingState /> :
          referralsQuery.isError ? <ErrorState message={(referralsQuery.error as Error).message} /> :
          referralsQuery.data && referralsQuery.data.referrals.length === 0 ? <EmptyState title="No referrals" /> : (
            <div className="space-y-2">
              {referralsQuery.data?.referrals.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{r.patient.firstName} {r.patient.lastName} <span className="text-xs text-muted-foreground">{r.patient.mrn}</span></p>
                    <p className="text-xs text-muted-foreground">
                      {r.direction === "INTERNAL" ? `Internal → ${r.toServiceLine ?? r.toStaffMember?.name ?? "-"}` : `External → ${r.externalFacility}`} · {formatDateTime(r.createdAt)}
                    </p>
                    {r.notes ? <p className="mt-0.5 text-xs">{r.notes}</p> : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={r.status} />
                    {r.status === "PENDING" ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => act.mutate({ action: "UPDATE_REFERRAL", referralId: r.id, referralStatus: "ACCEPTED" })}>Accept</Button>
                        <Button size="sm" variant="outline" onClick={() => act.mutate({ action: "UPDATE_REFERRAL", referralId: r.id, referralStatus: "COMPLETED" })}>Complete</Button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* Admit dialog */}
      <Dialog open={!!admitFor} onOpenChange={(open) => !open && setAdmitFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Admit into bed {admitFor?.label}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="admit-mrn">Patient ID</Label>
              <Input id="admit-mrn" value={patientMrn} onChange={(e) => setPatientMrn(e.target.value)} placeholder="Patient record id (from patient 360 → copy id)" />
              <p className="text-xs text-muted-foreground">Tip: copy the patient id from the Patients view detail page.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admit-reason">Reason for admission</Label>
              <Textarea id="admit-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={admit} disabled={act.isPending || patientMrn.length < 5 || reason.trim().length < 2}>Admit patient</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discharge dialog */}
      <Dialog open={!!dischargeFor} onOpenChange={(open) => !open && setDischargeFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Discharge {dischargeFor?.patient.firstName} {dischargeFor?.patient.lastName}</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="discharge-summary">Discharge summary</Label>
            <Textarea id="discharge-summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />
            <p className="text-xs text-muted-foreground">A discharge summary document is generated and attached to the patient record.</p>
          </div>
          <DialogFooter>
            <Button disabled={act.isPending || summary.trim().length < 5}
              onClick={() => dischargeFor && act.mutate({ action: "DISCHARGE", admissionId: dischargeFor.id, discharge: { summary } })}>
              Confirm discharge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New ward dialog */}
      <Dialog open={newWardOpen} onOpenChange={setNewWardOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create ward</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ward-name">Ward name</Label>
              <Input id="ward-name" value={wardName} onChange={(e) => setWardName(e.target.value)} placeholder="e.g. Male Medical Ward" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ward-beds">Bed labels (comma separated)</Label>
              <Input id="ward-beds" value={bedLabels} onChange={(e) => setBedLabels(e.target.value)} placeholder="M1, M2, M3, M4" />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={act.isPending || wardName.trim().length < 2 || bedLabels.trim().length < 1}
              onClick={() => act.mutate({
                action: "CREATE_WARD",
                ward: { name: wardName.trim(), genderPolicy: "MIXED", bedLabels: bedLabels.split(",").map((s) => s.trim()).filter(Boolean) },
              })}>
              Create ward
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Referral dialog */}
      <Dialog open={referralOpen} onOpenChange={setReferralOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New referral</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ref-mrn">Patient ID</Label>
              <Input id="ref-mrn" value={refMrn} onChange={(e) => setRefMrn(e.target.value)} placeholder="Patient record id" />
            </div>
            <Tabs value={refType} onValueChange={(v) => setRefType(v as typeof refType)}>
              <TabsList className="w-full">
                <TabsTrigger value="INTERNAL" className="flex-1">Internal</TabsTrigger>
                <TabsTrigger value="EXTERNAL" className="flex-1">External</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="space-y-1.5">
              <Label htmlFor="ref-target">{refType === "INTERNAL" ? "Service line or staff name" : "External facility"}</Label>
              <Input id="ref-target" value={refTarget} onChange={(e) => setRefTarget(e.target.value)} placeholder={refType === "INTERNAL" ? "OPHTHALMOLOGY" : "Lagos University Teaching Hospital"} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ref-notes">Notes</Label>
              <Textarea id="ref-notes" rows={2} value={refNotes} onChange={(e) => setRefNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={act.isPending || refMrn.length < 5 || refTarget.trim().length < 2}
              onClick={() => act.mutate({
                action: "CREATE_REFERRAL",
                referral: {
                  patientId: refMrn,
                  direction: refType,
                  ...(refType === "INTERNAL" ? { toServiceLine: refTarget.trim().toUpperCase() } : { externalFacility: refTarget.trim() }),
                  notes: refNotes.trim() || null,
                },
              })}>
              Create referral
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
