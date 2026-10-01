"use client";

// Landing + two-stage access: Facility Access Gate -> Personnel Gate (ADR 0011).
// Stage 1 identifies the workspace (no permissions granted). Stage 2 authenticates
// the individual staff member and determines authorization. Invitation acceptance
// and password reset flows land here through one-time token links.
import { useEffect, useState } from "react";
import {
  HeartPulse, LogIn, Building2, Loader2, Info, KeyRound, Eye, EyeOff,
  ArrowLeft, ShieldCheck, MailCheck, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { apiSend, ApiError, fetchSessionWithRetry, type GateInfo, type SessionInfo } from "./api";
import { useApp } from "./store";
import { AnimatedBackground } from "./animated-bg";

const NETWORK_PROBLEM = "Cannot reach the server right now - it may be starting up. Please wait a moment and try again.";

type Screen = "facility" | "staff" | "invite" | "reset" | "token-done";

export function Landing({
  onOpenOnboarding,
  onOpenPortal,
  inviteToken,
  resetToken,
  initialScreen,
}: {
  onOpenOnboarding: () => void;
  onOpenPortal?: () => void;
  inviteToken?: string | null;
  resetToken?: string | null;
  initialScreen?: Screen | null;
}) {
  const { session, setSession } = useApp();
  const gate: GateInfo | null = session?.gate ?? null;
  const [screen, setScreen] = useState<Screen>(initialScreen ?? (inviteToken ? "invite" : resetToken ? "reset" : gate ? "staff" : "facility"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [oneTimeLink, setOneTimeLink] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [activeResetToken, setActiveResetToken] = useState<string | null>(resetToken ?? null);
  const [activeInviteToken] = useState<string | null>(inviteToken ?? null);

  useEffect(() => {
    if (initialScreen) setScreen(initialScreen);
  }, [initialScreen]);

  const clearForm = () => {
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setError(null);
  };

  // ── Stage 1: facility access gate ────────────────────────────────────────
  const facilityLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/api/auth", { action: "facility-login", email, password });
      const fresh = await fetchSessionWithRetry();
      if (!fresh) throw new ApiError(500, "error", "Signed in, but the workspace could not be loaded. Please refresh.");
      setSession(fresh);
      setEmail("");
      clearForm();
      setScreen("staff");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_PROBLEM);
    } finally {
      setBusy(false);
    }
  };

  // ── Stage 2: personnel gate ──────────────────────────────────────────────
  const staffLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/api/auth", { action: "staff-login", email, password });
      const fresh = await fetchSessionWithRetry();
      if (!fresh?.authenticated) throw new ApiError(500, "error", "Signed in, but your workspace could not be loaded. Please refresh the page.");
      setSession(fresh);
      clearForm();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_PROBLEM);
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ ok: boolean; message?: string; resetLink?: string }>(
        "POST", "/api/auth", { action: "forgot-password", email }
      );
      setNotice(res.message ?? "If that email belongs to this facility, a reset link has been generated.");
      setOneTimeLink(res.resetLink ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_PROBLEM);
    } finally {
      setBusy(false);
    }
  };

  const submitToken = async (kind: "invite" | "reset") => {
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/api/auth", kind === "invite"
        ? { action: "invite-accept", token: activeInviteToken, password }
        : { action: "reset-password", token: activeResetToken, password });
      setScreen("token-done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_PROBLEM);
    } finally {
      setBusy(false);
    }
  };

  const exitFacility = async () => {
    setBusy(true);
    try {
      await apiSend("POST", "/api/auth", { action: "exit-facility" });
    } catch { /* cookie already gone is fine */ }
    setSession({ authenticated: false });
    setNotice(null);
    setOneTimeLink(null);
    clearForm();
    setScreen("facility");
    setBusy(false);
  };

  const passwordField = (id: string, value: string, onChange: (v: string) => void, autoComplete: string, label = "Password") => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={showPassword ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={8}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="At least 8 characters"
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          aria-label={showPassword ? "Hide password" : "Show password"}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-stone-400 hover:text-stone-600"
        >
          {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    </div>
  );

  const errorBox = error ? (
    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>
  ) : null;

  const footerNote = (
    <footer className="relative z-10 pb-8 text-center text-xs text-white/50">
      Curavilo · Synthetic demo data only - not for production clinical use without professional review.
    </footer>
  );

  // ── Token screens (invitation / reset) ────────────────────────────────────
  if (screen === "invite" || screen === "reset" || screen === "token-done") {
    const kind = screen === "reset" ? "reset" : "invite";
    return (
      <div className="relative min-h-screen overflow-hidden">
        <AnimatedBackground />
        <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-12">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/30 backdrop-blur">
              <HeartPulse className="h-6 w-6" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-white">Curavilo</span>
          </div>
          {screen === "token-done" ? (
            <Card className="w-full border-white/40 bg-white/90 shadow-xl shadow-teal-950/30 backdrop-blur-md">
              <CardHeader className="items-center text-center">
                <CheckCircle2 className="mx-auto mb-1 h-10 w-10 text-teal-600" aria-hidden />
                <CardTitle className="text-lg">All set</CardTitle>
                <CardDescription>
                  {kind === "invite"
                    ? "Your password is saved and your account is active. Sign in through your facility."
                    : "Your password has been reset and old sessions were signed out."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-teal-700 hover:bg-teal-800" onClick={() => { setSession({ authenticated: false }); setScreen("facility"); }}>
                  Continue to sign in
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="w-full border-white/40 bg-white/90 shadow-xl shadow-teal-950/30 backdrop-blur-md">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  {kind === "invite" ? <MailCheck className="h-5 w-5 text-teal-700" aria-hidden /> : <KeyRound className="h-5 w-5 text-teal-700" aria-hidden />}
                  {kind === "invite" ? "Accept your invitation" : "Choose a new password"}
                </CardTitle>
                <CardDescription>
                  {kind === "invite"
                    ? "Welcome to the team. Set your personal password to activate your staff account."
                    : "Set a new password for your staff account. All previous sessions will be signed out."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!busy) void submitToken(kind);
                  }}
                >
                  {passwordField("token-password", password, setPassword, "new-password")}
                  {passwordField("token-confirm", confirmPassword, setConfirmPassword, "new-password", "Confirm password")}
                  {errorBox}
                  <Button type="submit" className="w-full bg-teal-700 hover:bg-teal-800" disabled={busy}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {kind === "invite" ? "Activate my account" : "Reset password"}
                  </Button>
                  <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={() => { setSession({ authenticated: false }); setScreen("facility"); }}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to sign in
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
        {footerNote}
      </div>
    );
  }

  // ── Stage 2: personnel gate ───────────────────────────────────────────────
  if (screen === "staff" && gate) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <AnimatedBackground />
        <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-12">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-white/25 bg-white/90 shadow-lg">
              {gate.logoData ? (
                <img src={gate.logoData} alt={`${gate.facilityName} logo`} className="h-full w-full object-contain" />
              ) : (
                <Building2 className="h-8 w-8 text-teal-700" aria-hidden />
              )}
            </div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-teal-100/80">Facility access passed</p>
            <h1 className="text-xl font-semibold text-white">{gate.facilityName}</h1>
          </div>

          <Card className="w-full border-white/40 bg-white/90 shadow-xl shadow-teal-950/30 backdrop-blur-md">
            <CardHeader>
              <CardTitle className="text-lg">Access your staff account</CardTitle>
              <CardDescription>Sign in with your personal credentials - your role determines what you can see and do.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy) void staffLogin();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="staff-email">Email</Label>
                  <Input id="staff-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@facility.ng" />
                </div>
                {passwordField("staff-password", password, setPassword, "current-password")}
                {errorBox}
                <Button type="submit" className="w-full bg-teal-700 hover:bg-teal-800" disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
                  Sign in
                </Button>
              </form>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  className="text-teal-700 hover:underline"
                  aria-haspopup="dialog"
                  onClick={() => { setError(null); setNotice(null); setOneTimeLink(null); setForgotOpen(true); }}
                >
                  Forgot password?
                </button>
                <button type="button" className="text-stone-400 hover:text-stone-600" onClick={() => void exitFacility()} disabled={busy}>
                  Exit facility
                </button>
              </div>
              <ForgotPasswordDialog
                open={forgotOpen}
                onOpenChange={setForgotOpen}
                email={email}
                setEmail={setEmail}
                busy={busy}
                error={error}
                notice={notice}
                oneTimeLink={oneTimeLink}
                onSubmit={forgotPassword}
                onUseLink={(token) => { setForgotOpen(false); setNotice(null); setOneTimeLink(null); clearForm(); setActiveResetToken(token); setScreen("reset"); }}
              />
              <div className="flex items-start gap-2 rounded-lg border border-teal-200 bg-teal-50/70 p-3 text-xs text-teal-900">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div>
                  <p className="font-medium">Demo staff accounts (synthetic data)</p>
                  <p className="mt-0.5">reception@ · optometrist@ · pharmacy@ · billing@curavilo.demo - password <code className="rounded bg-white px-1">Demo1234!</code></p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        {footerNote}
      </div>
    );
  }

  // ── Stage 1: facility access gate (default) ──────────────────────────────
  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center gap-10 px-4 py-12 lg:flex-row lg:items-center lg:gap-16">
        <div className="max-w-md">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/30 backdrop-blur">
              <HeartPulse className="h-6 w-6" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-white">Curavilo</span>
          </div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">
            Access your facility workspace.
          </h1>
          <p className="mt-3 text-teal-100/80">
            Two secure steps: first open your facility, then sign in with your personal staff
            account. Your role - not the shared facility key - decides what you can access.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-teal-100/75">
            <li>· Individual staff accounts with role-based dashboards and permissions</li>
            <li>· Deterministic billing & inventory with auditable ledgers</li>
            <li>· AI answers grounded in your own authorized data - never guessed</li>
          </ul>
          <div className="mt-8 flex items-start gap-2 rounded-lg border border-white/20 bg-white/10 p-3 text-xs text-teal-50 backdrop-blur">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">Demo facility access (synthetic data)</p>
              <p className="mt-0.5">eyeclinic@curavilo.demo · gracefield@curavilo.demo - password <code className="rounded bg-white/15 px-1">Demo1234!</code></p>
            </div>
          </div>
        </div>

        <Card className="w-full max-w-sm border-white/40 bg-white/90 shadow-xl shadow-teal-950/30 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-lg">Access your facility</CardTitle>
            <CardDescription>Step 1 of 2 - the facility workspace credential.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy) void facilityLogin();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="facility-email">Facility email</Label>
                <Input id="facility-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="facility@clinic.ng" />
              </div>
              {passwordField("facility-password", password, setPassword, "current-password")}
              {errorBox}
              <Button type="submit" className="w-full bg-teal-700 hover:bg-teal-800" disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
                Continue
              </Button>
            </form>
            <div className="relative text-center text-xs text-muted-foreground">
              <span className="relative z-10 bg-background px-2">or</span>
              <span className="absolute left-0 top-1/2 h-px w-full bg-border" aria-hidden />
            </div>
            <Button variant="outline" className="w-full" onClick={onOpenOnboarding}>
              <Building2 className="mr-2 h-4 w-4" /> Register your facility
            </Button>
            {onOpenPortal ? (
              <Button variant="ghost" className="w-full text-muted-foreground" onClick={onOpenPortal}>
                <KeyRound className="mr-2 h-4 w-4" /> Patient portal - view my records
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
      {footerNote}
    </div>
  );
}

