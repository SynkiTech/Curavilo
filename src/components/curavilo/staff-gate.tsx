"use client";

// Personnel access gateway + account recovery flows (spec §5, §30, §63; ADR 0011).
// Stage 2 of the two-stage access model: individual staff authentication after
// the facility gate. Includes forgot-password, token reset and invitation accept.
import { useEffect, useMemo, useState } from "react";
import { HeartPulse, LogIn, Loader2, KeyRound, ArrowLeft, LogOut, ShieldCheck, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiSend, ApiError, fetchSessionWithRetry, type SessionInfo } from "./api";
import { useApp } from "./store";
import { AnimatedBackground } from "./animated-bg";

const NETWORK_PROBLEM = "Cannot reach the server right now - it may be starting up. Please wait a moment and try again.";

function PasswordInput({ id, value, onChange, autoComplete = "current-password" }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id} type={show ? "text" : "password"} required value={value}
        onChange={(e) => onChange(e.target.value)} placeholder="••••••••" autoComplete={autoComplete}
        className="pr-16"
      />
      <button
        type="button" onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-teal-700 hover:text-teal-900"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

function FacilityMark({ name, logoData }: { name: string; logoData?: string | null }) {
  return (
    <div className="flex flex-col items-center gap-2">
      {logoData ? (
        <img src={logoData} alt={`${name} logo`} className="h-14 w-14 rounded-xl bg-white object-contain p-1 ring-1 ring-white/40" />
      ) : (
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30 backdrop-blur">
          <Building2 className="h-7 w-7 text-white" aria-hidden />
        </div>
      )}
      <div className="text-center">
        <p className="text-sm font-semibold text-white">{name}</p>
        <p className="text-[11px] text-teal-100/60">Facility verified - sign in with your personal account</p>
      </div>
    </div>
  );
}

// ─── Stage 2: personnel gateway ─────────────────────────────────────────────

export function StaffGate({ gate, onBack }: { gate: { facilityName?: string; logoData?: string | null }; onBack: () => void }) {
  const setSession = useApp((s) => s.setSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "forgot" | "reset">("login");
  const [notice, setNotice] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const facilityName = gate.facilityName ?? "Your facility";

  const refresh = async () => {
    let session: SessionInfo | null = null;
    try {
      session = await fetchSessionWithRetry();
    } catch {
      session = null;
    }
    if (session?.authenticated) {
      setSession(session);
    } else if (session && !session.authenticated && session.gate) {
      setSession(session); // stay on the gate
    } else {
      setError("Signed in, but your workspace could not be loaded. Please refresh the page.");
    }
  };

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/api/auth", { action: "staff-login", email, password });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_PROBLEM);
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ message?: string }>("POST", "/api/auth", { action: "staff-forgot", email });
      setNotice(res.message ?? "If that email belongs to this facility, a reset token has been sent to your clinic inbox.");
      setMode("reset");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_PROBLEM);
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/api/auth", { action: "staff-reset", token: resetToken.trim(), newPassword });
      setNotice("Password updated. You can now sign in with your new password.");
      setMode("login");
      setPassword("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_PROBLEM);
    } finally {
      setBusy(false);
    }
  };

  const exitFacility = async () => {
    await apiSend("POST", "/api/auth", { action: "exit-facility" }).catch(() => undefined);
    setSession({ authenticated: false, gate: undefined });
    onBack();
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-12">
        <div className="flex items-center gap-2 text-white/80">
          <HeartPulse className="h-5 w-5" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">Curavilo</span>
        </div>

        <Card className="w-full border-white/40 bg-white/90 shadow-xl shadow-teal-950/30 backdrop-blur-md">
          <CardHeader className="items-center text-center">
            <CardTitle className="text-lg">
              {mode === "login" ? "Access Your Staff Account" : mode === "forgot" ? "Forgot Password" : "Reset Password"}
            </CardTitle>
            <CardDescription>
              {mode === "login" ? facilityName : mode === "forgot" ? "We will issue a single-use reset token for verification." : "Paste the reset token from your clinic inbox."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {mode === "login" ? (
              <>
                <FacilityMark name={facilityName} logoData={gate.logoData} />
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!busy) void login();
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="staff-email">Work email</Label>
                    <Input id="staff-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@facility.ng" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="staff-password">Password</Label>
                    <PasswordInput id="staff-password" value={password} onChange={setPassword} />
                  </div>
                  {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
                  <Button type="submit" className="w-full bg-teal-700 hover:bg-teal-800" disabled={busy}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
                    Sign In
                  </Button>
                </form>
                <div className="flex items-center justify-between text-xs">
                  <button type="button" className="font-medium text-teal-700 hover:underline" onClick={() => { setMode("forgot"); setError(null); }}>
                    Forgot password?
                  </button>
                  <button type="button" className="inline-flex items-center gap-1 font-medium text-red-700/80 hover:text-red-800" onClick={() => void exitFacility()}>
                    <LogOut className="h-3.5 w-3.5" aria-hidden /> Exit Facility
                  </button>
                </div>
                <p className="text-center text-[11px] text-muted-foreground">
                  Shared computer? Always sign out when you leave - the next person signs in with their own account.
                </p>
              </>
            ) : null}

            {mode === "forgot" ? (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy) void forgot();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="forgot-email">Work email</Label>
                  <Input id="forgot-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
                <Button type="submit" className="w-full bg-teal-700 hover:bg-teal-800" disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                  Send reset token
                </Button>
                <button type="button" className="flex items-center justify-center gap-1 text-xs font-medium text-teal-700 hover:underline w-full" onClick={() => { setMode("login"); setNotice(null); }}>
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to sign in
                </button>
              </form>
            ) : null}

            {mode === "reset" ? (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy) void doReset();
                }}
              >
                {notice ? <p className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800" role="status">{notice}</p> : null}
                <div className="space-y-1.5">
                  <Label htmlFor="reset-token">Reset token</Label>
                  <Input id="reset-token" required value={resetToken} onChange={(e) => setResetToken(e.target.value)} placeholder="Single-use code" autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reset-password">New password</Label>
                  <PasswordInput id="reset-password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
                  <p className="text-[11px] text-muted-foreground">At least 8 characters with letters and numbers.</p>
                </div>
                {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
                <Button type="submit" className="w-full bg-teal-700 hover:bg-teal-800" disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                  Set new password
                </Button>
                <button type="button" className="flex items-center justify-center gap-1 text-xs font-medium text-teal-700 hover:underline w-full" onClick={() => { setMode("login"); setNotice(null); setError(null); }}>
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to sign in
                </button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <footer className="relative z-10 pb-6 text-center text-xs text-white/50">
        Curavilo · Synthetic demo data only - not for production clinical use without professional review.
      </footer>
    </div>
  );
}

