"use client";

// Appointments - schedule, status management, check-in to queue
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiSend, formatDateTime, type Patient, type Appointment, type ServiceItem, type StaffMember } from "./api";
import { LoadingState, ErrorState, EmptyState, PageHeader, StatusBadge } from "./ui-kit";
import { useApp } from "./store";
import { toast } from "sonner";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Appointments() {
  const { session, route, navigate } = useApp();
  const canWrite = session?.user?.permissions.includes("appointments:write");
  const [date, setDate] = useState(todayISO());
  const prefillPatientId = route.params?.patientId;
  const [createOpen, setCreateOpen] = useState(!!prefillPatientId);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["appointments", date],
    queryFn: () => apiGet<{ appointments: Appointment[] }>(`/api/appointments?date=${date}`),
    refetchInterval: 45_000,
  });

  return (
    <div>
      <PageHeader
        title="Appointments"
        subtitle="Schedule, reschedule and check patients into the queue."
        actions={
          canWrite ? (
            <Button className="bg-teal-700 hover:bg-teal-800" onClick={() => setCreateOpen(true)}>
              <CalendarPlus className="mr-2 h-4 w-4" /> New appointment
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Label htmlFor="appt-date" className="text-sm text-muted-foreground">Date</Label>
        <Input id="appt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
      </div>

      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}

      {data ? (
        data.appointments.length === 0 ? (
          <EmptyState title="No appointments for this date" hint="Try another date or create a new appointment." />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead className="hidden sm:table-cell">Service</TableHead>
                  <TableHead className="hidden md:table-cell">Staff</TableHead>
                  <TableHead>Status</TableHead>
                  {canWrite ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.appointments.map((a) => (
                  <AppointmentRow key={a.id} appointment={a} timezone={session?.user?.timezone ?? "Africa/Lagos"} canWrite={!!canWrite}
                    onChanged={() => queryClient.invalidateQueries({ queryKey: ["appointments"] })}
                    onOpenPatient={() => navigate("patient-detail", { patientId: a.patientId })} />
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : null}

      <CreateAppointmentDialog open={createOpen} onOpenChange={setCreateOpen} date={date} prefillPatientId={prefillPatientId}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["appointments"] })} />
    </div>
  );
}

function AppointmentRow({ appointment: a, timezone, canWrite, onChanged, onOpenPatient }: {
  appointment: Appointment; timezone: string; canWrite: boolean; onChanged: () => void; onOpenPatient: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const act = async (act: "CHECK_IN" | "CANCEL" | "NO_SHOW") => {
    setBusy(true);
    try {
      await apiSend("PATCH", `/api/appointments`, { action: act, id: a.id });
      onChanged();
      if (act === "CHECK_IN") toast.success("Checked in - queue number assigned.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-xs">{formatDateTime(a.scheduledAt, timezone)}</TableCell>
      <TableCell>
        <button className="font-medium hover:text-teal-700 hover:underline" onClick={onOpenPatient}>
          {a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : "-"}
        </button>
      </TableCell>
      <TableCell className="hidden sm:table-cell">{a.serviceItem?.name ?? "-"}</TableCell>
      <TableCell className="hidden md:table-cell">{a.staffMember?.name ?? "-"}</TableCell>
      <TableCell><StatusBadge status={a.status} /></TableCell>
      {canWrite ? (
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            {a.status === "SCHEDULED" ? (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("CHECK_IN")}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Check in
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act("NO_SHOW")}>No-show</Button>
              </>
            ) : null}
            {a.status === "SCHEDULED" || a.status === "CHECKED_IN" ? (
              <Button size="sm" variant="ghost" className="text-red-600" disabled={busy} onClick={() => void act("CANCEL")}>Cancel</Button>
            ) : null}
          </div>
        </TableCell>
      ) : null}
    </TableRow>
  );
}

export function CreateAppointmentDialog({
  open, onOpenChange, date, prefillPatientId, onCreated,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; date: string; prefillPatientId?: string; onCreated: () => void;
}) {
  const [patientQuery, setPatientQuery] = useState("");
  const [patientId, setPatientId] = useState<string | null>(prefillPatientId ?? null);
  const [serviceItemId, setServiceItemId] = useState<string>("");
  const [staffMemberId, setStaffMemberId] = useState<string>("");
  const [time, setTime] = useState("09:00");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const patients = useQuery({
    queryKey: ["patients", patientQuery],
    queryFn: () => apiGet<{ patients: Patient[] }>(`/api/patients?q=${encodeURIComponent(patientQuery)}&limit=8`),
    enabled: open && !prefillPatientId,
  });

  const services = useQuery({
    queryKey: ["services"],
    queryFn: () => apiGet<{ services: ServiceItem[] }>("/api/services"),
    enabled: open,
  });

  const staff = useQuery({
    queryKey: ["staff"],
    queryFn: () => apiGet<{ staff: StaffMember[] }>("/api/staff"),
    enabled: open,
  });

  const prefillPatient = useQuery({
    queryKey: ["patient", prefillPatientId],
    queryFn: () => apiGet<{ patient: Patient }>(`/api/patients/${prefillPatientId}`),
    enabled: open && !!prefillPatientId,
  });

  const create = useMutation({
    mutationFn: () =>
      apiSend("POST", "/api/appointments", {
        patientId,
        serviceItemId: serviceItemId || null,
        staffMemberId: staffMemberId || null,
        scheduledAt: new Date(`${date}T${time}:00.000Z`).toISOString(),
        durationMin: 30,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Appointment created.");
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      onCreated();
      onOpenChange(false);
      setPatientId(null);
      setNotes("");
      setError(null);
    },
    onError: (e) => setError((e as Error).message),
  });

  void prefillPatient;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setError(null); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New appointment</DialogTitle>
          <DialogDescription>Pick the patient, service and time. Check-in assigns a queue number.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {prefillPatientId ? null : (
            <div className="space-y-1">
              <Label htmlFor="appt-patient">Patient *</Label>
              <Input id="appt-patient" placeholder="Search name, MRN or phone…" value={patientQuery} onChange={(e) => { setPatientQuery(e.target.value); setPatientId(null); }} />
              {patients.data && patients.data.patients.length > 0 ? (
                <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border p-1">
                  {patients.data.patients.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => { setPatientId(p.id); setPatientQuery(`${p.firstName} ${p.lastName} (${p.mrn})`); }}
                        className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-stone-50 ${patientId === p.id ? "bg-teal-50 font-medium" : ""}`}
                      >
                        {p.firstName} {p.lastName} <span className="text-xs text-muted-foreground">{p.mrn} · {p.phone}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="appt-date2">Date *</Label>
              <Input id="appt-date2" type="date" value={date} onChange={() => undefined} disabled className="bg-stone-50" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="appt-time">Time *</Label>
              <Input id="appt-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="appt-service">Service</Label>
            <select id="appt-service" value={serviceItemId} onChange={(e) => setServiceItemId(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm">
              <option value="">- optional -</option>
              {services.data?.services.map((s) => (
                <option key={s.id} value={s.id}>{s.name} · {s.priceMinor / 100}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="appt-staff">Staff</Label>
            <select id="appt-staff" value={staffMemberId} onChange={(e) => setStaffMemberId(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm">
              <option value="">- optional -</option>
              {staff.data?.staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.designation})</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="appt-notes">Notes</Label>
            <Input id="appt-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button className="bg-teal-700 hover:bg-teal-800" disabled={!patientId || create.isPending} onClick={() => { setError(null); create.mutate(); }}>
            {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Create appointment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
