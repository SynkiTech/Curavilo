"use client";

// My Day — staff portal (spec §141): schedule, tasks, notifications,
// profile, certifications, leave requests
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, Award, PlaneTakeoff, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiGet, apiSend, formatDate, formatDateTime } from "./api";
import { LoadingState, ErrorState, EmptyState, PageHeader, StatusBadge } from "./ui-kit";
import { useApp } from "./store";
import { toast } from "sonner";

interface Appointment { id: string; scheduledAt: string; durationMin: number; status: string; patient: { mrn: string; firstName: string; lastName: string } }
interface Task { id: string; title: string; priority: string; dueAt?: string | null; status: string }
interface Notification { id: string; title: string; body?: string | null; createdAt: string }
interface Certification { id: string; name: string; expiresAt: string }
interface Leave { id: string; fromAt: string; toAt: string; reason: string; status: string }
interface MyDayData {
  staffProfile: { id: string; name: string; designation: string; department?: string | null } | null;
  appointments: Appointment[];
  tasks: Task[];
  notifications: Notification[];
  certifications: Certification[];
  leave: Leave[];
}

export function MyDay() {
  const { session } = useApp();
  const queryClient = useQueryClient();
  const [certName, setCertName] = useState("");
  const [certExpiry, setCertExpiry] = useState("");
  const [leaveFrom, setLeaveFrom] = useState("");
  const [leaveTo, setLeaveTo] = useState("");
  const [leaveReason, setLeaveReason] = useState("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["myday"],
    queryFn: () => apiGet<MyDayData>("/api/portal"),
  });

  const act = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiSend("POST", "/api/portal?scope=main", payload),
    onSuccess: () => {
      toast.success("Saved.");
      queryClient.invalidateQueries({ queryKey: ["myday"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div>
      <PageHeader title="My Day" subtitle={`Your schedule, tasks, notifications, certifications and leave, ${session?.user?.name ?? ""}.`} />

      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}

      {data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-base"><CalendarCheck2 className="h-4 w-4" aria-hidden /> Today&apos;s schedule</CardTitle>
            </CardHeader>
            <CardContent>
              {data.appointments.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No appointments today.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {data.appointments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between py-2">
                      <span>{formatDateTime(a.scheduledAt, session?.user?.timezone)} · {a.patient.firstName} {a.patient.lastName}</span>
                      <StatusBadge status={a.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-base"><ClipboardList className="h-4 w-4" aria-hidden /> My tasks</CardTitle>
            </CardHeader>
            <CardContent>
              {data.tasks.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Nothing assigned — enjoy the calm.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {data.tasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between py-2">
                      <span>{t.title}{t.dueAt ? <span className="ml-1.5 text-xs text-muted-foreground">due {formatDateTime(t.dueAt, session?.user?.timezone)}</span> : null}</span>
                      <StatusBadge status={t.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-base"><Award className="h-4 w-4" aria-hidden /> Certifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.certifications.length === 0 ? <p className="text-sm text-muted-foreground">None recorded yet.</p> : (
                <ul className="divide-y text-sm">
                  {data.certifications.map((c) => (
                    <li key={c.id} className="flex items-center justify-between py-2">
                      <span>{c.name}</span>
                      <span className="text-xs text-muted-foreground">expires {formatDate(c.expiresAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cert-name" className="sr-only">Certification name</Label>
                  <Input id="cert-name" value={certName} onChange={(e) => setCertName(e.target.value)} placeholder="Certification (e.g. BLS 2026)" className="w-52" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cert-exp" className="sr-only">Expiry</Label>
                  <Input id="cert-exp" type="date" value={certExpiry} onChange={(e) => setCertExpiry(e.target.value)} />
                </div>
                <Button size="sm" variant="outline" disabled={act.isPending || certName.trim().length < 2 || !certExpiry}
                  onClick={() => { act.mutate({ action: "ADD_CERTIFICATION", certification: { name: certName.trim(), expiresAt: certExpiry } }); setCertName(""); setCertExpiry(""); }}>
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-base"><PlaneTakeoff className="h-4 w-4" aria-hidden /> Leave</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.leave.length === 0 ? <p className="text-sm text-muted-foreground">No leave requests yet.</p> : (
                <ul className="divide-y text-sm">
                  {data.leave.map((l) => (
                    <li key={l.id} className="flex items-center justify-between py-2">
                      <span>{formatDate(l.fromAt)} → {formatDate(l.toAt)} · {l.reason}</span>
                      <StatusBadge status={l.status} />
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                <Input type="date" value={leaveFrom} onChange={(e) => setLeaveFrom(e.target.value)} aria-label="Leave from" className="w-36" />
                <Input type="date" value={leaveTo} onChange={(e) => setLeaveTo(e.target.value)} aria-label="Leave to" className="w-36" />
                <Input value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} placeholder="Reason" className="w-40" />
                <Button size="sm" variant="outline" disabled={act.isPending || !leaveFrom || !leaveTo || leaveReason.trim().length < 2}
                  onClick={() => { act.mutate({ action: "REQUEST_LEAVE", leave: { fromAt: leaveFrom, toAt: leaveTo, reason: leaveReason.trim() } }); setLeaveFrom(""); setLeaveTo(""); setLeaveReason(""); }}>
                  Request
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-base">Notifications</CardTitle></CardHeader>
            <CardContent>
              {data.notifications.length === 0 ? <p className="text-sm text-muted-foreground">Inbox zero.</p> : (
                <ul className="divide-y text-sm">
                  {data.notifications.map((n) => (
                    <li key={n.id} className="py-2">
                      <p className="font-medium">{n.title}</p>
                      {n.body ? <p className="text-xs text-muted-foreground">{n.body}</p> : null}
                      <p className="text-xs text-muted-foreground">{formatDateTime(n.createdAt, session?.user?.timezone)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
