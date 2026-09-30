"use client";

// Patient 360 - demographics + encounters + appointments + invoices + follow-ups + AI summary
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Loader2, CalendarPlus, ClipboardPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { apiGet, formatMoney, formatDate, formatDateTime, ageFrom, type Patient, type Appointment, type Encounter, type Invoice, type FollowUp, type Payment, ApiError } from "./api";
import { LoadingState, ErrorState, StatusBadge } from "./ui-kit";
import { useApp } from "./store";

interface Patient360 {
  patient: Patient;
  appointments: Appointment[];
  encounters: Encounter[];
  invoices: Invoice[];
  followUps: FollowUp[];
  payments: Payment[];
}

export function PatientDetail({ patientId }: { patientId: string }) {
  const { session, navigate, setAiPatientContext } = useApp();
  const user = session?.user;
  const [aiBusy, setAiBusy] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["patient", patientId],
    queryFn: () => apiGet<Patient360>(`/api/patients/${patientId}`),
  });

  if (isLoading) return <LoadingState label="Loading patient…" />;
  if (isError) return <ErrorState message={(error as Error)?.message ?? "Failed to load patient."} onRetry={() => void refetch()} />;
  if (!data || !user) return null;

  const p = data.patient;
  const tz = user.timezone;
  const outstanding = data.invoices
    .filter((i) => i.status === "ISSUED" || i.status === "PARTIALLY_PAID")
    .reduce((s, i) => s + (i.totalMinor - i.amountPaidMinor), 0);

  const askAi = () => {
    setAiPatientContext({ id: p.id, name: `${p.firstName} ${p.lastName}` });
    navigate("ai");
  };

  const bookAppointment = () => navigate("appointments", { patientId: p.id });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{p.firstName} {p.lastName}</h1>
            <Badge variant="outline" className="font-mono text-[11px]">{p.mrn}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {p.sex === "MALE" ? "Male" : "Female"} · {ageFrom(p.dateOfBirth)} · {p.phone}
            {p.allergies ? <span className="ml-2 font-medium text-red-600">Allergies: {p.allergies}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={bookAppointment}><CalendarPlus className="mr-1.5 h-4 w-4" /> Appointment</Button>
          <Button variant="outline" size="sm" onClick={() => navigate("queue")}><ClipboardPlus className="mr-1.5 h-4 w-4" /> Walk-in</Button>
          {user.permissions.includes("ai:ask") ? (
            <Button size="sm" className="bg-teal-700 hover:bg-teal-800" onClick={askAi} disabled={aiBusy}>
              {aiBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />} Ask AI about this patient
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card><CardContent className="pt-4 text-center"><div className="text-2xl font-semibold">{data.encounters.length}</div><div className="text-xs text-muted-foreground">Encounters</div></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><div className="text-2xl font-semibold">{data.appointments.length}</div><div className="text-xs text-muted-foreground">Appointments</div></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><div className="text-2xl font-semibold">{data.invoices.length}</div><div className="text-xs text-muted-foreground">Invoices</div></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><div className={`text-2xl font-semibold ${outstanding > 0 ? "text-amber-600" : ""}`}>{formatMoney(outstanding, user.currency)}</div><div className="text-xs text-muted-foreground">Outstanding</div></CardContent></Card>
      </div>

      <Tabs defaultValue="encounters" className="mt-6">
        <TabsList>
          <TabsTrigger value="encounters">Encounters</TabsTrigger>
          <TabsTrigger value="appointments">Appointments</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="followups">Follow-ups</TabsTrigger>
        </TabsList>

        <TabsContent value="encounters" className="mt-3">
          {data.encounters.length === 0 ? (
            <p className="rounded-lg border bg-white px-4 py-8 text-center text-sm text-muted-foreground">No encounters recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.encounters.map((e) => (
                <li key={e.id} className="rounded-lg border bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">{formatDateTime(e.startedAt, tz)} · {e.formKey.replaceAll("_", " ")}</div>
                    <StatusBadge status={e.status} />
                  </div>
                  {e.diagnosis ? <p className="mt-1 text-sm text-muted-foreground">Diagnosis: {e.diagnosis}</p> : null}
                  <button className="mt-1 text-xs text-teal-700 hover:underline" onClick={() => navigate("encounter-detail", { encounterId: e.id })}>View record →</button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="appointments" className="mt-3">
          {data.appointments.length === 0 ? (
            <p className="rounded-lg border bg-white px-4 py-8 text-center text-sm text-muted-foreground">No appointments yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.appointments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-3 text-sm">
                  <span>{formatDateTime(a.scheduledAt, tz)} {a.serviceItem ? `· ${a.serviceItem.name}` : ""}</span>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="billing" className="mt-3">
          {data.invoices.length === 0 ? (
            <p className="rounded-lg border bg-white px-4 py-8 text-center text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.invoices.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-3 text-sm">
                  <span>
                    <span className="font-mono text-xs">{inv.number}</span>
                    <span className="ml-2">{formatMoney(inv.totalMinor, inv.currency)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{formatDate(inv.createdAt, tz)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={inv.status} />
                    <button className="text-xs text-teal-700 hover:underline" onClick={() => navigate("invoice-detail", { invoiceId: inv.id })}>Open →</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="followups" className="mt-3">
          {data.followUps.length === 0 ? (
            <p className="rounded-lg border bg-white px-4 py-8 text-center text-sm text-muted-foreground">No follow-ups scheduled.</p>
          ) : (
            <ul className="space-y-2">
              {data.followUps.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-3 text-sm">
                  <span>{f.title} · due {formatDate(f.dueAt, tz)}</span>
                  <StatusBadge status={f.status} />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
