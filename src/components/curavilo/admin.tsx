"use client";

// Admin views: Workflows (builder), Audit, Settings, Staff, Follow-ups
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Plus, CircleCheck, CircleX, Wrench, ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiSend, formatMoney, formatDate, formatDateTime, type FollowUp, type StaffMember, type ServiceItem, type SessionInfo } from "./api";
import { LoadingState, ErrorState, EmptyState, PageHeader, StatusBadge } from "./ui-kit";
import { WorkflowBuilderDialog, type BuilderInitial, type BuilderNode } from "./workflow-builder";

import { useApp, can } from "./store";
import { toast } from "sonner";

// ─── Workflows ──────────────────────────────────────────────────────────────

interface WorkflowDef { id: string; key: string; name: string; description?: string | null; status: string; version: number; definition: string; slaMinutes?: number | null }
interface RunNode { nodeKey: string; type: string; status: string; attempts: number; output?: string | null; error?: string | null; wakeAt?: string | null }
interface WorkflowRun { id: string; status: string; version: number; triggerType: string; startedAt: string; completedAt?: string | null; dryRun: boolean; lastError?: string | null; slaBreachedAt?: string | null; workflowDef: { name: string }; nodes?: RunNode[] }
interface ApprovalTask { id: string; title: string; description?: string | null; status: string; decision?: string | null; createdAt: string; dueAt?: string | null; source: string }

