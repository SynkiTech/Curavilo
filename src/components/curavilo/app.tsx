"use client";

// Curavilo root — session boot, landing/onboarding/app-shell routing
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { apiGet, type SessionInfo } from "./api";
import { useApp } from "./store";
import { Landing } from "./landing";
import { Onboarding } from "./onboarding";
import { Shell } from "./shell";
import { Overview } from "./overview";
import { Patients, RegisterDialog } from "./patients";
import { PatientDetail } from "./patient-detail";
import { Appointments } from "./appointments";
import { Queue } from "./queue";
import { Encounters, EncounterDetail } from "./encounters";
import { Billing, InvoiceDetail } from "./billing";
import { POS } from "./pos";
import { Inventory } from "./inventory";
import { Reports } from "./reports";
import { AIChat } from "./ai-chat";
import { Workflows, Audit, Staff, FollowUps, Settings } from "./admin";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: false } },
});

export function CuraviloApp() {
  const { booted, session, route, setBooted, setSession, navigate } = useApp();

  useEffect(() => {
    apiGet<SessionInfo>("/api/auth")
      .then(setSession)
      .catch(() => setSession({ authenticated: false }))
      .finally(() => setBooted(true));
  }, [setSession, setBooted]);

  if (!booted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#042f2e_0%,#083344_28%,#0c4a6e_55%,#1e1b4b_100%)]">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 animate-pulse items-center justify-center rounded-xl bg-white/15 text-lg font-bold text-white ring-1 ring-white/30">C</div>
          <p className="text-sm text-teal-100/70" role="status">Loading Curavilo…</p>
        </div>
      </div>
    );
  }

  let screen: React.ReactNode;
  if (!session?.authenticated) {
    screen = route.view === "onboarding" ? <Onboarding onBack={() => navigate("overview")} /> : <Landing onOpenOnboarding={() => navigate("onboarding")} />;
  } else {
    screen = (
      <Shell>
        <Screen />
      </Shell>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      {screen}
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}

function Screen() {
  const { route } = useApp();
  switch (route.view) {
    case "overview": return <Overview />;
    case "patients": return <Patients />;
    case "patient-detail": return <PatientDetail patientId={route.params?.patientId ?? ""} />;
    case "appointments": return <Appointments />;
    case "queue": return <Queue />;
    case "encounters": return <Encounters />;
    case "encounter-detail": return <EncounterDetail encounterId={route.params?.encounterId ?? ""} />;
    case "billing": return <Billing />;
    case "invoice-detail": return <InvoiceDetail invoiceId={route.params?.invoiceId ?? ""} />;
    case "pos": return <POS />;
    case "inventory": return <Inventory />;
    case "reports": return <Reports />;
    case "ai": return <AIChat />;
    case "workflows": return <Workflows />;
    case "audit": return <Audit />;
    case "staff": return <Staff />;
    case "followups": return <FollowUps />;
    case "settings": return <Settings />;
    default: return <Overview />;
  }
}

export { RegisterDialog };
