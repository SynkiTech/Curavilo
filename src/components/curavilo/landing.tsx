"use client";

// Landing + Auth (login/register entry)
import { useState } from "react";
import { HeartPulse, LogIn, Building2, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiSend, ApiError } from "./api";
import { useApp } from "./store";

export function Landing({ onOpenOnboarding }: { onOpenOnboarding: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setSession = useApp((s) => s.setSession);

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/api/auth", { action: "login", email, password });
      const session = await fetch("/api/auth", { cache: "no-store" }).then((r) => r.json());
      setSession(session);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center gap-10 px-4 py-12 lg:flex-row lg:items-center lg:gap-16">
        <div className="max-w-md">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-700 text-white">
              <HeartPulse className="h-6 w-6" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-stone-900">Curavilo</span>
          </div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-stone-900">
            The operating platform for your healthcare facility.
          </h1>
          <p className="mt-3 text-stone-600">
            Patients, appointments, queues, encounters, billing, pharmacy, documents and AI — one calm,
            permission-aware system that adapts to your specialty.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-stone-600">
            <li>· Configurable service profiles — eye clinics, dental, GP, diagnostics and more</li>
            <li>· Deterministic billing & inventory with auditable ledgers</li>
            <li>· AI answers grounded in your own authorized data — never guessed</li>
          </ul>
          <div className="mt-8 flex items-start gap-2 rounded-lg border border-teal-200 bg-teal-50/60 p-3 text-xs text-teal-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">Demo accounts (synthetic data)</p>
              <p className="mt-0.5">eyeclinic@curavilo.demo · gracefield@curavilo.demo — password <code className="rounded bg-teal-100 px-1">Demo1234!</code></p>
            </div>
          </div>
        </div>

        <Card className="w-full max-w-sm shadow-md">
          <CardHeader>
            <CardTitle className="text-lg">Sign in</CardTitle>
            <CardDescription>Welcome back. Enter your facility account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy) void login();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@facility.ng" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
              {error ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>
              ) : null}
              <Button type="submit" className="w-full bg-teal-700 hover:bg-teal-800" disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
                Sign in
              </Button>
            </form>
            <div className="relative text-center text-xs text-muted-foreground">
              <span className="relative z-10 bg-background px-2">or</span>
              <span className="absolute left-0 top-1/2 h-px w-full bg-border" aria-hidden />
            </div>
            <Button variant="outline" className="w-full" onClick={onOpenOnboarding}>
              <Building2 className="mr-2 h-4 w-4" /> Register your facility
            </Button>
          </CardContent>
        </Card>
      </div>
      <footer className="pb-8 text-center text-xs text-stone-400">
        Curavilo · Synthetic demo data only — not for production clinical use without professional review.
      </footer>
    </div>
  );
}
