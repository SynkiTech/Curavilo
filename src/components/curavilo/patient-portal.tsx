"use client";

// Patient portal (spec §141) - code-gated read-only access to appointments,
// invoices, prescriptions/results, follow-ups and recent visits.
import { useEffect, useState } from "react";
import { ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AnimatedBackground } from "./animated-bg";
import { formatDateTime, formatMoney } from "./api";
import { toast } from "sonner";

interface PortalData {
  patient: { mrn: string; name: string; nextOfKinName?: string | null };
  appointments: Array<{ id: string; scheduledAt: string; durationMin: number; status: string }>;
  invoices: Array<{ number: string; status: string; totalMinor: number; amountPaidMinor: number; outstandingMinor: number; currency: string; createdAt: string }>;
  followUps: Array<{ title: string; dueAt: string; status: string }>;
  results: Array<{ reportNumber?: string | null; testName: string; kind: string; releasedAt?: string | null; impression?: string | null; results: unknown }>;
  recentVisits: Array<{ startedAt: string; diagnosis?: string | null; plan?: string | null }>;
}

export function PatientPortal({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [mrn, setMrn] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resume an existing portal session on mount
  useEffect(() => {
    fetch("/api/portal", { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => {
        if (body && body.patient) setData(body as PortalData);
      })
      .catch(() => undefined);
  }, []);

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal?scope=login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mrn, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.error) throw new Error(body?.error?.message ?? "Sign-in failed.");
      const session = await fetch("/api/portal", { cache: "no-store" }).then((r) => r.json());
      setData(session as PortalData);
      toast.success("Welcome - showing your records.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in to the portal.");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await fetch("/api/portal?scope=logout", { method: "POST" });
    setData(null);
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />
      <div className="relative z-10 mx-auto max-w-3xl px-4 py-10">
        <Button variant="ghost" onClick={data ? logout : onBack} className="mb-4 text-white hover:bg-white/10 hover:text-white">
          <ArrowLeft className="mr-2 h-4 w-4" /> {data ? "Sign out of portal" : "Back to sign in"}
        </Button>

        {!data ? (
          <Card className="mx-auto max-w-md border-white/40 bg-white/90 shadow-xl backdrop-blur-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><KeyRound className="h-4 w-4" aria-hidden /> Patient portal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Enter your medical record number and the access code your facility issued you.</p>
              <div className="space-y-1.5">
                <Label htmlFor="portal-mrn">Medical record number (MRN)</Label>
                <Input id="portal-mrn" value={mrn} onChange={(e) => setMrn(e.target.value)} placeholder="MRN-20251103-000001" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="portal-code">Access code</Label>
                <Input id="portal-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="cv-xxxxxxxx" />
              </div>
              {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
              <Button className="w-full bg-teal-700 hover:bg-teal-800" disabled={busy || mrn.length < 2 || code.length < 6} onClick={() => void login()}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} View my records
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/25 bg-white/10 p-4 text-white backdrop-blur">
              <p className="text-lg font-semibold">Hello, {data.patient.name}</p>
              <p className="text-xs text-teal-100/80">MRN {data.patient.mrn}{data.patient.nextOfKinName ? ` · next of kin: ${data.patient.nextOfKinName}` : ""}</p>
            </div>

            <PortalCard title="Upcoming appointments">
              {data.appointments.length === 0 ? <p className="text-sm text-muted-foreground">None scheduled.</p> : (
                <ul className="text-sm">
                  {data.appointments.map((a) => <li key={a.id} className="flex justify-between py-1"><span>{formatDateTime(a.scheduledAt)}</span><span className="text-xs text-muted-foreground">{a.status.replaceAll("_", " ")}</span></li>)}
                </ul>
              )}
            </PortalCard>

            <PortalCard title="Invoices & payments">
              {data.invoices.length === 0 ? <p className="text-sm text-muted-foreground">No invoices.</p> : (
                <ul className="text-sm">
                  {data.invoices.map((i) => (
                    <li key={i.number} className="flex justify-between py-1">
                      <span>{i.number} · {i.status.replaceAll("_", " ")}</span>
                      <span>{formatMoney(i.totalMinor, i.currency)}{i.outstandingMinor > 0 ? <span className="ml-1 text-xs text-amber-700">(owes {formatMoney(i.outstandingMinor, i.currency)})</span> : null}</span>
                    </li>
                  ))}
                </ul>
              )}
            </PortalCard>

            <PortalCard title="Released results">
              {data.results.length === 0 ? <p className="text-sm text-muted-foreground">No released results yet.</p> : (
                <ul className="space-y-2 text-sm">
                  {data.results.map((r, i) => (
                    <li key={i} className="rounded-lg border bg-stone-50 p-2.5">
                      <p className="font-medium">{r.testName} {r.reportNumber ? <span className="text-xs text-muted-foreground">· {r.reportNumber}</span> : null}</p>
                      <pre className="whitespace-pre-wrap font-sans text-xs text-muted-foreground">{typeof r.results === "string" ? r.results : JSON.stringify(r.results, null, 1).slice(0, 400)}</pre>
                      {r.impression ? <p className="mt-1 text-xs">Impression: {r.impression}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </PortalCard>

            <PortalCard title="Care plan & follow-ups">
              {data.followUps.length === 0 && data.recentVisits.length === 0 ? <p className="text-sm text-muted-foreground">Nothing pending.</p> : (
                <ul className="text-sm">
                  {data.followUps.map((f, i) => <li key={i} className="flex justify-between py-1"><span>{f.title}</span><span className="text-xs text-muted-foreground">due {formatDateTime(f.dueAt)}</span></li>)}
                  {data.recentVisits.slice(0, 3).map((v, i) => (
                    <li key={i} className="py-1 text-xs text-muted-foreground">Visit {formatDateTime(v.startedAt)}{v.diagnosis ? ` - ${v.diagnosis}` : ""}{v.plan ? ` · plan: ${v.plan.slice(0, 80)}` : ""}</li>
                  ))}
                </ul>
              )}
            </PortalCard>
          </div>
        )}
      </div>
    </div>
  );
}

function PortalCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-white/40 bg-white/90 backdrop-blur-md">
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
