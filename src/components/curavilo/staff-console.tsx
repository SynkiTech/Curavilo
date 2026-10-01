"use client";

// Staff management console (ADR 0011, spec §37-39): searchable staff table with
// filters, add-staff wizard with role preview, staff profile with status
// lifecycle, password resets, permission overrides, login history. Departments
// and custom roles live in staff-config.tsx.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Search, Loader2, ShieldCheck, KeyRound, UserRound, Building2, Copy,
  History, LockOpen, UserX, UserCheck, Ban, RefreshCcw, BadgeCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { apiGet, apiSend, formatDateTime, type SessionInfo } from "./api";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "./ui-kit";
import { useApp, can } from "./store";
import { toast } from "sonner";
import { ROLES, ROLE_PERMISSIONS, MODULE_PERMISSION, PROTECTED_PERMISSIONS, PERMISSIONS } from "@/lib/rbac";
import { DepartmentsTab, RolesTab } from "./staff-config";
import { ClinicalDirectory } from "./admin";

// ─── Types ──────────────────────────────────────────────────────────────────

interface StaffRow {
  id: string; email: string; name: string; status: string;
  firstName?: string | null; lastName?: string | null;
  phone?: string | null; staffCode?: string | null; designation?: string | null;
  employmentStatus?: string | null; serviceLine?: string | null;
  department?: string | null; departmentId?: string | null;
  photoData?: string | null; mustChangePassword?: boolean;
  lockedUntil?: string | null; lastLoginAt?: string | null; createdAt: string;
  role: string; customRoleId?: string | null; customRoleName?: string | null;
  facilityIds: string[];
}

interface Department { id: string; name: string; facilityId?: string | null; memberCount: number }
interface CustomRole { id: string; name: string; key: string; permissions: string[]; active: boolean; memberCount: number }
interface RolesResponse { permissions: string[]; protectedPermissions: string[]; builtin: { key: string; permissions: string[] }[]; custom: CustomRole[] }

interface StaffDetail {
  staff: StaffRow & { createdAt: string };
  membership: { role: string; customRoleId: string | null; customRole: { id: string; name: string; permissions: string[] } | null } | null;
  overrides: { id: string; permission: string; effect: string }[];
  facilities: { id: string; name: string }[];
  departments: Department[];
  history: { id: string; action: string; summary: string; createdAt: string }[];
  activity: { id: string; action: string; summary: string; createdAt: string }[];
  openTasks: { id: string; title: string; priority: string; status: string }[];
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  INVITED: "border-cyan-200 bg-cyan-50 text-cyan-700",
  INACTIVE: "border-stone-200 bg-stone-50 text-stone-600",
  SUSPENDED: "border-amber-200 bg-amber-50 text-amber-700",
  LOCKED: "border-red-200 bg-red-50 text-red-700",
  TERMINATED: "border-red-300 bg-red-100 text-red-800",
};

const MODULE_LABELS: Record<string, string> = {
  overview: "Dashboard", patients: "Patients", appointments: "Appointments", queue: "Queue",
  encounters: "Clinical encounters", billing: "Billing", pos: "POS / Pharmacy sales",
  inventory: "Inventory", reports: "Reports", ai: "AI assistant", lab: "Lab & Radiology",
  wards: "Wards & Admissions", workflows: "Workflows", command: "Command Center",
  simulation: "Simulation", comms: "Communications", data: "Data & Portals",
  staff: "Staff management", myday: "My Day", audit: "Audit log", settings: "Settings",
};

/** Role preview (spec §39): what this role can and cannot access, in plain language. */
function rolePreview(roleKey: string, custom?: CustomRole | null, customRoleList?: CustomRole[]) {
  const perms = custom
    ? custom.permissions
    : ROLE_PERMISSIONS[roleKey as keyof typeof ROLE_PERMISSIONS] ?? [];
  const modules = Object.entries(MODULE_PERMISSION)
    .filter(([, perm]) => perms.includes(perm as never))
    .map(([mod]) => MODULE_LABELS[mod] ?? mod);
  const deniedGuards = ["staff:manage", "settings:manage", "roles:manage", "org:manage", "audit:read"];
  const denied = deniedGuards.filter((p) => !perms.includes(p as never)).map((p) => ({
    "staff:manage": "Staff account administration",
    "settings:manage": "Facility configuration",
    "roles:manage": "Role & permission management",
    "org:manage": "Facility credentials & organization administration",
    "audit:read": "Audit log",
  }[p]!));
  void customRoleList;
  return { modules: [...new Set(modules)], denied };
}