// Forgot-password dialog with safe messaging (spec §62): generic confirmation,
// single-use link handed over directly in the sandbox (email simulation).
function ForgotPasswordDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  email: string;
  setEmail: (v: string) => void;
  busy: boolean;
  error: string | null;
  notice: string | null;
  oneTimeLink: string | null;
  onSubmit: () => void;
  onUseLink: (token: string) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset your password</DialogTitle>
          <DialogDescription>
            Enter your staff email. A single-use reset link valid for 30 minutes will be generated.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="forgot-email">Staff email</Label>
            <Input id="forgot-email" type="email" required value={props.email} onChange={(e) => props.setEmail(e.target.value)} placeholder="you@facility.ng" />
          </div>
          {props.error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{props.error}</p>
          ) : null}
          {props.notice ? (
            <p className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800" role="status">{props.notice}</p>
          ) : null}
          {props.oneTimeLink ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-medium">Sandbox email simulation - your reset link:</p>
              <button
                type="button"
                className="mt-1 break-all font-mono text-left text-teal-800 underline"
                onClick={() => props.onUseLink(props.oneTimeLink!.split("reset=")[1] ?? "")}
              >
                {props.oneTimeLink}
              </button>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>Close</Button>
          <Button className="bg-teal-700 hover:bg-teal-800" disabled={props.busy} onClick={() => void props.onSubmit()}>
            {props.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Generate reset link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
