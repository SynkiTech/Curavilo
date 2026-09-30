"use client";

// Patients — searchable registry with duplicate warnings + registration dialog
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiSend, ageFrom, type Patient } from "./api";
import { LoadingState, ErrorState, EmptyState, PageHeader } from "./ui-kit";
import { useApp } from "./store";
import { toast } from "sonner";

interface DuplicateWarning { id: string; mrn: string; name: string; phone: string; reason: string }

export function Patients() {
  const { navigate, session } = useApp();
  const tz = session?.user?.timezone ?? "Africa/Lagos";
  const canWrite = session?.user?.permissions.includes("patients:write");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["patients", query],
    queryFn: () => apiGet<{ patients: Patient[] }>(`/api/patients?q=${encodeURIComponent(query)}&limit=100`),
  });

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle="Master patient index — search by name, MRN or phone."
        actions={
          canWrite ? (
            <Button className="bg-teal-700 hover:bg-teal-800" onClick={() => setOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" /> Register patient
            </Button>
          ) : null
        }
      />

      <Input
        placeholder="Search name, MRN or phone…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-4 max-w-sm"
        aria-label="Search patients"
      />

      {isLoading ? <LoadingState label="Loading patients…" /> : null}
      {isError ? <ErrorState message={(error as Error)?.message ?? "Failed to load patients."} onRetry={() => void refetch()} /> : null}

      {data ? (
        data.patients.length === 0 ? (
          <EmptyState
            title="No patients found"
            hint={query ? "Try a different search term." : "Register your first patient to get started."}
            action={canWrite ? <Button variant="outline" onClick={() => setOpen(true)}><UserPlus className="mr-2 h-4 w-4" /> Register patient</Button> : undefined}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>MRN</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Phone</TableHead>
                  <TableHead>Sex</TableHead>
                  <TableHead className="hidden md:table-cell">Age</TableHead>
                  <TableHead className="hidden md:table-cell">Registered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.patients.map((p) => (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer hover:bg-stone-50"
                    onClick={() => navigate("patient-detail", { patientId: p.id })}
                  >
                    <TableCell className="font-mono text-xs">{p.mrn}</TableCell>
                    <TableCell className="font-medium">{p.firstName} {p.lastName}</TableCell>
                    <TableCell className="hidden sm:table-cell">{p.phone}</TableCell>
                    <TableCell>{p.sex === "MALE" ? "M" : "F"}</TableCell>
                    <TableCell className="hidden md:table-cell">{ageFrom(p.dateOfBirth)}</TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {new Date(p.createdAt).toLocaleDateString("en-GB", { timeZone: tz })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : null}

      <RegisterDialog open={open} onOpenChange={setOpen} onRegistered={(id) => navigate("patient-detail", { patientId: id })} />
    </div>
  );
}

export function RegisterDialog({
  open, onOpenChange, onRegistered, prefill,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRegistered?: (patientId: string) => void;
  prefill?: Partial<{ firstName: string; lastName: string; phone: string }>;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    firstName: prefill?.firstName ?? "",
    lastName: prefill?.lastName ?? "",
    phone: prefill?.phone ?? "",
    sex: "FEMALE",
    dateOfBirth: "",
    address: "",
    allergies: "",
    nextOfKinName: "",
    nextOfKinPhone: "",
  });
  const [duplicates, setDuplicates] = useState<DuplicateWarning[]>([]);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiSend<{ patient: Patient; duplicates: DuplicateWarning[] }>("POST", "/api/patients", form),
    onSuccess: (res) => {
      setDuplicates(res.duplicates);
      if (res.duplicates.length === 0) {
        toast.success(`Patient ${res.patient.mrn} registered.`);
        queryClient.invalidateQueries({ queryKey: ["patients"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        onOpenChange(false);
        reset();
        onRegistered?.(res.patient.id);
      }
    },
    onError: (e) => setError((e as Error).message),
  });

  const reset = () => {
    setForm({ firstName: "", lastName: "", phone: "", sex: "FEMALE", dateOfBirth: "", address: "", allergies: "", nextOfKinName: "", nextOfKinPhone: "" });
    setDuplicates([]);
    setError(null);
  };

  const valid = form.firstName.trim().length > 0 && form.lastName.trim().length > 0 && form.phone.trim().length >= 7;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); } onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Register patient</DialogTitle>
          <DialogDescription>A medical record number (MRN) is generated automatically.</DialogDescription>
        </DialogHeader>

        {duplicates.length > 0 ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm" role="alert">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-amber-800">
              <TriangleAlert className="h-4 w-4" /> Possible duplicates found — review before saving
            </div>
            <ul className="space-y-1 text-amber-800">
              {duplicates.map((d) => (
                <li key={d.id}>· {d.name} ({d.mrn}) — {d.phone} · {d.reason}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-amber-700">Records are never merged automatically. If this is a different person, confirm below.</p>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="p-first">First name *</Label>
            <Input id="p-first" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-last">Last name *</Label>
            <Input id="p-last" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-phone">Phone *</Label>
            <Input id="p-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="080…" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-sex">Sex</Label>
            <select
              id="p-sex"
              value={form.sex}
              onChange={(e) => setForm({ ...form, sex: e.target.value })}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              <option value="FEMALE">Female</option>
              <option value="MALE">Male</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-dob">Date of birth</Label>
            <Input id="p-dob" type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-allergies">Allergies</Label>
            <Input id="p-allergies" value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} placeholder="e.g. Penicillin" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="p-address">Address</Label>
            <Input id="p-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-nok">Next of kin</Label>
            <Input id="p-nok" value={form.nextOfKinName} onChange={(e) => setForm({ ...form, nextOfKinName: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-nok-phone">Next of kin phone</Label>
            <Input id="p-nok-phone" value={form.nextOfKinPhone} onChange={(e) => setForm({ ...form, nextOfKinPhone: e.target.value })} />
          </div>
        </div>

        {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}

        <DialogFooter className="gap-2">
          {duplicates.length > 0 ? (
            <Button variant="outline" onClick={() => setDuplicates([])}>Not a duplicate — save anyway</Button>
          ) : null}
          <Button className="bg-teal-700 hover:bg-teal-800" disabled={!valid || mutation.isPending} onClick={() => { setError(null); mutation.mutate(); }}>
            {mutation.isPending ? "Saving…" : "Register patient"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
