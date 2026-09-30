"use client";

// App shell: dark-gradient sidebar navigation, facility switcher, global search, user menu
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, Users, CalendarDays, ListOrdered, ClipboardPlus, ReceiptText, ShoppingCart,
  Boxes, BarChart3, Sparkles, Workflow as WorkflowIcon, ScrollText, UserCog, Settings, Bell,
  Search, LogOut, HeartPulse, ChevronsUpDown, Check,
  FlaskConical, BedDouble, Gauge, Shuffle, MessageSquareText, DatabaseBackup, CalendarCheck2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { apiGet, apiSend, type Patient } from "./api";
import { can, useApp, type ViewName } from "./store";
import { MODULE_PERMISSION } from "@/lib/rbac";

interface NavItem {
  view: ViewName;
  label: string;
  icon: typeof LayoutDashboard;
  group: string;
}

const NAV: NavItem[] = [
  { view: "overview", label: "Overview", icon: LayoutDashboard, group: "Operations" },
  { view: "patients", label: "Patients", icon: Users, group: "Operations" },
  { view: "appointments", label: "Appointments", icon: CalendarDays, group: "Operations" },
  { view: "queue", label: "Queue", icon: ListOrdered, group: "Operations" },
  { view: "encounters", label: "Encounters", icon: ClipboardPlus, group: "Operations" },
  { view: "followups", label: "Follow-ups", icon: Bell, group: "Operations" },
  { view: "myday", label: "My Day", icon: CalendarCheck2, group: "Operations" },
  { view: "lab", label: "Lab & Radiology", icon: FlaskConical, group: "Operations" },
  { view: "wards", label: "Wards & Admissions", icon: BedDouble, group: "Operations" },
  { view: "billing", label: "Billing", icon: ReceiptText, group: "Finance" },
  { view: "pos", label: "POS / Pharmacy", icon: ShoppingCart, group: "Finance" },
  { view: "reports", label: "Reports", icon: BarChart3, group: "Finance" },
  { view: "inventory", label: "Inventory", icon: Boxes, group: "Supply" },
  { view: "ai", label: "AI Assistant", icon: Sparkles, group: "Intelligence" },
  { view: "workflows", label: "Workflows", icon: WorkflowIcon, group: "Intelligence" },
  { view: "command", label: "Command Center", icon: Gauge, group: "Intelligence" },
  { view: "simulation", label: "Simulation", icon: Shuffle, group: "Intelligence" },
  { view: "comms", label: "Communications", icon: MessageSquareText, group: "Administration" },
  { view: "data", label: "Data & Portals", icon: DatabaseBackup, group: "Administration" },
  { view: "staff", label: "Staff", icon: UserCog, group: "Administration" },
  { view: "audit", label: "Audit Log", icon: ScrollText, group: "Administration" },
  { view: "settings", label: "Settings", icon: Settings, group: "Administration" },
];

