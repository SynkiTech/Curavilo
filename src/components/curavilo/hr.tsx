"use client";

// Human Resources - directory, leave approvals, certifications, attendance,
// performance reviews and facility announcements. Everything people-ops in one
// place for the HR role.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, CalendarOff, BadgeCheck, ClipboardCheck, Megaphone, Plus, CircleCheck, CircleX,
  Award, UserCheck, Search, FileBadge,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet, apiSend, formatDate, formatDateTime } from "./api";
import { LoadingState, ErrorState, EmptyState, PageHeader, StatCard, PermissionDenied, StatusBadge } from "./ui-kit";
import { PagePrintButton } from "./print";
import { useApp, can } from "./store";
import { toast } from "sonner";

interface HrStaff {
  id: string; name: string; designation: string; department: string | null; active: boolean;
  certifications: { id: string; name: string; expiresAt: string }[];
  leaveRequests: number; reviews: number;
}
interface HrLeave {
  id: string; staffId: string; staffName: string; designation: string | null; department: string | null;
  fromAt: string; toAt: string; reason: string; createdAt: string;
}
interface HrOverview {
  headcount: { total: number; active: number; inactive: number };
  byDepartment: { name: string; count: number }[];
  byDesignation: { name: string; count: number }[];
  staff: HrStaff[];
  pendingLeave: HrLeave[];
  recentDecisions: { id: string; staffName: string; status: string; fromAt: string; toAt: string; decidedAt: string | null }[];
  onLeaveNow: { id: string; staffName: string; designation: string | null; toAt: string }[];
  expiringCertifications: { id: string; staffName: string; designation: string | null; name: string; expiresAt: string }[];
  todayAttendance: { id: string; staffId: string; staffName: string; designation: string | null; status: string; checkInAt: string | null; checkOutAt: string | null; note: string | null }[];
  recentReviews: { id: string; staffName: string; designation: string | null; period: string; overallScore: number; strengths: string | null; improvements: string | null; goals: string | null; status: string; reviewedAt: string }[];
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function HR() {
  const { session } = useApp();
  const qc = useQueryClient();
  const canManage = can("hr:manage");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["hr", "overview"],
    queryFn: () => apiGet<HrOverview>("/api/hr"),
    refetchInterval: 60_000,
  });

  if (!can("hr:read")) return <PermissionDenied what="the HR workspace" />;

  return (
    <div className="print-area-parent">
      <PageHeader
        title="Human Resources"
        subtitle="Directory, leave, certifications, attendance, reviews and announcements for this facility."
        actions={<div className="no-print"><PagePrintButton /></div>}
      />
      {isLoading ? <LoadingState label="Loading HR workspace…" /> : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
      ) : data ? (
        <Tabs defaultValue="dashboard" className="gap-4">
          <TabsList className="no-print flex-wrap">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="directory">Directory</TabsTrigger>
            <TabsTrigger value="leave">Leave{data.pendingLeave.length ? ` (${data.pendingLeave.length})` : ""}</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="reviews">Reviews</TabsTrigger>
            <TabsTrigger value="announce">Announce</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard"><HrDashboard data={data} /></TabsContent>

          <TabsContent value="directory"><Directory data={data} canManage={canManage} qc={qc} /></TabsContent>

          <TabsContent value="leave">
            <LeaveView data={data} canManage={canManage} qc={qc} />
          </TabsContent>

          <TabsContent value="attendance"><Attendance data={data} canManage={canManage} qc={qc} /></TabsContent>

          <TabsContent value="reviews"><Reviews data={data} canManage={canManage} qc={qc} /></TabsContent>

          <TabsContent value="announce"><Announce canManage={canManage} qc={qc} /></TabsContent>
        </Tabs>
      ) : null}
      <span className="hidden">{session?.user?.name}</span>
    </div>
  );
}

/* ─── Dashboard tab ────────────────────────────────────────────────────────── */

