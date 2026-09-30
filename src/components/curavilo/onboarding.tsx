"use client";

// Onboarding wizard — Organization → Facility & service profile → Branding → Admin (spec §10)
import { useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Building2, Check, ImagePlus, Loader2, Sparkles, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiSend, ApiError, fetchSessionWithRetry, type SessionInfo } from "./api";
import { useApp } from "./store";
import { PROFILES_META } from "./profile-meta";
import { AnimatedBackground } from "./animated-bg";

const NETWORK_PROBLEM = "Cannot reach the server right now — it may be starting up. Please wait a moment and try again.";

const STEPS = ["Organization", "Facility & profile", "Branding", "Admin account"] as const;

export function Onboarding({ onBack }: { onBack: () => void }) {
  const setSession = useApp((s) => s.setSession);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [orgName, setOrgName] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [timezone, setTimezone] = useState("Africa/Lagos");

  const [facilityName, setFacilityName] = useState("");
  const [facilityType, setFacilityType] = useState("CLINIC");
  const [profileKey, setProfileKey] = useState("EYE_CLINIC");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [logoData, setLogoData] = useState<string | null>(null);
  const [reportFooter, setReportFooter] = useState("");
  const [receiptFooter, setReceiptFooter] = useState("");

  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  const profile = useMemo(() => PROFILES_META.find((p) => p.key === profileKey), [profileKey]);

  const onLogoPicked = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      setError("Logo must be a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > 280_000) {
      setError("Logo must be smaller than 280 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoData(String(reader.result));
    reader.readAsDataURL(file);
  };

  const canNext =
    step === 0 ? orgName.trim().length >= 2
    : step === 1 ? facilityName.trim().length >= 2
    : true;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/api/auth", {
        action: "register",
        organization: { name: orgName.trim(), currency, timezone },
        facility: {
          name: facilityName.trim(),
          type: facilityType,
          serviceProfileKey: profileKey,
          address: address.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          logoData,
          reportFooter: reportFooter.trim() || null,
          receiptFooter: receiptFooter.trim() || null,
        },
        admin: { name: adminName.trim(), email: adminEmail.trim().toLowerCase(), password: adminPassword },
      });
      // Retry the session read so a transient drop right after registration
      // doesn't strand the user on the wizard with a confusing failure.
      let session: SessionInfo | null = null;
      try {
        session = await fetchSessionWithRetry();
      } catch {
        session = null;
      }
      if (!session?.authenticated) {
        setError("Facility created, but sign-in could not be completed. Please sign in with your new account.");
        return;
      }
      setSession(session);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_PROBLEM);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-10">
      <AnimatedBackground />
      <div className="relative z-10 mx-auto max-w-2xl">
        <Button variant="ghost" onClick={onBack} className="mb-4 text-white hover:bg-white/10 hover:text-white">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to sign in
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Register your facility</h1>
        <p className="mt-1 text-sm text-teal-100/75">
          Curavilo adapts to your specialty — terminology, forms, catalogue and dashboards load from your service profile.
        </p>

        <ol className="mt-6 flex items-center gap-2" aria-label="Onboarding steps">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  i < step ? "bg-teal-500 text-white" : i === step ? "border-2 border-teal-300 text-teal-200" : "border border-white/30 text-white/50"
                }`}
                aria-current={i === step ? "step" : undefined}
              >
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={`hidden text-xs sm:block ${i === step ? "font-medium text-white" : "text-white/60"}`}>{s}</span>
              {i < STEPS.length - 1 ? <span className="h-px flex-1 bg-white/25" aria-hidden /> : null}
            </li>
          ))}
        </ol>

        <Card className="mt-6 border-white/40 bg-white/90 shadow-xl shadow-teal-950/30 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-base">{STEPS[step]}</CardTitle>
            {step === 1 ? <CardDescription>Pick the profile that matches what your facility provides.</CardDescription> : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {step === 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="orgName">Organization name</Label>
                  <Input id="orgName" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. Lagos Eye Care Group" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="currency">Currency</Label>
                  <Input id="currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Input id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
                </div>
              </div>
            ) : null}

            {step === 1 ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="facilityName">Facility name</Label>
                    <Input id="facilityName" value={facilityName} onChange={(e) => setFacilityName(e.target.value)} placeholder="e.g. Lagos Eye Care — Ikeja" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="facilityType">Facility type</Label>
                    <Input id="facilityType" value={facilityType} onChange={(e) => setFacilityType(e.target.value.toUpperCase())} placeholder="CLINIC / HOSPITAL / CENTRE" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0800 000 0000" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Facility email</Label>
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="hello@facility.ng" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="address">Address</Label>
                    <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="12 Example Road, Ikeja, Lagos" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Service profile</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {PROFILES_META.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setProfileKey(p.key)}
                        aria-pressed={profileKey === p.key}
                        className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${
                          profileKey === p.key ? "border-teal-600 bg-teal-50/70 ring-1 ring-teal-600" : "border-border hover:border-teal-400"
                        }`}
                      >
                        <Stethoscope className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden />
                        <span>
                          <span className="block text-sm font-medium">{p.name}</span>
                          <span className="block text-xs text-muted-foreground">{p.description}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                {profile ? (
                  <div className="flex items-start gap-2 rounded-lg border border-teal-200 bg-teal-50/50 p-3 text-xs text-teal-900">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <p>
                      Loads terminology ({profile.terminologyPreview}), a starter service catalogue ({profile.catalogueCount} services)
                      and the <strong>{profile.formTitle}</strong> encounter form. Everything stays configurable later.
                    </p>
                  </div>
                ) : null}
              </>
            ) : null}

            {step === 2 ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Facility logo</Label>
                  <div className="flex items-center gap-4">
                    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-dashed bg-stone-50">
                      {logoData ? (
                         
                        <img src={logoData} alt="Logo preview" className="h-full w-full object-contain" />
                      ) : (
                        <ImagePlus className="h-6 w-6 text-stone-400" aria-hidden />
                      )}
                    </div>
                    <div>
                      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => onLogoPicked(e.target.files?.[0])} />
                      <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                        Upload logo
                      </Button>
                      <p className="mt-1 text-xs text-muted-foreground">PNG, JPEG or WebP. Max 280 KB. SVG not accepted for security.</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reportFooter">Report footer</Label>
                  <Textarea id="reportFooter" rows={2} value={reportFooter} onChange={(e) => setReportFooter(e.target.value)} placeholder="Appears on printed reports and invoices" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="receiptFooter">Receipt footer</Label>
                  <Textarea id="receiptFooter" rows={2} value={receiptFooter} onChange={(e) => setReceiptFooter(e.target.value)} placeholder="e.g. Thank you for your visit — get well soon!" />
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="adminName">Administrator name</Label>
                  <Input id="adminName" value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="e.g. Dr. Adaeze Okafor" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="adminEmail">Email</Label>
                  <Input id="adminEmail" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="owner@facility.ng" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="adminPassword">Password</Label>
                  <Input id="adminPassword" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="Minimum 8 characters" />
                </div>
              </div>
            ) : null}

            {error ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>
            ) : null}

            <div className="flex items-center justify-between pt-2">
              <Button variant="ghost" onClick={() => (step === 0 ? onBack() : setStep(step - 1))} disabled={busy}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              {step < 3 ? (
                <Button className="bg-teal-700 hover:bg-teal-800" disabled={!canNext} onClick={() => setStep(step + 1)}>
                  Continue <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <Button className="bg-teal-700 hover:bg-teal-800" disabled={busy || adminName.trim().length < 2 || !adminEmail.includes("@") || adminPassword.length < 8} onClick={submit}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Building2 className="mr-2 h-4 w-4" />}
                  Create facility
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