// ─── Invitation acceptance (staff sets their own password, spec §7 Option A) ──

export function AcceptInvitation({ token, onDone }: { token: string; onDone: () => void }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const strength = useMemo(() => {
    let s = 0;
    if (newPassword.length >= 8) s++;
    if (/[A-Z]/.test(newPassword)) s++;
    if (/[0-9]/.test(newPassword)) s++;
    if (/[^A-Za-z0-9]/.test(newPassword)) s++;
    return s;
  }, [newPassword]);

  const accept = async () => {
    setError(null);
    if (newPassword !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiSend<{ email?: string | null }>("POST", "/api/auth", { action: "staff-accept", token, newPassword });
      setDone(res.email ?? "your work email");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_PROBLEM);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!token) setError("No invitation token found. Ask your facility owner to re-send the invitation.");
  }, [token]);

  if (done) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <AnimatedBackground />
        <div className="relative z-10 mx-auto flex min-h-screen max-w-md items-center justify-center px-4">
          <Card className="w-full border-white/40 bg-white/90 shadow-xl backdrop-blur-md">
            <CardHeader className="items-center text-center">
              <ShieldCheck className="h-10 w-10 text-teal-600" aria-hidden />
              <CardTitle className="text-lg">Account activated</CardTitle>
              <CardDescription>
                Your password is set for {done}. Continue to the facility gate and sign in with your personal account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full bg-teal-700 hover:bg-teal-800" onClick={onDone}>Go to sign in</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-md items-center justify-center px-4">
        <Card className="w-full border-white/40 bg-white/90 shadow-xl shadow-teal-950/30 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-lg">Set your password</CardTitle>
            <CardDescription>Welcome to Curavilo. Choose a personal password to activate your staff account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy) void accept();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="inv-token">Invitation token</Label>
                <Input id="inv-token" value={token} readOnly className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-password">New password</Label>
                <PasswordInput id="inv-password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
                <div className="flex gap-1" aria-hidden>
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={`h-1 flex-1 rounded-full ${i < strength ? (strength <= 1 ? "bg-red-400" : strength === 2 ? "bg-amber-400" : "bg-teal-500") : "bg-stone-200"}`} />
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">At least 8 characters with letters and numbers. Longer is stronger.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-confirm">Confirm password</Label>
                <PasswordInput id="inv-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" />
              </div>
              {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
              <Button type="submit" className="w-full bg-teal-700 hover:bg-teal-800" disabled={busy || !token}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Activate account
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Forced password change (temporary passwords, spec §7 Option B / §29) ────

export function ForcedPasswordChange() {
  const setSession = useApp((s) => s.setSession);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await apiSend("POST", "/api/auth", { action: "change-password", currentPassword: current, newPassword: next });
      const fresh = await fetchSessionWithRetry();
      if (fresh?.authenticated) setSession(fresh);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_PROBLEM);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-teal-950/70 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader>
          <CardTitle className="text-lg">Change your temporary password</CardTitle>
          <CardDescription>
            Your account uses a temporary password. Choose a new one to continue - Curavilo blocks other actions until this is done.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void submit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="fp-current">Current (temporary) password</Label>
              <PasswordInput id="fp-current" value={current} onChange={setCurrent} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fp-next">New password</Label>
              <PasswordInput id="fp-next" value={next} onChange={setNext} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fp-confirm">Confirm new password</Label>
              <PasswordInput id="fp-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" />
            </div>
            {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
            <Button type="submit" className="w-full bg-teal-700 hover:bg-teal-800" disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save new password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