export function Workflows() {
  const { session } = useApp();
  const canManage = session?.user?.permissions.includes("workflows:manage") || session?.user?.permissions.includes("settings:manage");
  const queryClient = useQueryClient();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<WorkflowDef | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => apiGet<{ nodeTypes: string[]; triggers: string[]; workflows: WorkflowDef[]; runs: WorkflowRun[]; approvals: ApprovalTask[] }>("/api/workflows"),
  });

  const toggle = useMutation({
    mutationFn: (workflowId: string) => apiSend("POST", "/api/workflows", { action: "PUBLISH_TOGGLE", workflowId }),
    onSuccess: () => {
      toast.success("Workflow state changed.");
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const run = useMutation({
    mutationFn: (workflowId: string) => apiSend("POST", "/api/workflows", { action: "RUN", workflowId, payload: {} }),
    onSuccess: () => {
      toast.success("Workflow run completed - check runs below.");
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const decide = useMutation({
    mutationFn: (input: { taskId: string; decision: "APPROVED" | "REJECTED" }) => apiSend("POST", "/api/workflows", { action: "RESOLVE_APPROVAL", ...input }),
    onSuccess: () => {
      toast.success("Decision recorded - the workflow resumed.");
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div>
      <PageHeader
        title="Workflows"
        subtitle="Durable, declarative automations - timers, conditions, approvals, retries and SLAs. Publish before they trigger on live events."
        actions={canManage ? (
          <Button size="sm" onClick={() => { setEditing(null); setBuilderOpen(true); }}>
            <Plus className="mr-1.5 h-4 w-4" /> Build workflow
          </Button>
        ) : null}
      />

      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}

      {data ? (
        <div className="space-y-6">
          <section aria-label="Approvals" className="space-y-2">
            <h2 className="text-sm font-semibold text-stone-600">Pending approvals</h2>
            {data.approvals.filter((a) => a.status === "OPEN").length === 0 ? (
              <p className="rounded-lg border bg-white px-4 py-4 text-center text-xs text-muted-foreground">No approvals waiting.</p>
            ) : (
              data.approvals.filter((a) => a.status === "OPEN").map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{a.title}</p>
                    <p className="text-xs text-muted-foreground">{a.description}{a.dueAt ? ` · SLA due ${formatDateTime(a.dueAt, session?.user?.timezone)}` : ""}</p>
                  </div>
                  {canManage ? (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => decide.mutate({ taskId: a.id, decision: "APPROVED" })} disabled={decide.isPending}>
                        <ThumbsUp className="mr-1 h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-700" onClick={() => decide.mutate({ taskId: a.id, decision: "REJECTED" })} disabled={decide.isPending}>
                        <ThumbsDown className="mr-1 h-3.5 w-3.5" /> Reject
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </section>

          <section aria-label="Definitions" className="space-y-2">
            {data.workflows.length === 0 ? (
              <EmptyState title="No workflows yet" hint="Build one - e.g. an outpatient flow: create task → notify → wait 24h → create follow-up." />
            ) : (
              data.workflows.map((wf) => {
                let nodeCount = 0;
                try { nodeCount = (JSON.parse(wf.definition) as { nodes?: unknown[] }).nodes?.length ?? 0; } catch { nodeCount = 0; }
                return (
                <div key={wf.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{wf.name}</span>
                      <StatusBadge status={wf.status} />
                      <Badge variant="outline" className="text-[10px]">v{wf.version}</Badge>
                      <Badge variant="outline" className="text-[10px]">{nodeCount} steps</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{wf.description ?? wf.key}</p>
                  </div>
                  {canManage ? (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => { setEditing(wf); setBuilderOpen(true); }}>
                        <Wrench className="mr-1 h-3.5 w-3.5" /> Builder
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => toggle.mutate(wf.id)} disabled={toggle.isPending}>
                        {wf.status === "PUBLISHED" ? "Archive" : "Publish"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => run.mutate(wf.id)} disabled={run.isPending || wf.status !== "PUBLISHED"}>
                        <Play className="mr-1 h-3.5 w-3.5" /> Test run
                      </Button>
                    </div>
                  ) : null}
                </div>
                );
              })
            )}
          </section>

          <section aria-label="Runs">
            <h2 className="mb-2 text-sm font-semibold text-stone-600">Recent runs</h2>
            {data.runs.length === 0 ? (
              <p className="rounded-lg border bg-white px-4 py-6 text-center text-sm text-muted-foreground">No runs yet.</p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-lg border bg-white text-sm">
                {data.runs.map((r) => (
                  <li key={r.id} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="font-medium">{r.workflowDef.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{r.triggerType.replaceAll("_", " ")} · {formatDateTime(r.startedAt, session?.user?.timezone)}</span>
                        {r.slaBreachedAt ? <Badge variant="outline" className="ml-1.5 border-red-200 bg-red-50 text-[10px] text-red-700">SLA breached</Badge> : null}
                      </span>
                      <StatusBadge status={r.status} />
                    </div>
                    {r.nodes && r.nodes.length > 0 ? (
                      <ol className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                        {r.nodes.map((n, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${n.status === "COMPLETED" ? "bg-emerald-500" : n.status === "FAILED" ? "bg-red-500" : n.status === "PENDING" ? "bg-stone-300" : "bg-amber-400"}`} aria-hidden />
                            <span>{n.nodeKey} · {n.type.replaceAll("_", " ")} · {n.status.toLowerCase()}{n.attempts > 1 ? ` (attempt ${n.attempts})` : ""}</span>
                            {n.output ? <span className="truncate">- {n.output.slice(0, 70)}</span> : null}
                            {n.error ? <span className="text-red-600">- {n.error.slice(0, 60)}</span> : null}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    {r.lastError ? <p className="mt-1 text-xs text-red-600">{r.lastError}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      <WorkflowBuilderDialog
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        initial={editing ? { workflowId: editing.id, key: editing.key, name: editing.name, definition: safeParse(editing.definition)?.definition, slaMinutes: editing.slaMinutes } : undefined}
      />
    </div>
  );
}

function safeParse(def: string): BuilderInitial | undefined {
  try {
    const parsed = JSON.parse(def) as { trigger?: string; nodes?: Array<{ id: string; type: string; config: Record<string, unknown> }>; schedule?: { everyMinutes?: number; dailyAt?: string } };
    return {
      definition: {
        ...parsed,
        nodes: parsed.nodes?.map((n) => ({ id: n.id, type: n.type as BuilderNode["type"], config: Object.fromEntries(Object.entries(n.config ?? {}).map(([k, v]) => [k, String(v)])) })),
      },
    };
  } catch {
    return undefined;
  }
}

// ─── Audit ──────────────────────────────────────────────────────────────────

interface AuditEvent { id: string; action: string; entityType: string; entityId?: string | null; summary: string; actorLabel?: string | null; createdAt: string }

export function Audit() {
  const { session } = useApp();
  const [actionFilter, setActionFilter] = useState("");
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["audit", actionFilter],
    queryFn: () => apiGet<{ events: AuditEvent[] }>(`/api/audit?action=${encodeURIComponent(actionFilter)}&limit=150`),
  });

  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Append-only record of who did what, when, and to which record." />
      <Input placeholder="Filter by action (e.g. payment, ai, encounter)…" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="mb-4 max-w-sm" aria-label="Filter audit events" />
      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}
      {data ? (
        data.events.length === 0 ? (
          <EmptyState title="No audit events" hint="Events appear as staff use the system." />
        ) : (
          <ul className="overflow-hidden rounded-lg border bg-white divide-y text-sm">
            {data.events.map((ev) => (
              <li key={ev.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <Badge variant="outline" className="mr-2 text-[10px]">{ev.action}</Badge>
                    <span className="text-xs text-muted-foreground">{ev.entityType}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(ev.createdAt, session?.user?.timezone)}</span>
                </div>
                <p className="mt-0.5 text-stone-700">{ev.summary}</p>
                {ev.actorLabel ? <p className="text-[11px] text-muted-foreground">by {ev.actorLabel}</p> : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

// ─── Staff ──────────────────────────────────────────────────────────────────

export function ClinicalDirectory() {
  const { session } = useApp();
  const canManage = session?.user?.permissions.includes("staff:manage");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", designation: "DOCTOR", department: "" });
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["staff"],
    queryFn: () => apiGet<{ staff: StaffMember[] }>("/api/staff"),
  });

  const create = useMutation({
    mutationFn: () => apiSend("POST", "/api/staff", { name: form.name.trim(), designation: form.designation, department: form.department.trim() || null }),
    onSuccess: () => {
      toast.success("Staff member added.");
      setOpen(false);
      setForm({ name: "", designation: "DOCTOR", department: "" });
      queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div>
      <PageHeader
        title="Staff"
        subtitle="Facility directory used for assignments and schedules."
        actions={canManage ? <Button className="bg-teal-700 hover:bg-teal-800" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" /> Add staff</Button> : null}
      />
      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}
      {data ? (
        data.staff.length === 0 ? (
          <EmptyState title="No staff records" hint={canManage ? "Add your first staff member." : undefined} />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-white">
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Designation</TableHead><TableHead className="hidden sm:table-cell">Department</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.staff.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.designation.replaceAll("_", " ")}</TableCell>
                    <TableCell className="hidden sm:table-cell">{s.department ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add staff member</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="st-name">Name *</Label>
              <Input id="st-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="st-desig">Designation</Label>
                <select id="st-desig" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                  {["DOCTOR", "NURSE", "OPTOMETRIST", "RECEPTIONIST", "PHARMACIST", "LAB_SCIENTIST", "CASHIER", "ADMIN", "OTHER"].map((d) => (
                    <option key={d} value={d}>{d.replaceAll("_", " ")}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="st-dept">Department</Label>
                <Input id="st-dept" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button className="bg-teal-700 hover:bg-teal-800" disabled={create.isPending || !form.name.trim()} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Follow-ups ─────────────────────────────────────────────────────────────

export function FollowUps() {
  const { session, navigate } = useApp();
  const canWrite = session?.user?.permissions.includes("encounters:write");
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["followups"],
    queryFn: () => apiGet<{ followUps: FollowUp[] }>("/api/followups?status=PENDING"),
  });

  const update = useMutation({
    mutationFn: ({ followUpId, status }: { followUpId: string; status: string }) => apiSend("PATCH", "/api/followups", { followUpId, status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["followups"] }),
    onError: (e) => toast.error((e as Error).message),
  });

  const now = new Date();

  return (
    <div>
      <PageHeader title="Follow-ups" subtitle="Pending reviews - overdue ones are highlighted." />
      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}
      {data ? (
        data.followUps.length === 0 ? (
          <EmptyState title="No pending follow-ups" hint="Follow-ups are created from completed encounters and workflows." />
        ) : (
          <ul className="space-y-2">
            {data.followUps.map((f) => {
              const overdue = new Date(f.dueAt) < now;
              return (
                <li key={f.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-3 text-sm ${overdue ? "border-amber-300" : ""}`}>
                  <span>
                    <button className="font-medium hover:text-teal-700 hover:underline" onClick={() => navigate("patient-detail", { patientId: f.patientId })}>
                      {f.patient ? `${f.patient.firstName} ${f.patient.lastName}` : "Patient"}
                    </button>
                    <span className="ml-2 text-muted-foreground">{f.title} · due {formatDate(f.dueAt, session?.user?.timezone)}</span>
                    {overdue ? <Badge variant="outline" className="ml-2 border-amber-300 bg-amber-50 text-amber-700">Overdue</Badge> : null}
                  </span>
                  {canWrite ? (
                    <span className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => update.mutate({ followUpId: f.id, status: "COMPLETED" })}>
                        <CircleCheck className="mr-1 h-3.5 w-3.5" /> Done
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => update.mutate({ followUpId: f.id, status: "CANCELLED" })}>
                        <CircleX className="mr-1 h-3.5 w-3.5" /> Cancel
                      </Button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </div>
  );
}

// ─── Settings ───────────────────────────────────────────────────────────────

interface FacilitySettings {
  id: string; name: string; address?: string | null; phone?: string | null; email?: string | null;
  logoData?: string | null; reportFooter?: string | null; receiptFooter?: string | null; serviceProfileKey: string;
}
interface ProfileInfo { name: string; description: string; terminology: Record<string, string> }

export function Settings() {
  const { session, setSession } = useApp();
  const [form, setForm] = useState<Partial<FacilitySettings>>({});
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useState<HTMLInputElement | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<{ facility: FacilitySettings; profile: ProfileInfo }>("/api/settings"),
  });

  const services = useQuery({
    queryKey: ["services"],
    queryFn: () => apiGet<{ services: ServiceItem[] }>("/api/services"),
  });

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />;
  if (!data) return null;

  const f = { ...data.facility, ...form };
  const currentLogo = logoPreview ?? f.logoData ?? null;

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { toast.error("Logo must be PNG, JPEG or WebP."); return; }
    if (file.size > 280_000) { toast.error("Logo must be smaller than 280 KB."); return; }
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setBusy(true);
    try {
      await apiSend("PATCH", "/api/settings", {
        name: f.name,
        address: f.address ?? null,
        phone: f.phone ?? null,
        email: f.email ?? "",
        logoData: currentLogo ?? "",
        reportFooter: f.reportFooter ?? null,
        receiptFooter: f.receiptFooter ?? null,
      });
      toast.success("Settings saved.");
      setLogoPreview(null);
      const fresh = await apiGet<SessionInfo>("/api/auth");
      setSession(fresh ?? { authenticated: false });
      refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Facility profile, branding, terminology and service catalogue." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Facility profile & branding</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-dashed bg-stone-50">
                {currentLogo ? (
                   
                  <img src={currentLogo} alt="Facility logo" className="h-full w-full object-contain" />
                ) : (
                  <span className="text-xs text-stone-400">No logo</span>
                )}
              </div>
              <div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  ref={(el) => { fileRef[0] = el; }}
                  onChange={(e) => pickLogo(e.target.files?.[0])}
                />
                <Button variant="outline" size="sm" onClick={() => fileRef[0]?.click()}>Upload logo</Button>
                <p className="mt-1 text-[11px] text-muted-foreground">PNG/JPEG/WebP, max 280 KB. SVG rejected for safety.</p>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="set-name">Facility name</Label>
              <Input id="set-name" value={f.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="set-address">Address</Label>
              <Input id="set-address" value={f.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="set-phone">Phone</Label>
                <Input id="set-phone" value={f.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="set-email">Email</Label>
                <Input id="set-email" value={f.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="set-rf">Report footer</Label>
              <Input id="set-rf" value={f.reportFooter ?? ""} onChange={(e) => setForm({ ...form, reportFooter: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="set-rf2">Receipt footer</Label>
              <Input id="set-rf2" value={f.receiptFooter ?? ""} onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })} />
            </div>
            <Button className="w-full bg-teal-700 hover:bg-teal-800" disabled={busy} onClick={() => void save()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save settings
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Service profile & terminology</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm font-medium">{data.profile.name}</p>
              <p className="text-xs text-muted-foreground">{data.profile.description}</p>
              <ul className="mt-3 space-y-1 text-sm">
                {Object.entries(data.profile.terminology).map(([k, v]) => (
                  <li key={k} className="flex justify-between rounded border px-2.5 py-1 text-xs">
                    <span className="font-mono text-muted-foreground">{k}</span>
                    <span className="font-medium">{v}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Service catalogue</CardTitle></CardHeader>
            <CardContent>
              <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
                {(services.data?.services ?? []).map((s) => (
                  <li key={s.id} className="flex items-center justify-between rounded border px-2.5 py-1.5">
                    <span>
                      {s.name}
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">{s.code}</span>
                    </span>
                    <span className="tabular-nums">{formatMoney(s.priceMinor, s.currency)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          {can("org:manage") ? <FacilityCredentialCard /> : null}
        </div>
      </div>
    </div>
  );
}

// ─── Facility access credential (owner-only, ADR 0011) ─────────────────────

function FacilityCredentialCard() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiGet<{ credentialEmail: string | null }>("/api/facility-credential")
      .then((r) => { if (active) { setEmail(r.credentialEmail ?? ""); setLoading(false); } })
      .catch(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const save = async () => {
    if (password && password !== confirm) {
      toast.error("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await apiSend("PATCH", "/api/facility-credential", {
        ...(email ? { email } : {}),
        ...(password ? { password } : {}),
      });
      toast.success("Facility access credential updated.");
      setPassword("");
      setConfirm("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Facility access credential</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          This is the workspace credential used at the facility access gate (step 1 of sign-in). It opens
          the facility only - it never grants staff permissions. Owner-only, changeable at any time.
        </p>
        {loading ? <LoadingState /> : (
          <>
            <div className="space-y-1">
              <Label htmlFor="cred-email">Facility gate email</Label>
              <Input id="cred-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="cred-pass">New gate password</Label>
                <Input id="cred-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave blank to keep" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cred-confirm">Confirm password</Label>
                <Input id="cred-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
            </div>
            <Button className="w-full bg-teal-700 hover:bg-teal-800" disabled={busy || (!password && !email)} onClick={() => void save()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Update facility credential
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
