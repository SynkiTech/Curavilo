"use client";

// Departments + custom roles tabs of the Staff console (ADR 0011, spec §25/§38).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Loader2, ShieldCheck, Lock, Users2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, LoadingState } from "./ui-kit";
import { apiSend } from "./api";
import { toast } from "sonner";
import { PROTECTED_PERMISSIONS } from "@/lib/rbac";

interface Department { id: string; name: string; facilityId?: string | null; memberCount: number }
interface RolesResponse {
  permissions: string[];
  protectedPermissions: string[];
  builtin: { key: string; permissions: string[] }[];
  custom: { id: string; name: string; key: string; permissions: string[]; active: boolean; memberCount: number }[];
}

// ─── Departments tab ────────────────────────────────────────────────────────

export function DepartmentsTab(props: {
  departments: Department[];
  isLoading: boolean;
  onChanged: () => void;
  canManage: boolean;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = useMutation({
    mutationFn: () => apiSend("POST", "/api/departments", { name }),
    onSuccess: () => {
      toast.success("Department created.");
      setName("");
      props.onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (d: Department) => apiSend("PATCH", "/api/departments", { id: d.id, active: false }),
    onSuccess: () => {
      toast.success("Department archived.");
      props.onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Departments</CardTitle>
        <p className="text-xs text-muted-foreground">Group staff into departments. Assignments sharpen authorization context and appear on role dashboards.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.canManage ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim().length >= 2 && !busy) create.mutate();
            }}
          >
            <div className="min-w-[220px] flex-1">
              <Label htmlFor="dept-name">New department name</Label>
              <Input id="dept-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Optometry, Front Desk" />
            </div>
            <Button type="submit" className="bg-teal-700 hover:bg-teal-800" disabled={busy || name.trim().length < 2}>
              {create.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />} Add
            </Button>
          </form>
        ) : null}
        {props.isLoading ? <LoadingState /> :
          props.departments.length === 0 ? <EmptyState title="No departments yet" hint="Add your first department above." /> : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Staff assigned</TableHead>
                    {props.canManage ? <TableHead className="text-right">Actions</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {props.departments.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{d.memberCount}</TableCell>
                      {props.canManage ? (
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => toggle.mutate(d)}>
                            <Trash2 className="mr-1 h-3.5 w-3.5" /> Archive
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
      </CardContent>
    </Card>
  );
}

// ─── Roles & permissions tab ────────────────────────────────────────────────

export function RolesTab(props: {
  roles?: RolesResponse;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<RolesResponse["custom"][number] | null>(null);

  if (!props.roles) return <LoadingState />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Custom roles</CardTitle>
              <p className="text-xs text-muted-foreground">
                Owner-defined roles with exactly the permissions you select. Protected permissions stay platform-owned.
              </p>
            </div>
            {props.canManage ? (
              <Button size="sm" className="bg-teal-700 hover:bg-teal-800" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> New custom role
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {props.roles.custom.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No custom roles yet - for example &quot;Front Desk Supervisor&quot; or &quot;Optical Manager&quot;.</p>
          ) : (
            <ul className="space-y-2">
              {props.roles.custom.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {c.name}
                      {!c.active ? <Badge variant="outline" className="text-stone-500">inactive</Badge> : null}
                      <Badge variant="outline" className="font-normal text-muted-foreground">{c.permissions.length} permissions</Badge>
                      <Badge variant="outline" className="font-normal text-muted-foreground">{c.memberCount} staff</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.permissions.join(", ") || "no permissions"}</p>
                  </div>
                  {props.canManage ? (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setEditing(c)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        void apiSend("PATCH", "/api/roles", { id: c.id, active: !c.active }).then(() => {
                          toast.success(c.active ? "Role deactivated." : "Role reactivated.");
                          props.onChanged();
                        }).catch((e: Error) => toast.error(e.message));
                      }}>
                        {c.active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Built-in roles</CardTitle>
          <p className="text-xs text-muted-foreground">The default permission set each built-in role grants. OWNER holds every permission including the protected ones.</p>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 md:grid-cols-2">
            {props.roles.builtin.map((b) => (
              <li key={b.key} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{b.key}</span>
                  <Badge variant="outline" className="font-normal text-muted-foreground">{b.permissions.length}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{b.permissions.join(", ")}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <RoleEditorDialog
        open={createOpen || editing !== null}
        editing={editing}
        roles={props.roles}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) setEditing(null);
        }}
        onSaved={() => {
          setCreateOpen(false);
          setEditing(null);
          props.onChanged();
        }}
      />
    </div>
  );
}

function RoleEditorDialog(props: {
  open: boolean;
  editing: RolesResponse["custom"][number] | null;
  roles: RolesResponse;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = props.editing !== null;
  const [name, setName] = useState(props.editing?.name ?? "");
  const [selected, setSelected] = useState<string[]>(props.editing?.permissions ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (p: string, on: boolean) =>
    setSelected((prev) => (on ? [...prev, p] : prev.filter((x) => x !== p)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (isEdit && props.editing) {
        await apiSend("PATCH", "/api/roles", { id: props.editing.id, name: name || props.editing.name, permissions: selected });
      } else {
        await apiSend("POST", "/api/roles", { name, permissions: selected });
      }
      toast.success(isEdit ? "Custom role updated." : "Custom role created.");
      props.onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-teal-700" aria-hidden />
            {isEdit ? "Edit custom role" : "Create custom role"}
          </DialogTitle>
          <DialogDescription>
            Choose exactly what this role may do. Example names: Senior Ophthalmic Nurse, Optical Manager, Front Desk Supervisor.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cr-name">Role name</Label>
            <Input id="cr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Front Desk Supervisor" />
          </div>
          <div className="rounded-lg border">
            <div className="flex items-center justify-between border-b bg-stone-50/70 px-3 py-2">
              <p className="text-xs font-semibold text-stone-600">Permissions</p>
              <p className="text-[11px] text-muted-foreground">{selected.length} selected</p>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto p-2">
              {props.roles.permissions.map((p) => {
                const protectedPerm = PROTECTED_PERMISSIONS.has(p);
                return (
                  <label key={p} className={`flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-stone-50 ${protectedPerm ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
                    <Checkbox
                      checked={selected.includes(p) || protectedPerm}
                      disabled={protectedPerm}
                      onCheckedChange={(v) => toggle(p, Boolean(v))}
                    />
                    <span className="flex-1">{p}</span>
                    {protectedPerm ? (
                      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-stone-400">
                        <Lock className="h-3 w-3" aria-hidden /> owner-only
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </div>
          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>Cancel</Button>
          <Button className="bg-teal-700 hover:bg-teal-800" disabled={busy || (!isEdit && name.trim().length < 2)} onClick={() => void save()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} {isEdit ? "Save changes" : "Create role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