function HrDashboard({ data }: { data: HrOverview }) {
  return (
    <div className="space-y-4 print-area">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Headcount" value={data.headcount.total} hint={`${data.headcount.active} active`} />
        <StatCard title="On leave today" value={data.onLeaveNow.length} tone={data.onLeaveNow.length > 0 ? "warn" : "default"} hint="approved leave" />
        <StatCard title="Pending leave requests" value={data.pendingLeave.length} tone={data.pendingLeave.length > 0 ? "warn" : "default"} hint="need a decision" />
        <StatCard title="Certifications expiring" value={data.expiringCertifications.length} tone={data.expiringCertifications.length > 0 ? "warn" : "default"} hint="within 30 days" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border bg-white p-4 print-area" aria-label="Departments">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4 text-teal-600" /> By department</h3>
          {data.byDepartment.length === 0 ? <p className="text-sm text-muted-foreground">No staff records yet.</p> : (
            <ul className="space-y-1.5">
              {data.byDepartment.slice(0, 8).map((d) => (
                <li key={d.name} className="flex items-center justify-between text-sm">
                  <span>{d.name}</span>
                  <Badge variant="outline" className="tabular-nums">{d.count}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border bg-white p-4 print-area" aria-label="Certifications expiring soon">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Award className="h-4 w-4 text-amber-500" /> Certifications expiring soon</h3>
          {data.expiringCertifications.length === 0 ? <p className="text-sm text-muted-foreground">Nothing expires in the next 30 days.</p> : (
            <ul className="space-y-1.5">
              {data.expiringCertifications.slice(0, 6).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate"><span className="font-medium">{c.staffName}</span> <span className="text-muted-foreground">- {c.name}</span></span>
                  <span className="whitespace-nowrap text-xs text-amber-700">{formatDate(c.expiresAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-xl border bg-white p-4 print-area" aria-label="Recent reviews">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><ClipboardCheck className="h-4 w-4 text-teal-600" /> Recent performance reviews</h3>
        {data.recentReviews.length === 0 ? <p className="text-sm text-muted-foreground">No reviews recorded yet.</p> : (
          <ul className="space-y-2">
            {data.recentReviews.slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg border bg-stone-50/50 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{r.staffName}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{r.period}</span>
                </div>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className="text-xs text-muted-foreground">Score</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.overallScore >= 4 ? "bg-emerald-100 text-emerald-700" : r.overallScore >= 3 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{r.overallScore}/5</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ─── Directory tab ────────────────────────────────────────────────────────── */

function Directory({ data, canManage, qc }: { data: HrOverview; canManage: boolean; qc: ReturnType<typeof useQueryClient> }) {
  const [q, setQ] = useState("");
  const [certDialog, setCertDialog] = useState<HrStaff | null>(null);
  const filtered = data.staff.filter((s) =>
    `${s.name} ${s.designation} ${s.department ?? ""}`.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 no-print">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, designation, department…" className="h-8 w-64 pl-8" aria-label="Search staff" />
        </div>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => window.print()}>
          <FileBadge className="mr-2 h-4 w-4" /> Print directory
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border bg-white print-area">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Certifications</TableHead>
              {canManage ? <TableHead className="text-right no-print">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="text-xs">{s.designation}</TableCell>
                <TableCell className="text-xs">{s.department ?? "-"}</TableCell>
                <TableCell><StatusBadge status={s.active ? "ACTIVE" : "INACTIVE"} /></TableCell>
                <TableCell className="text-xs">
                  {s.certifications.length === 0 ? "-" : s.certifications.map((c) => (
                    <div key={c.id}>{c.name} <span className="text-muted-foreground">({formatDate(c.expiresAt)})</span></div>
                  ))}
                </TableCell>
                {canManage ? (
                  <TableCell className="no-print text-right">
                    <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => setCertDialog(s)}>
                      <BadgeCheck className="h-3.5 w-3.5 text-teal-600" /> Certification
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {filtered.length === 0 ? <div className="p-6"><EmptyState title="No staff matched" hint="Try a different search." /></div> : null}
      </div>
      {certDialog ? (
        <CertificationDialog
          staff={certDialog}
          onClose={() => setCertDialog(null)}
          onSaved={() => { setCertDialog(null); void qc.invalidateQueries({ queryKey: ["hr"] }); }}
        />
      ) : null}
    </div>
  );
}

/* ─── Leave tab ────────────────────────────────────────────────────────────── */

function LeaveView({ data, canManage, qc }: { data: HrOverview; canManage: boolean; qc: ReturnType<typeof useQueryClient> }) {
  const act = useMutation({
    mutationFn: (input: { id: string; decision: "APPROVED" | "REJECTED" }) =>
      apiSend("POST", "/api/hr", { action: "decide-leave", id: input.id, decision: input.decision }),
    onSuccess: (_d, vars) => {
      toast.success(vars.decision === "APPROVED" ? "Leave approved. The requester has been notified." : "Leave rejected. The requester has been notified.");
      void qc.invalidateQueries({ queryKey: ["hr"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-4">
      {data.pendingLeave.length === 0 ? (
        <EmptyState title="No pending leave requests" hint="Requests submitted by staff through My Day will appear here." />
      ) : (
        <div className="space-y-2">
          {data.pendingLeave.map((l) => (
            <section key={l.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-3.5" aria-label={`Leave request from ${l.staffName}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{l.staffName}</span>
                  <span className="text-xs text-muted-foreground">{l.designation ?? ""}{l.department ? ` - ${l.department}` : ""}</span>
                </div>
                <div className="mt-0.5 text-xs text-stone-600">
                  {formatDate(l.fromAt)} to {formatDate(l.toAt)} - {l.reason}
                </div>
              </div>
              {canManage ? (
                <div className="flex gap-1.5 no-print">
                  <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" disabled={act.isPending} onClick={() => act.mutate({ id: l.id, decision: "APPROVED" })}>
                    <CircleCheck className="mr-1.5 h-4 w-4" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50" disabled={act.isPending} onClick={() => act.mutate({ id: l.id, decision: "REJECTED" })}>
                    <CircleX className="mr-1.5 h-4 w-4" /> Reject
                  </Button>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}

      {data.recentDecisions.length > 0 ? (
        <section className="rounded-xl border bg-white p-4" aria-label="Recent leave decisions">
          <h3 className="mb-3 text-sm font-semibold">Recent decisions</h3>
          <ul className="space-y-1.5 text-sm">
            {data.recentDecisions.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <span>{d.staffName} <span className="text-xs text-muted-foreground">{formatDate(d.fromAt)} to {formatDate(d.toAt)}</span></span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={d.status} />
                  {d.decidedAt ? <span className="text-[11px] text-muted-foreground">{formatDateTime(d.decidedAt)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/* ─── Attendance tab ───────────────────────────────────────────────────────── */

function Attendance({ data, canManage, qc }: { data: HrOverview; canManage: boolean; qc: ReturnType<typeof useQueryClient> }) {
  const today = todayIso();
  const marked = new Map(data.todayAttendance.map((a) => [a.staffId, a]));
  const act = useMutation({
    mutationFn: (input: { staffId: string; status: string }) =>
      apiSend("POST", "/api/hr", { action: "attendance", data: { staffId: input.staffId, date: today, status: input.status } }),
    onSuccess: (_d, vars) => {
      toast.success(`Marked ${vars.status.toLowerCase()}.`);
      void qc.invalidateQueries({ queryKey: ["hr"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const counts = data.todayAttendance.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {["PRESENT", "LATE", "ABSENT", "LEAVE", "OFF_DUTY"].map((s) => (
          <StatCard key={s} title={s.replace("_", " ")} value={counts[s] ?? 0} hint="marked today" />
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Staff</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Today</TableHead>
              {canManage ? <TableHead className="text-right no-print">Mark</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.staff.filter((s) => s.active).map((s) => {
              const rec = marked.get(s.id);
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-xs">{s.designation}</TableCell>
                  <TableCell>{rec ? <StatusBadge status={rec.status} /> : <span className="text-xs text-muted-foreground">Not marked</span>}</TableCell>
                  {canManage ? (
                    <TableCell className="no-print">
                      <div className="flex justify-end gap-1">
                        {["PRESENT", "LATE", "ABSENT", "LEAVE"].map((st) => (
                          <button
                            key={st}
                            onClick={() => act.mutate({ staffId: s.id, status: st })}
                            disabled={act.isPending}
                            className={`rounded border px-1.5 py-0.5 text-[10px] transition hover:border-teal-500 hover:bg-teal-50 ${rec?.status === st ? "border-teal-600 bg-teal-50 font-semibold text-teal-800" : "border-stone-200 text-stone-500"}`}
                            aria-label={`Mark ${s.name} as ${st}`}
                          >
                            {st === "OFF_DUTY" ? "OFF" : st}
                          </button>
                        ))}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {data.staff.length === 0 ? <div className="p-6"><EmptyState title="No staff records" hint="Add staff from the Staff console first." /></div> : null}
      </div>
    </div>
  );
}

/* ─── Reviews tab ──────────────────────────────────────────────────────────── */

function Reviews({ data, canManage, qc }: { data: HrOverview; canManage: boolean; qc: ReturnType<typeof useQueryClient> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end no-print">
          <Button size="sm" className="bg-teal-700 hover:bg-teal-800" onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New review
          </Button>
        </div>
      ) : null}
      {data.recentReviews.length === 0 ? (
        <EmptyState title="No performance reviews yet" hint="Create the first review for any staff member." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.recentReviews.map((r) => (
            <section key={r.id} className="rounded-xl border bg-white p-4" aria-label={`Review for ${r.staffName}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <span className="text-sm font-semibold">{r.staffName}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{r.designation ?? ""}</span>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.overallScore >= 4 ? "bg-emerald-100 text-emerald-700" : r.overallScore >= 3 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{r.overallScore}/5</span>
              </div>
              <div className="text-xs text-muted-foreground">{r.period} - {formatDate(r.reviewedAt)}</div>
              {r.strengths ? <p className="mt-2 text-xs"><span className="font-semibold">Strengths:</span> {r.strengths}</p> : null}
              {r.improvements ? <p className="mt-1 text-xs"><span className="font-semibold">Improvements:</span> {r.improvements}</p> : null}
              {r.goals ? <p className="mt-1 text-xs"><span className="font-semibold">Goals:</span> {r.goals}</p> : null}
            </section>
          ))}
        </div>
      )}
      {open ? (
        <ReviewDialog
          staff={data.staff}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); void qc.invalidateQueries({ queryKey: ["hr"] }); }}
        />
      ) : null}
    </div>
  );
}

/* ─── Announce tab ─────────────────────────────────────────────────────────── */

function Announce({ canManage, qc }: { canManage: boolean; qc: ReturnType<typeof useQueryClient> }) {
  const { session } = useApp();
  const roles = ["OWNER", "ADMIN", "RECEPTIONIST", "NURSE", "DOCTOR", "OPHTHALMOLOGIST", "OPTOMETRIST", "OPTICIAN", "DENTIST", "LAB", "PHARMACY", "BILLING", "ACCOUNTANT", "INVENTORY", "HR", "STAFF"];
  const [form, setForm] = useState({ title: "", body: "", role: "all", urgency: "NORMAL" });
  const send = useMutation<{ delivered: number }, Error, void>({
    mutationFn: async () => {
      const res = await apiSend<{ delivered: number }>("POST", "/api/hr", {
        action: "announce",
        data: { title: form.title.trim(), body: form.body.trim(), role: form.role === "all" ? null : form.role, urgency: form.urgency },
      });
      return res;
    },
    onSuccess: (d) => {
      toast.success(`Announcement delivered to ${d.delivered} staff inbox(es).`);
      setForm({ title: "", body: "", role: "all", urgency: "NORMAL" });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!canManage) return <PermissionDenied what="announcements" />;

  return (
    <div className="max-w-2xl space-y-4">
      <section className="rounded-xl border bg-white p-4" aria-label="Send announcement">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Megaphone className="h-4 w-4 text-teal-600" /> Facility announcement</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Delivered instantly to the dashboard notification bell and Team messages of every targeted staff member.
          Signed in as {session?.user?.name}.
        </p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ann-title">Title</Label>
            <Input id="ann-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} maxLength={160} placeholder="e.g. Staff briefing at 4 pm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ann-body">Message</Label>
            <Textarea id="ann-body" value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} rows={4} maxLength={2000} placeholder="Write the announcement…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Target audience</Label>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger aria-label="Audience"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone in this facility</SelectItem>
                  {roles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Urgency</Label>
              <Select value={form.urgency} onValueChange={(v) => setForm((f) => ({ ...f, urgency: v }))}>
                <SelectTrigger aria-label="Urgency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            className="bg-teal-700 hover:bg-teal-800" disabled={send.isPending}
            onClick={() => {
              if (form.title.trim().length < 2 || form.body.trim().length < 2) { toast.error("Give the announcement a title and a message."); return; }
              send.mutate();
            }}
          >
            <UserCheck className="mr-2 h-4 w-4" /> {send.isPending ? "Sending…" : "Send announcement"}
          </Button>
        </div>
      </section>
    </div>
  );
}

/* ─── Dialogs ──────────────────────────────────────────────────────────────── */

function CertificationDialog({ staff, onClose, onSaved }: { staff: HrStaff; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", expiresAt: "" });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (form.name.trim().length < 2) { toast.error("Name the certification."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.expiresAt)) { toast.error("Pick the expiry date."); return; }
    setBusy(true);
    try {
      await apiSend("POST", "/api/hr", { action: "certification", data: { staffId: staff.id, name: form.name.trim(), expiresAt: form.expiresAt } });
      toast.success("Certification recorded.");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record certification - {staff.name}</DialogTitle>
          <DialogDescription>Track professional credentials and their expiry dates.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cert-name">Certification</Label>
            <Input id="cert-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Optometry license" maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cert-exp">Expires</Label>
            <Input id="cert-exp" type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-teal-700 hover:bg-teal-800" disabled={busy} onClick={() => void submit()}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({ staff, onClose, onSaved }: { staff: HrStaff[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    staffId: staff[0]?.id ?? "", period: `Q${Math.floor(new Date().getMonth() / 3) + 1} ${new Date().getFullYear()}`,
    overallScore: "4", strengths: "", improvements: "", goals: "",
  });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!form.staffId) { toast.error("Choose a staff member."); return; }
    setBusy(true);
    try {
      await apiSend("POST", "/api/hr", {
        action: "review",
        data: {
          staffId: form.staffId, period: form.period.trim(), overallScore: Number(form.overallScore),
          strengths: form.strengths.trim() || null, improvements: form.improvements.trim() || null, goals: form.goals.trim() || null,
        },
      });
      toast.success("Performance review recorded.");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New performance review</DialogTitle>
          <DialogDescription>Score 1 (needs work) to 5 (outstanding). Saved to the staff record.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>Staff member</Label>
              <Select value={form.staffId} onValueChange={(v) => setForm((f) => ({ ...f, staffId: v }))}>
                <SelectTrigger aria-label="Staff member"><SelectValue /></SelectTrigger>
                <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.designation})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rev-score">Score</Label>
              <Select value={form.overallScore} onValueChange={(v) => setForm((f) => ({ ...f, overallScore: v }))}>
                <SelectTrigger aria-label="Score"><SelectValue /></SelectTrigger>
                <SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n} / 5</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rev-period">Period</Label>
            <Input id="rev-period" value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))} maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rev-strengths">Strengths</Label>
            <Textarea id="rev-strengths" value={form.strengths} onChange={(e) => setForm((f) => ({ ...f, strengths: e.target.value }))} rows={2} maxLength={1200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rev-improve">Improvements</Label>
            <Textarea id="rev-improve" value={form.improvements} onChange={(e) => setForm((f) => ({ ...f, improvements: e.target.value }))} rows={2} maxLength={1200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rev-goals">Goals for next period</Label>
            <Textarea id="rev-goals" value={form.goals} onChange={(e) => setForm((f) => ({ ...f, goals: e.target.value }))} rows={2} maxLength={1200} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-teal-700 hover:bg-teal-800" disabled={busy} onClick={() => void submit()}>{busy ? "Saving…" : "Save review"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Dashboard widget: HR requests ────────────────────────────────────────── */

export function HrRequestsWidget({ data }: { data: { pendingLeaves: number; onLeaveToday: number; certsExpiring: number; headcount: number } | undefined }) {
  if (!data) return null;
  return (
    <section aria-label="HR requests" className="curvilo-card curvilo-rise rounded-xl border bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <CalendarOff className="h-4 w-4 text-teal-600" aria-hidden />
        <h2 className="text-sm font-semibold">People & leave</h2>
        <BadgeCheck className="ml-auto h-3.5 w-3.5 text-stone-400" aria-hidden />
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-lg bg-stone-50 p-2">
          <div className="text-[11px] text-muted-foreground">Headcount</div>
          <div className="font-semibold tabular-nums">{data.headcount}</div>
        </div>
        <div className="rounded-lg bg-amber-50/70 p-2">
          <div className="text-[11px] text-muted-foreground">Pending leave</div>
          <div className="font-semibold tabular-nums">{data.pendingLeaves}</div>
        </div>
        <div className="rounded-lg bg-stone-50 p-2">
          <div className="text-[11px] text-muted-foreground">Certs expiring</div>
          <div className="font-semibold tabular-nums">{data.certsExpiring}</div>
        </div>
      </div>
    </section>
  );
}