function initials(name: string): string {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

// ─── Main component ─────────────────────────────────────────────────────────

export function StaffConsole() {
  const sessionUser = useApp((s) => s.session?.user);
  const [tab, setTab] = useState("staff");
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ["staff-accounts", q, roleFilter, statusFilter, departmentFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (roleFilter !== "all") params.set("role", roleFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (departmentFilter !== "all") params.set("departmentId", departmentFilter);
      return apiGet<{ staff: StaffRow[]; facilities: { id: string; name: string }[] }>(`/api/staff-accounts?${params.toString()}`);
    },
  });

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => apiGet<{ departments: Department[] }>("/api/departments"),
  });

  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => apiGet<RolesResponse>("/api/roles"),
  });

  const deactivate = useMutation({
    mutationFn: (input: { userId: string; value: string }) =>
      apiSend("PATCH", "/api/staff-accounts", { action: "SET_STATUS", ...input }),
    onSuccess: () => {
      toast.success("Account updated. Sessions were invalidated where needed.");
      void list.refetch();
      void queryClient.invalidateQueries({ queryKey: ["staff-detail"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = list.data?.staff ?? [];
  const isPrivileged = sessionUser?.role === "OWNER" || sessionUser?.role === "ADMIN";

  return (
    <div>
      <PageHeader
        title="Staff"
        subtitle="Individual staff accounts, roles, departments and permissions. Every account gets its own dashboard based on its role."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="staff">Staff accounts</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="roles">Roles &amp; permissions</TabsTrigger>
          <TabsTrigger value="directory">Assignment directory</TabsTrigger>
        </TabsList>

        <TabsContent value="staff">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[180px] flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search name, email or staff ID…"
                    className="pl-8"
                    aria-label="Search staff"
                  />
                </div>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-[150px]" aria-label="Filter by role"><SelectValue placeholder="Role" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    {(roles.data?.custom ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px]" aria-label="Filter by status"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {["ACTIVE", "INVITED", "INACTIVE", "SUSPENDED", "LOCKED", "TERMINATED"].map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                  <SelectTrigger className="w-[150px]" aria-label="Filter by department"><SelectValue placeholder="Department" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {(departments.data?.departments ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isPrivileged ? (
                  <Button className="ml-auto bg-teal-700 hover:bg-teal-800" onClick={() => setAddOpen(true)}>
                    <Plus className="mr-1.5 h-4 w-4" /> Add Staff
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {list.isLoading ? <LoadingState /> :
                list.isError ? <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} /> :
                  rows.length === 0 ? <EmptyState title="No staff found" hint="Try clearing the filters or add a staff member." /> : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead className="hidden md:table-cell">Department</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="hidden lg:table-cell">Last login</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((s) => (
                            <TableRow key={s.id}>
                              <TableCell>
                                <div className="flex items-center gap-2.5">
                                  <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-teal-100 to-cyan-100 text-[11px] font-bold text-teal-800">
                                    {s.photoData ? <img src={s.photoData} alt="" className="h-full w-full object-cover" /> : initials(s.name)}
                                  </span>
                                  <div className="min-w-0">
                                    <div className="truncate font-medium">{s.name}</div>
                                    <div className="truncate text-xs text-muted-foreground">{s.email}{s.staffCode ? ` · ${s.staffCode}` : ""}</div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="font-medium">{s.customRoleName ?? s.role}</Badge>
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{s.department ?? "-"}</TableCell>
                              <TableCell>
                                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[s.status] ?? STATUS_STYLE.INACTIVE}`}>
                                  {s.status === "LOCKED" ? <Ban className="h-3 w-3" aria-hidden /> : null}
                                  {s.status}
                                </span>
                                {s.mustChangePassword ? (
                                  <span className="ml-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">temp pw</span>
                                ) : null}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{formatDateTime(s.lastLoginAt)}</TableCell>
                              <TableCell className="text-right">
                                <Button variant="outline" size="sm" onClick={() => setDetailId(s.id)}>View</Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="departments">
          <DepartmentsTab departments={departments.data?.departments ?? []} isLoading={departments.isLoading}
            onChanged={() => { void departments.refetch(); void list.refetch(); }} canManage={isPrivileged} />
        </TabsContent>

        <TabsContent value="roles">
          <RolesTab roles={roles.data} canManage={can("roles:manage")}
            onChanged={() => { void roles.refetch(); void list.refetch(); }} />
        </TabsContent>

        <TabsContent value="directory">
          <ClinicalDirectory />
        </TabsContent>
      </Tabs>

      <AddStaffDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        departments={departments.data?.departments ?? []}
        facilities={list.data?.facilities ?? []}
        roles={roles.data}
        onCreated={() => { void list.refetch(); void departments.refetch(); }}
      />

      {detailId ? (
        <StaffDetailSheet
          userId={detailId}
          onClose={() => setDetailId(null)}
          roles={roles.data}
          onChanged={() => { void list.refetch(); void departments.refetch(); void roles.refetch(); }}
          onStatusChange={(value) => deactivate.mutate({ userId: detailId, value })}
        />
      ) : null}
    </div>
  );
}

// ─── Add staff wizard with role preview (spec §38-39) ───────────────────────

function AddStaffDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  departments: Department[];
  facilities: { id: string; name: string }[];
  roles?: RolesResponse;
  onCreated: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [staffCode, setStaffCode] = useState("");
  const [designation, setDesignation] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState<string>("FULL_TIME");
  const [role, setRole] = useState<string>("RECEPTIONIST");
  const [customRoleId, setCustomRoleId] = useState<string>("");
  const [departmentId, setDepartmentId] = useState<string>("none");
  const [serviceLine, setServiceLine] = useState<string>("");
  const [accessMode, setAccessMode] = useState<"INVITE" | "TEMP_PASSWORD">("INVITE");
  const [tempPassword, setTempPassword] = useState("");
  const [facilityIds, setFacilityIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ inviteLink?: string | null; tempPassword?: string | null } | null>(null);

  const customRole = props.roles?.custom.find((c) => c.id === customRoleId) ?? null;
  const preview = useMemo(() => rolePreview(role, customRole), [role, customRole]);

  const reset = () => {
    setFirstName(""); setLastName(""); setEmail(""); setPhone(""); setStaffCode("");
    setDesignation(""); setEmploymentStatus("FULL_TIME"); setRole("RECEPTIONIST");
    setCustomRoleId(""); setDepartmentId("none"); setServiceLine("");
    setAccessMode("INVITE"); setTempPassword(""); setFacilityIds([]);
    setError(null); setSecret(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ inviteLink?: string | null; tempPassword?: string | null }>("POST", "/api/staff-accounts", {
        firstName, lastName, email, phone: phone || null, staffCode: staffCode || null,
        designation: designation || null, employmentStatus: employmentStatus || null,
        role: customRoleId ? "STAFF" : role,
        customRoleId: customRoleId || null,
        departmentId: departmentId === "none" ? null : departmentId,
        serviceLine: serviceLine || null,
        facilityIds: facilityIds.length > 0 ? facilityIds : props.facilities.map((f) => f.id),
        access: accessMode === "INVITE" ? { mode: "INVITE" } : { mode: "TEMP_PASSWORD", tempPassword },
      });
      setSecret(res);
      props.onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const effectiveRole = customRole ? "custom" : role;

  return (
    <Dialog open={props.open} onOpenChange={(o) => { props.onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add staff member</DialogTitle>
          <DialogDescription>
            Create an individual account. The role determines the staff member&apos;s default access to Curavilo.
          </DialogDescription>
        </DialogHeader>

        {secret ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>Account created. Share this one-time secret with the staff member now - it will never be shown again.</p>
            </div>
            {secret.inviteLink ? (
              <div className="rounded-lg border bg-white p-3 text-sm">
                <p className="mb-1 font-medium">Invitation link (valid 7 days)</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-stone-100 px-2 py-1 text-xs">{secret.inviteLink}</code>
                  <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(secret.inviteLink!); toast.success("Link copied."); }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : null}
            {secret.tempPassword ? (
              <div className="rounded-lg border bg-white p-3 text-sm">
                <p className="mb-1 font-medium">Temporary password (must be changed at first login)</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-stone-100 px-2 py-1 text-xs">{secret.tempPassword}</code>
                  <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(secret.tempPassword!); toast.success("Password copied."); }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : null}
            <DialogFooter>
              <Button className="bg-teal-700 hover:bg-teal-800" onClick={() => { props.onOpenChange(false); reset(); }}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-[1fr_240px]">
            <div className="space-y-4">
              <section aria-label="Personal information" className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Personal information</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="as-first">First name</Label>
                    <Input id="as-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="as-last">Last name</Label>
                    <Input id="as-last" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="as-email">Email</Label>
                    <Input id="as-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="as-phone">Phone</Label>
                    <Input id="as-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="as-code">Staff ID / Employee ID</Label>
                  <Input id="as-code" value={staffCode} onChange={(e) => setStaffCode(e.target.value)} placeholder="e.g. EYE-014" />
                </div>
              </section>

              <Separator />

              <section aria-label="Professional information" className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Professional information</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="as-role">Role</Label>
                    <Select value={customRoleId ? `custom:${customRoleId}` : role} onValueChange={(v) => {
                      if (v.startsWith("custom:")) { setCustomRoleId(v.slice(7)); } else { setCustomRoleId(""); setRole(v); }
                    }}>
                      <SelectTrigger id="as-role"><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        {ROLES.filter((r) => r !== "OWNER").map((r) => (
                          <SelectItem key={r} value={r}>{r}</SelectItem>
                        ))}
                        {(props.roles?.custom ?? []).filter((c) => c.active).map((c) => (
                          <SelectItem key={c.id} value={`custom:${c.id}`}>{c.name} (custom)</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="as-dept">Department</Label>
                    <Select value={departmentId} onValueChange={setDepartmentId}>
                      <SelectTrigger id="as-dept"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No department</SelectItem>
                        {props.departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="as-desig">Professional designation</Label>
                    <Input id="as-desig" value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. OD, RN, BPharm" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="as-emp">Employment status</Label>
                    <Select value={employmentStatus} onValueChange={setEmploymentStatus}>
                      <SelectTrigger id="as-emp"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["FULL_TIME", "PART_TIME", "CONTRACT", "LOCUM"].map((s) => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="as-line">Service line</Label>
                  <Input id="as-line" value={serviceLine} onChange={(e) => setServiceLine(e.target.value)} placeholder="e.g. Optometry, General Medicine" />
                </div>
              </section>

              <Separator />

              <section aria-label="Facility assignment" className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Facility assignment</p>
                {props.facilities.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Facilities will be assigned automatically.</p>
                ) : (
                  <div className="space-y-1.5">
                    {props.facilities.map((f) => (
                      <label key={f.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={facilityIds.includes(f.id)}
                          onCheckedChange={(v) => setFacilityIds((prev) => v ? [...prev, f.id] : prev.filter((x) => x !== f.id))}
                        />
                        <Building2 className="h-3.5 w-3.5 text-stone-400" aria-hidden />
                        {f.name}
                      </label>
                    ))}
                    <p className="text-[11px] text-muted-foreground">Unassigned facilities default to all.</p>
                  </div>
                )}
              </section>

              <Separator />

              <section aria-label="Access" className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Access</p>
                <div className="grid grid-cols-1 gap-2">
                  <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${accessMode === "INVITE" ? "border-teal-400 bg-teal-50/50" : ""}`}>
                    <input type="radio" name="access" className="mt-1" checked={accessMode === "INVITE"} onChange={() => setAccessMode("INVITE")} />
                    <span>
                      <span className="font-medium">Send invitation (recommended)</span>
                      <span className="block text-xs text-muted-foreground">The staff member opens a one-time link and sets their own password.</span>
                    </span>
                  </label>
                  <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${accessMode === "TEMP_PASSWORD" ? "border-teal-400 bg-teal-50/50" : ""}`}>
                    <input type="radio" name="access" className="mt-1" checked={accessMode === "TEMP_PASSWORD"} onChange={() => setAccessMode("TEMP_PASSWORD")} />
                    <span>
                      <span className="font-medium">Set a temporary password</span>
                      <span className="block text-xs text-muted-foreground">They must change it at first login. Never displayed again after creation.</span>
                    </span>
                  </label>
                  {accessMode === "TEMP_PASSWORD" ? (
                    <div className="space-y-1 pl-1">
                      <Label htmlFor="as-temp">Temporary password</Label>
                      <Input id="as-temp" type="text" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} placeholder="8+ chars, letters and numbers" />
                    </div>
                  ) : null}
                </div>
              </section>

              {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
            </div>

            {/* Role preview (spec §39) */}
            <aside aria-label="Role preview" className="rounded-xl border border-teal-200 bg-teal-50/40 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-teal-800">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                What this staff member can access
              </p>
              <p className="mt-1 text-[11px] text-teal-700">Role: {customRole ? `${customRole.name} (custom)` : effectiveRole}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Can access</p>
              <ul className="mt-1 space-y-0.5 text-xs text-stone-700">
                {preview.modules.map((m) => <li key={m}>✓ {m}</li>)}
              </ul>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-red-600">Cannot access</p>
              <ul className="mt-1 space-y-0.5 text-xs text-stone-700">
                {preview.denied.map((m) => <li key={m}>✕ {m}</li>)}
              </ul>
              <p className="mt-3 text-[10px] leading-snug text-teal-700/80">
                Permissions are enforced on the server, not just hidden in the menu. Overrides can fine-tune this later.
              </p>
            </aside>
          </div>
        )}

        {!secret ? (
          <DialogFooter>
            <Button variant="outline" onClick={() => props.onOpenChange(false)}>Cancel</Button>
            <Button className="bg-teal-700 hover:bg-teal-800" disabled={busy || !firstName || !lastName || !email || (accessMode === "TEMP_PASSWORD" && !tempPassword)} onClick={() => void submit()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Create account
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ─── Staff detail sheet ─────────────────────────────────────────────────────

export function StaffDetailSheet(props: {
  userId: string;
  onClose: () => void;
  roles?: RolesResponse;
  onChanged: () => void;
  onStatusChange: (value: string) => void;
}) {
  const canManageRoles = can("roles:manage");
  const [statusBusy, setStatusBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [newTemp, setNewTemp] = useState("");
  const [shownTemp, setShownTemp] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState<string>("");
  const [overridesDraft, setOverridesDraft] = useState<Record<string, "GRANT" | "DENY" | null>>({});

  const detail = useQuery({
    queryKey: ["staff-detail", props.userId],
    queryFn: () => apiGet<StaffDetail>(`/api/staff-accounts?userId=${props.userId}`),
  });

  const s = detail.data?.staff;
  const effectivePerms = useMemo(() => {
    if (!detail.data) return [];
    const base = detail.data.membership?.customRole?.permissions
      ?? ROLE_PERMISSIONS[(detail.data.membership?.role ?? "STAFF") as keyof typeof ROLE_PERMISSIONS] ?? [];
    const set = new Set<string>(base);
    for (const o of detail.data.overrides) {
      if (PROTECTED_PERMISSIONS.has(o.permission)) continue;
      if (o.effect === "GRANT") set.add(o.permission);
      else set.delete(o.permission);
    }
    return [...set];
  }, [detail.data]);

  const applyStatus = async (value: string) => {
    setStatusBusy(true);
    try {
      props.onStatusChange(value);
      // small delay lets the mutation toast land before we re-query
      setTimeout(() => void detail.refetch(), 400);
    } finally {
      setStatusBusy(false);
    }
  };

  const resetPassword = async () => {
    setResetBusy(true);
    try {
      const res = await apiSend<{ tempPassword?: string | null }>("PATCH", "/api/staff-accounts", {
        action: "RESET_PASSWORD", userId: props.userId, ...(newTemp ? { tempPassword: newTemp } : {}),
      });
      setShownTemp(res.tempPassword ?? null);
      setNewTemp("");
      toast.success("Temporary password issued. All previous sessions were signed out.");
      void detail.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setResetBusy(false);
    }
  };

  const saveRole = async () => {
    try {
      const value = roleDraft || `${detail.data?.membership?.role ?? ""}`;
      const isCustom = value.startsWith("custom:");
      await apiSend("PATCH", "/api/staff-accounts", {
        action: "SET_ROLE", userId: props.userId,
        ...(isCustom ? { customRoleId: value.slice(7) } : { role: value }),
      });
      toast.success("Role changed. The staff member will re-authenticate.");
      void detail.refetch();
      props.onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const beginOverrides = () => {
    if (!detail.data) return;
    const draft: Record<string, "GRANT" | "DENY" | null> = {};
    for (const o of detail.data.overrides) draft[o.permission] = o.effect as "GRANT" | "DENY";
    setOverridesDraft(draft);
  };

  const saveOverrides = async () => {
    try {
      await apiSend("PATCH", "/api/staff-accounts", {
        action: "SET_PERMISSIONS", userId: props.userId,
        overrides: Object.entries(overridesDraft).map(([permission, effect]) => ({ permission, effect })),
      });
      toast.success("Permission overrides saved.");
      void detail.refetch();
      props.onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) props.onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-teal-100 to-cyan-100 text-xs font-bold text-teal-800">
              {s ? initials(s.name) : "?"}
            </span>
            {s?.name ?? "Staff profile"}
          </SheetTitle>
        </SheetHeader>
        {detail.isLoading ? <LoadingState /> :
          detail.isError ? <ErrorState message={(detail.error as Error).message} onRetry={() => void detail.refetch()} /> :
            s && detail.data ? (
              <div className="mt-4 space-y-5">
                {/* Identity */}
                <section className="rounded-xl border bg-white p-4 text-sm">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">Identity</p>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    <dt className="text-muted-foreground">Email</dt><dd className="break-all">{s.email}</dd>
                    <dt className="text-muted-foreground">Staff ID</dt><dd>{s.staffCode ?? "-"}</dd>
                    <dt className="text-muted-foreground">Phone</dt><dd>{s.phone ?? "-"}</dd>
                    <dt className="text-muted-foreground">Designation</dt><dd>{s.designation ?? "-"}</dd>
                    <dt className="text-muted-foreground">Employment</dt><dd>{s.employmentStatus?.replaceAll("_", " ") ?? "-"}</dd>
                    <dt className="text-muted-foreground">Department</dt>
                    <dd>{detail.data.departments.find((d) => d.id === s.departmentId)?.name ?? "-"}</dd>
                    <dt className="text-muted-foreground">Service line</dt><dd>{s.serviceLine ?? "-"}</dd>
                    <dt className="text-muted-foreground">Facilities</dt>
                    <dd>{detail.data.facilities.map((f) => f.name).join(", ") || "-"}</dd>
                    <dt className="text-muted-foreground">Last login</dt><dd>{formatDateTime(s.lastLoginAt)}</dd>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd><span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[s.status] ?? ""}`}>{s.status}</span></dd>
                  </dl>
                </section>

                {/* Status lifecycle */}
                <section className="rounded-xl border bg-white p-4 text-sm">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">Account status</p>
                  <div className="flex flex-wrap gap-2">
                    {s.status !== "ACTIVE" ? (
                      <Button size="sm" variant="outline" disabled={statusBusy} onClick={() => void applyStatus("ACTIVATE")}>
                        <UserCheck className="mr-1 h-3.5 w-3.5" /> Activate
                      </Button>
                    ) : null}
                    {s.status === "ACTIVE" ? (
                      <>
                        <Button size="sm" variant="outline" disabled={statusBusy} onClick={() => void applyStatus("SUSPEND")}>
                          <Ban className="mr-1 h-3.5 w-3.5" /> Suspend
                        </Button>
                        <Button size="sm" variant="outline" disabled={statusBusy} onClick={() => void applyStatus("DEACTIVATE")}>
                          <UserX className="mr-1 h-3.5 w-3.5" /> Deactivate
                        </Button>
                      </>
                    ) : null}
                    {s.status === "LOCKED" ? (
                      <Button size="sm" variant="outline" disabled={statusBusy} onClick={() => void applyStatus("UNLOCK")}>
                        <LockOpen className="mr-1 h-3.5 w-3.5" /> Unlock
                      </Button>
                    ) : null}
                    {s.status !== "TERMINATED" ? (
                      <Button size="sm" variant="outline" className="text-red-600" disabled={statusBusy} onClick={() => void applyStatus("TERMINATE")}>
                        <UserX className="mr-1 h-3.5 w-3.5" /> Terminate
                      </Button>
                    ) : null}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Deactivated, suspended or terminated staff cannot sign in, and their existing sessions are invalidated immediately. Historical records keep their original author references.
                  </p>
                </section>

                {/* Password management */}
                <section className="rounded-xl border bg-white p-4 text-sm">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400">
                    <KeyRound className="h-3.5 w-3.5" /> Password
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[180px] flex-1">
                      <Label htmlFor="sd-temp">Temporary password (optional)</Label>
                      <Input id="sd-temp" value={newTemp} onChange={(e) => setNewTemp(e.target.value)} placeholder="Auto-generate if empty" />
                    </div>
                    <Button size="sm" variant="outline" disabled={resetBusy} onClick={() => void resetPassword()}>
                      <RefreshCcw className={`mr-1 h-3.5 w-3.5 ${resetBusy ? "animate-spin" : ""}`} /> Reset password
                    </Button>
                  </div>
                  {shownTemp ? (
                    <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      One-time temporary password: <code className="rounded bg-white px-1 font-bold">{shownTemp}</code> - the staff member must change it at next sign-in.
                    </p>
                  ) : null}
                </section>

                {/* Role */}
                <section className="rounded-xl border bg-white p-4 text-sm">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">Role</p>
                  {canManageRoles ? (
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Label htmlFor="sd-role">Assigned role</Label>
                        <Select value={roleDraft || (detail.data.membership?.customRoleId ? `custom:${detail.data.membership.customRoleId}` : detail.data.membership?.role ?? "STAFF")} onValueChange={setRoleDraft}>
                          <SelectTrigger id="sd-role"><SelectValue /></SelectTrigger>
                          <SelectContent className="max-h-64">
                            {ROLES.filter((r) => r !== "OWNER").map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                            {(props.roles?.custom ?? []).map((c) => <SelectItem key={c.id} value={`custom:${c.id}`}>{c.name} (custom)</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button size="sm" disabled={!roleDraft} onClick={() => void saveRole()}>Save role</Button>
                    </div>
                  ) : (
                    <p className="text-muted-foreground">
                      {detail.data.membership?.customRole?.name ?? detail.data.membership?.role} - only the facility owner can change roles.
                    </p>
                  )}
                </section>

                {/* Effective permissions */}
                <section className="rounded-xl border bg-white p-4 text-sm">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400">
                    <ShieldCheck className="h-3.5 w-3.5" /> Effective permissions
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {effectivePerms.map((p) => (
                      <span key={p} className="rounded bg-teal-50 px-1.5 py-0.5 text-[11px] text-teal-800">{p}</span>
                    ))}
                  </div>
                  {canManageRoles ? (
                    <>
                      <p className="mt-3 mb-2 text-[11px] text-muted-foreground">
                        Fine-tune with per-user overrides. Protected permissions ({[...PROTECTED_PERMISSIONS].join(", ")}) stay owner-only.
                      </p>
                      <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border p-2">
                        {(props.roles?.permissions ?? [...PERMISSIONS]).map((p) => {
                          const state = overridesDraft[p] ?? null;
                          const disabled = PROTECTED_PERMISSIONS.has(p);
                          return (
                            <div key={p} className={`flex items-center justify-between gap-2 text-xs ${disabled ? "opacity-50" : ""}`}>
                              <span className="truncate">{p}</span>
                              <Select
                                value={state ?? "inherit"}
                                disabled={disabled}
                                onValueChange={(v) => setOverridesDraft((prev) => ({ ...prev, [p]: v === "inherit" ? null : (v as "GRANT" | "DENY") }))}
                              >
                                <SelectTrigger className="h-7 w-[110px] text-[11px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="inherit">Inherit role</SelectItem>
                                  <SelectItem value="GRANT">Grant extra</SelectItem>
                                  <SelectItem value="DENY">Deny</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })}
                      </div>
                      <Button size="sm" className="mt-2 bg-teal-700 hover:bg-teal-800" onClick={() => (Object.keys(overridesDraft).length ? void saveOverrides() : void beginOverrides())}>
                        {Object.keys(overridesDraft).length ? "Save overrides" : "Edit overrides"}
                      </Button>
                    </>
                  ) : null}
                </section>

                {/* Login history */}
                <section className="rounded-xl border bg-white p-4 text-sm">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400">
                    <History className="h-3.5 w-3.5" /> Login history
                  </p>
                  {detail.data.history.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No authentication events recorded yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {detail.data.history.map((h) => (
                        <li key={h.id} className="flex items-start justify-between gap-2 text-xs">
                          <span className="text-stone-700">{h.action.replace("staff.", "").replace("facility.", "")}</span>
                          <span className="shrink-0 text-muted-foreground">{formatDateTime(h.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* Recent activity */}
                <section className="rounded-xl border bg-white p-4 text-sm">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">Recent activity</p>
                  {detail.data.activity.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No activity recorded yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {detail.data.activity.slice(0, 10).map((h) => (
                        <li key={h.id} className="text-xs">
                          <span className="font-medium text-stone-700">{h.summary}</span>
                          <span className="ml-1.5 text-muted-foreground">{formatDateTime(h.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            ) : null}
      </SheetContent>
    </Sheet>
  );
}