function useClock(): string {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const t = setInterval(() => setNow(fmt()), 15_000);
    const kick = setTimeout(() => setNow(fmt()), 0);
    return () => {
      clearInterval(t);
      clearTimeout(kick);
    };
  }, []);
  return now;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { session, route, navigate, setSession } = useApp();
  const user = session?.user;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const clock = useClock();

  const navByGroup = useMemo(() => {
    const groups = new Map<string, NavItem[]>();
    for (const item of NAV) {
      const perm = MODULE_PERMISSION[item.view];
      if (perm && !can(perm)) continue;
      const list = groups.get(item.group) ?? [];
      list.push(item);
      groups.set(item.group, list);
    }
    return [...groups.entries()];
  }, [session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!user) return null;

  const logout = async () => {
    await apiSend("POST", "/api/auth", { action: "logout" }).catch(() => undefined);
    setSession({ authenticated: false });
  };

  const switchFacility = async (facilityId: string) => {
    await apiSend("POST", "/api/auth", { action: "switch-facility", facilityId });
    const fresh = await apiGet<typeof session>("/api/auth");
    setSession(fresh ?? { authenticated: false });
    navigate("overview");
  };

  const sidebar = (
    <nav aria-label="Main navigation" className="curvilo-scroll flex h-full flex-col gap-4 overflow-y-auto p-3">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-2 pt-1">
        <div className="relative shrink-0">
          <div className="curvilo-spin-slow absolute -inset-1 rounded-xl bg-[conic-gradient(from_0deg,#2dd4bf,#22d3ee,#818cf8,#e879f9,#2dd4bf)] opacity-60 blur-[3px]" aria-hidden />
          <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-cyan-600 text-white shadow-lg">
            <HeartPulse className="h-5 w-5" aria-hidden />
          </div>
        </div>
        <div className="min-w-0">
          <div className="truncate bg-gradient-to-r from-white via-teal-100 to-cyan-200 bg-clip-text text-sm font-bold tracking-tight text-transparent">Curavilo</div>
          <div className="truncate text-[11px] text-teal-200/60">{user.orgName}</div>
        </div>
      </div>

      {navByGroup.map(([group, items]) => (
        <div key={group}>
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-200/40">{group}</div>
          <ul className="space-y-0.5">
            {items.map((item) => {
              const active = route.view === item.view || (item.view === "patients" && route.view === "patient-detail") || (item.view === "billing" && route.view === "invoice-detail") || (item.view === "encounters" && route.view === "encounter-detail");
              const Icon = item.icon;
              return (
                <li key={item.view}>
                  <button
                    onClick={() => {
                      navigate(item.view);
                      setMobileOpen(false);
                    }}
                    aria-current={active ? "page" : undefined}
                    className={`curvilo-nav-item group relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm ${
                      active
                        ? "bg-gradient-to-r from-teal-400/20 via-cyan-400/10 to-transparent font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                        : "text-teal-100/60 hover:bg-white/5 hover:text-teal-50"
                    }`}
                  >
                    {active ? (
                      <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-teal-300 to-cyan-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]" aria-hidden />
                    ) : null}
                    <Icon className={`h-4 w-4 shrink-0 transition-colors ${active ? "text-teal-300" : "text-teal-200/40 group-hover:text-teal-200"}`} aria-hidden />
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="mt-auto rounded-xl border border-white/10 bg-white/5 p-2.5 text-[11px] text-teal-100/70 backdrop-blur">
        <div className="font-semibold text-teal-50">{user.name}</div>
        <div>{user.role} · {session?.facilities?.length ?? 1} facility{(session?.facilities?.length ?? 1) > 1 ? "s" : ""}</div>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-stone-50 via-teal-50/40 to-cyan-50/30">
      {/* Desktop sidebar: dark gradient for a clear color identity against the light workspace */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 bg-gradient-to-b from-[#042f2b] via-[#073f3c] to-[#0b3550] lg:block">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-cyan-400/10 to-transparent" aria-hidden />
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-teal-900/10 bg-white/80 px-3 shadow-[0_1px_0_rgba(13,148,136,0.06)] backdrop-blur-md">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="lg:hidden" aria-label="Open navigation">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M3 12h18M3 6h18M3 18h18" /></svg>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 border-0 bg-gradient-to-b from-[#042f2b] via-[#073f3c] to-[#0b3550] p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              {sidebar}
            </SheetContent>
          </Sheet>

          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-teal-900/10 bg-white/70 px-3 text-sm text-muted-foreground transition hover:border-teal-400 hover:shadow-[0_0_0_3px_rgba(45,212,191,0.12)] sm:max-w-md"
          >
            <Search className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Search patients, invoices…</span>
            <kbd className="ml-auto hidden rounded border bg-white px-1.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            {clock ? (
              <span className="mr-1 hidden rounded-full border border-teal-900/10 bg-teal-50/70 px-2.5 py-1 text-xs font-medium tabular-nums text-teal-800 md:inline">
                {clock}
              </span>
            ) : null}
            {/* Facility switcher */}
            {(session?.facilities?.length ?? 0) > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="max-w-[160px] gap-1.5 border-teal-900/10 bg-white/70">
                    <span className="truncate">{user.facilityName}</span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Your facilities</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {session?.facilities?.map((f) => (
                    <DropdownMenuItem key={f.id} onClick={() => void switchFacility(f.id)}>
                      <Check className={`mr-1 h-4 w-4 ${f.id === user.facilityId ? "opacity-100" : "opacity-0"}`} />
                      <span className="truncate">{f.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="hidden max-w-[220px] truncate rounded-md border border-teal-900/10 bg-white/70 px-2.5 py-1.5 text-xs text-stone-600 md:block">
                {user.facilityName}
              </span>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2" aria-label="Account menu">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-cyan-600 text-xs font-semibold text-white shadow-sm">
                    {user.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                  </span>
                  <span className="hidden text-xs font-medium sm:inline">{user.role}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  <div className="text-sm">{user.name}</div>
                  <div className="text-xs font-normal text-muted-foreground">{user.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void logout()}>
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>

        <footer className="mt-auto border-t border-teal-900/10 bg-white/70 px-6 py-3 text-center text-[11px] text-stone-400 backdrop-blur">
          Curavilo · Synthetic demo data - clinical starter forms require professional review before production use.
        </footer>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { navigate } = useApp();
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !can("patients:read")) return;
    let active = true;
    const t = setTimeout(() => {
      setLoading(true);
      apiGet<{ patients: Patient[] }>(`/api/patients?q=${encodeURIComponent(query)}&limit=8`)
        .then((r) => {
          if (active) setPatients(r.patients);
        })
        .catch(() => undefined)
        .finally(() => active && setLoading(false));
    }, 200);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query, open]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search patients by name, MRN or phone…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{loading ? "Searching…" : "No results found."}</CommandEmpty>
        {can("patients:read") && patients.length > 0 ? (
          <CommandGroup heading="Patients">
            {patients.map((p) => (
              <CommandItem
                key={p.id}
                value={`${p.firstName} ${p.lastName} ${p.mrn} ${p.phone}`}
                onSelect={() => {
                  navigate("patient-detail", { patientId: p.id });
                  onOpenChange(false);
                }}
              >
                <Users className="mr-2 h-4 w-4 text-stone-400" />
                <span>{p.firstName} {p.lastName}</span>
                <span className="ml-auto text-xs text-muted-foreground">{p.mrn}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
