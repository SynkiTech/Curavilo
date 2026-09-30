"use client";

// Data & Portals - CSV import/export (spec §64–65) + patient portal codes (§141)
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, KeyRound, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiSend, ApiError, formatDate } from "./api";
import { LoadingState, EmptyState, PageHeader } from "./ui-kit";
import { toast } from "sonner";

interface ImportPreview { total: number; valid: number; errors: Array<{ row: number; message: string }>; duplicates: Array<{ row: number; message: string }> }
interface PortalToken { id: string; label?: string | null; expiresAt: string; lastUsedAt?: string | null; patient: { mrn: string; firstName: string; lastName: string } }

const SAMPLE_CSV = "firstName,lastName,phone,sex\nAda,Obi,08031112233,FEMALE\nChinedu,Okafor,08034445566,MALE";

export function DataPortals() {
  const queryClient = useQueryClient();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [cleanRows, setCleanRows] = useState<Array<{ firstName: string; lastName: string; phone: string; sex: string }>>([]);
  const [portalMrn, setPortalMrn] = useState("");
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  const tokens = useQuery({
    queryKey: ["portal-tokens"],
    queryFn: () => apiGet<{ tokens: PortalToken[] }>("/api/portal?scope=tokens"),
  });

  const doPreview = useMutation({
    mutationFn: () => apiSend<{ preview: ImportPreview; rows: Array<{ firstName: string; lastName: string; phone: string; sex: string }> }>("POST", "/api/data", { action: "PREVIEW", csv }),
    onSuccess: (res) => {
      setPreview(res.preview);
      setCleanRows(res.rows);
      toast.success(`${res.preview.valid} row(s) ready to import.`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const doCommit = useMutation({
    mutationFn: () => apiSend<{ imported: number }>("POST", "/api/data", { action: "COMMIT", rows: cleanRows }),
    onSuccess: (res) => {
      toast.success(`Imported ${res.imported} patients.`);
      setPreview(null); setCleanRows([]); setCsv("");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const createToken = useMutation({
    mutationFn: () => apiSend<{ code: string }>("POST", "/api/portal?scope=main", { action: "CREATE_TOKEN", patientId: portalMrn }),
    onSuccess: (res) => {
      setIssuedCode(res.code);
      queryClient.invalidateQueries({ queryKey: ["portal-tokens"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : (e as Error).message),
  });

  const revokeToken = useMutation({
    mutationFn: (id: string) => apiSend("POST", "/api/portal?scope=main", { action: "REVOKE_TOKEN", tokenId: id }),
    onSuccess: () => {
      toast.success("Access revoked.");
      queryClient.invalidateQueries({ queryKey: ["portal-tokens"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div>
      <PageHeader title="Data & Portals" subtitle="CSV import with validate-and-preview (never silent), audited CSV exports, and patient portal access codes." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-base"><Upload className="h-4 w-4" aria-hidden /> CSV import - patients</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="csv-input">Paste CSV (firstName, lastName, phone, sex)</Label>
              <textarea
                id="csv-input"
                rows={6}
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                placeholder={SAMPLE_CSV}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => doPreview.mutate()} disabled={doPreview.isPending || csv.trim().length < 10}>Validate & preview</Button>
              <Button size="sm" variant="outline" onClick={() => setCsv(SAMPLE_CSV)}>Load sample</Button>
            </div>
            {doPreview.isPending ? <LoadingState /> : null}
            {preview ? (
              <div className="space-y-2 rounded-lg border bg-stone-50 p-3 text-sm">
                <p><strong>{preview.total}</strong> rows found · <strong>{preview.valid}</strong> valid · {preview.errors.length} error(s) · {preview.duplicates.length} duplicate(s)</p>
                {preview.errors.slice(0, 5).map((e, i) => <p key={i} className="text-xs text-red-700">Row {e.row}: {e.message}</p>)}
                {preview.duplicates.slice(0, 5).map((d, i) => <p key={i} className="text-xs text-amber-700">Row {d.row}: {d.message}</p>)}
                <Button size="sm" disabled={doCommit.isPending || cleanRows.length === 0} onClick={() => doCommit.mutate()}>
                  Import {cleanRows.length} patient(s) transactionally
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-base"><Download className="h-4 w-4" aria-hidden /> CSV exports (audited)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(["patients", "invoices", "appointments"] as const).map((what) => (
              <a key={what} href={`/api/data?export=${what}`} className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition hover:border-teal-400">
                <span className="capitalize">{what}</span>
                <Download className="h-4 w-4 text-muted-foreground" aria-hidden />
              </a>
            ))}
            <p className="text-xs text-muted-foreground">Exports are tenant-scoped, permission-gated and written to the audit log.</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-base"><KeyRound className="h-4 w-4" aria-hidden /> Patient portal access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="portal-patient">Patient record id</Label>
              <Input id="portal-patient" value={portalMrn} onChange={(e) => setPortalMrn(e.target.value)} placeholder="Patient id (from patient 360)" className="w-72" />
            </div>
            <Button onClick={() => createToken.mutate()} disabled={createToken.isPending || portalMrn.length < 5}>Issue access code (7 days)</Button>
          </div>
          {issuedCode ? (
            <p className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
              Access code (shown once): <code className="rounded bg-white px-1.5 py-0.5 font-semibold">{issuedCode}</code> - the patient opens the portal from the sign-in screen, enters their MRN + this code.
            </p>
          ) : null}

          {tokens.isLoading ? <LoadingState /> : null}
          {tokens.data && tokens.data.tokens.length > 0 ? (
            <div className="overflow-hidden rounded-lg border bg-white">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Patient</TableHead><TableHead>Label</TableHead><TableHead>Expires</TableHead><TableHead>Last used</TableHead><TableHead /></TableRow>
                </TableHeader>
                <TableBody>
                  {tokens.data.tokens.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-sm">{t.patient.firstName} {t.patient.lastName} <span className="text-xs text-muted-foreground">{t.patient.mrn}</span></TableCell>
                      <TableCell className="text-xs">{t.label ?? "-"}</TableCell>
                      <TableCell className="text-xs">{formatDate(t.expiresAt)}</TableCell>
                      <TableCell className="text-xs">{t.lastUsedAt ? formatDate(t.lastUsedAt) : "never"}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="mr-2 text-[10px]">ACTIVE</Badge>
                        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => revokeToken.mutate(t.id)}>Revoke</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : tokens.data ? (
            <EmptyState title="No active portal codes" hint="Issue a code to give a patient 7-day read-only access to their appointments, invoices and results." />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
