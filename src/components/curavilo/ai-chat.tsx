"use client";

// AI Assistant - grounded Q&A + clinical decision support + role assistant (spec §41-48)
// Animated gradient chat experience: aurora canvas, AI orb, typing dots, mode badges,
// research source cards. All effects are reduced-motion + print safe.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Send, Sparkles, X, Database, ShieldAlert, Globe, Stethoscope,
  Bot, User, RotateCcw, BookOpenCheck, MessagesSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiSend, ApiError, formatDate } from "./api";
import { PageHeader } from "./ui-kit";
import { useApp } from "./store";
import { toast } from "sonner";

interface AIMessageView {
  id: string;
  role: string;
  content: string;
  provenance?: string | null;
}

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  messages?: AIMessageView[];
}

type ChatMode = "data" | "clinical" | "platform" | "general" | "multi";

const OPS_SUGGESTIONS = [
  "How many patients did we see this month?",
  "What was our revenue this month?",
  "Which items are low on stock?",
  "How do I record a payment for an invoice?",
];

const MESSAGING_SUGGESTIONS = [
  "Notify the receptionist that I am ready to take patients",
  "Tell the optician to get the trial frames ready",
  "Who is on the front desk today?",
];

const CLINICAL_SUGGESTIONS = [
  "Differential diagnosis for a red, painful eye with photophobia?",
  "First-line management for newly diagnosed open-angle glaucoma?",
  "Amoxicillin dosing for a 30 kg child with otitis media?",
  "Interpret: IOP 28 mmHg OD, cup-to-disc 0.7, open angles.",
];

function modeBadgeMeta(mode: ChatMode): { label: string; className: string; icon: typeof Database } {
  if (mode === "clinical") return { label: "Clinical decision support", className: "border-violet-200 bg-violet-50 text-violet-800", icon: Stethoscope };
  if (mode === "platform") return { label: "Role assistant", className: "border-indigo-200 bg-indigo-50 text-indigo-800", icon: MessagesSquare };
  if (mode === "general") return { label: "Researched", className: "border-cyan-200 bg-cyan-50 text-cyan-800", icon: Globe };
  if (mode === "multi") return { label: "Multi-step", className: "border-teal-200 bg-teal-50 text-teal-800", icon: BookOpenCheck };
  return { label: "From your records", className: "border-teal-200 bg-teal-50 text-teal-800", icon: Database };
}

/** Derive the answer mode from the tool name + provenance the API returned. */
function deriveMode(toolName: string | null | undefined, provenanceRaw?: string | null): ChatMode {
  if (!toolName) return "data";
  if (toolName === "knowledge.research") {
    try {
      const p = provenanceRaw ? (JSON.parse(provenanceRaw) as { filters?: { mode?: string } }) : null;
      const m = p?.filters?.mode;
      if (m === "clinical" || m === "platform" || m === "general") return m;
    } catch { /* ignore */ }
    return "general";
  }
  if (toolName.startsWith("multi(")) {
    return toolName.includes("knowledge.research") ? "multi" : "data";
  }
  return "data";
}

export function AIChat() {
  const { session, aiPatientContext, setAiPatientContext } = useApp();
  const user = session?.user;
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<(AIMessageView & { mode?: ChatMode })[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ name: string; params: Record<string, unknown>; risk: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isClinical = !!user?.permissions?.some((p) => p === "encounters:write" || p === "lab:operate" || p === "inpatient:manage");
  const suggestions = useMemo(
    () =>
      isClinical
        ? [MESSAGING_SUGGESTIONS[0], ...CLINICAL_SUGGESTIONS.slice(0, 2), OPS_SUGGESTIONS[0]]
        : [OPS_SUGGESTIONS[0], OPS_SUGGESTIONS[2], MESSAGING_SUGGESTIONS[0], MESSAGING_SUGGESTIONS[2]],
    [isClinical]
  );

  const conversations = useQuery({
    queryKey: ["ai-conversations"],
    queryFn: () => apiGet<{ conversations: Conversation[] }>("/api/ai"),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const ask = useMutation({
    mutationFn: (message: string) => apiSend<{ conversationId: string; answer: string; provenance: unknown; usedTool: boolean; toolName: string | null; pendingAction?: { name: string; params: Record<string, unknown>; risk: string } | null }>("POST", "/api/ai", { conversationId, message }),
    onSuccess: (res) => {
      setConversationId(res.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: res.answer,
          provenance: res.provenance ? JSON.stringify(res.provenance) : null,
          mode: deriveMode(res.toolName, res.provenance ? JSON.stringify(res.provenance) : null),
        },
      ]);
      if (res.pendingAction) {
        setPendingAction(res.pendingAction);
      }
      queryClient.invalidateQueries({ queryKey: ["ai-conversations"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 429) setError(e.message);
      else setError((e as Error).message);
    },
  });

  const confirmAction = useMutation({
    mutationFn: (input: { action: string; params: Record<string, unknown> }) => apiSend<{ message: string }>("POST", "/api/ai/act", input),
    onSuccess: (res) => {
      toast.success(res.message);
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: `\u2705 ${res.message}`, provenance: null, mode: "data" }]);
      setPendingAction(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || ask.isPending) return;
    setError(null);
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: trimmed }]);
    setInput("");
    ask.mutate(trimmed);
  };

  const openConversation = async (id: string) => {
    try {
      const res = await apiGet<{ conversation: Conversation & { messages: AIMessageView[] } }>(`/api/ai?conversationId=${id}`);
      setConversationId(id);
      setMessages(res.conversation.messages);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const newConversation = () => {
    setConversationId(null);
    setMessages([]);
    setError(null);
    setPendingAction(null);
  };

  if (!user) return null;

  return (
    <div>
      <PageHeader
        title="AI Assistant"
        subtitle="Your role-aware assistant: facility data answers, clinical decision support for professionals, staff-to-staff messaging, and Curavilo guidance."
        actions={
          <Button variant="outline" size="sm" onClick={newConversation} className="no-print">
            <RotateCcw className="mr-2 h-3.5 w-3.5" /> New conversation
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <aside className="lg:col-span-1" aria-label="Conversation history">
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <div className="border-b bg-gradient-to-r from-teal-50/70 to-cyan-50/50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-teal-900">
              History
            </div>
            <ul className="max-h-64 overflow-y-auto p-1 lg:max-h-[480px]">
              {(conversations.data?.conversations ?? []).length === 0 ? (
                <li className="px-3 py-4 text-center text-xs text-muted-foreground">No conversations yet</li>
              ) : (
                (conversations.data?.conversations ?? []).map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => void openConversation(c.id)}
                      className={`curvilo-nav-item w-full truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-teal-50/70 ${conversationId === c.id ? "bg-teal-50 font-medium text-teal-900" : "text-stone-600"}`}
                    >
                      {c.title}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </aside>

        <div className="lg:col-span-3">
          <div className="relative flex h-[560px] flex-col overflow-hidden rounded-xl border bg-white shadow-sm">
            {/* Animated aurora canvas behind the chat */}
            <div className="curvilo-chat-aurora pointer-events-none absolute inset-0" aria-hidden />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-teal-50/60 to-transparent" aria-hidden />

            {/* Header */}
            <div className="relative z-10 flex items-center gap-3 border-b border-teal-100/80 bg-white/70 px-4 py-3 backdrop-blur-sm">
              <div className="relative flex h-10 w-10 items-center justify-center">
                <div className="curvilo-orb-ring absolute inset-0 rounded-full opacity-80 blur-[2px]" aria-hidden />
                <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-inner">
                  <Sparkles className="h-4 w-4 text-teal-700" aria-hidden />
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-stone-800">
                  Curavilo AI <span className="font-normal text-muted-foreground">for {user.facilityName}</span>
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {isClinical ? "Clinical decision support enabled for your role" : "Answers come from your records and platform knowledge"}
                </p>
              </div>
              <div className="ml-auto hidden items-center gap-1.5 sm:flex">
                <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-[10px] font-medium text-teal-800">{user.role}</span>
                <span className="relative flex h-2 w-2 text-emerald-500">
                  <span className="curvilo-ping relative inline-flex h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                </span>
              </div>
            </div>
            <div className="curvilo-gradient-hairline relative z-10 h-px" aria-hidden />

            {/* Patient context banner */}
            {aiPatientContext ? (
              <div className="relative z-10 flex items-center gap-2 border-b bg-teal-50/70 px-4 py-2 text-sm backdrop-blur-sm">
                <Database className="h-4 w-4 text-teal-700" aria-hidden />
                <span>Context: patient <strong>{aiPatientContext.name}</strong> - questions will be answered from their authorized records.</span>
                <Button variant="ghost" size="sm" className="ml-auto h-7 w-7 p-0" aria-label="Clear patient context" onClick={() => setAiPatientContext(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="relative z-10 border-b border-teal-100/60 px-4 py-2 text-xs text-muted-foreground">
                Context: <strong>{user.facilityName}</strong> · your permissions apply - the AI cannot access data beyond your role.
              </div>
            )}

            {/* Messages */}
            <div ref={scrollRef} className="relative z-10 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
              {messages.length === 0 ? (
                <div className="curvilo-rise flex h-full flex-col items-center justify-center gap-4 text-center">
                  <div className="relative flex h-16 w-16 items-center justify-center">
                    <div className="curvilo-orb-ring absolute inset-0 rounded-full opacity-70 blur-[3px]" aria-hidden />
                    <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-md">
                      <Sparkles className="h-6 w-6 text-teal-700" aria-hidden />
                    </div>
                  </div>
                  <div>
                    <p className="bg-gradient-to-r from-teal-700 via-cyan-700 to-indigo-700 bg-clip-text text-lg font-semibold text-transparent">
                      Ask Curavilo AI
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {isClinical
                        ? "Operational questions, clinical decision support, colleague notifications, or platform help - all in one chat."
                        : "Ask about patients, revenue, stock, colleagues to notify, or how to use Curavilo."}
                    </p>
                  </div>
                  <div className="flex max-w-lg flex-wrap justify-center gap-2">
                    {suggestions.map((s, i) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        style={{ animationDelay: `${i * 70}ms` }}
                        className="curvilo-rise rounded-full border border-stone-200 bg-white/80 px-3 py-1 text-xs text-stone-600 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-400 hover:bg-teal-50/60 hover:text-teal-900"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="curvilo-rise ml-auto flex max-w-[85%] items-end gap-2">
                      <div className="rounded-2xl rounded-br-sm bg-gradient-to-br from-teal-700 to-cyan-700 px-4 py-2 text-sm text-white shadow-sm">
                        {m.content}
                      </div>
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-200" aria-hidden>
                        <User className="h-3.5 w-3.5 text-stone-500" />
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="curvilo-rise max-w-[88%] space-y-1.5">
                      <div className="flex items-start gap-2">
                        <div className="relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center">
                          <div className="curvilo-orb-ring absolute inset-0 rounded-full opacity-60" aria-hidden />
                          <div className="relative flex h-6 w-6 items-center justify-center rounded-full bg-white">
                            <Bot className="h-3.5 w-3.5 text-teal-700" aria-hidden />
                          </div>
                        </div>
                        <div className="whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-stone-200/80 bg-white/90 px-4 py-2.5 text-sm text-stone-800 shadow-sm backdrop-blur-sm">
                          {m.content}
                        </div>
                      </div>
                      {m.mode && m.mode !== "data" ? (() => {
                        const meta = modeBadgeMeta(m.mode);
                        const Icon = meta.icon;
                        return (
                          <div className="ml-9">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.className}`}>
                              <Icon className="h-3 w-3" aria-hidden /> {meta.label}
                            </span>
                          </div>
                        );
                      })() : null}
                      {m.provenance ? <div className="ml-9"><ProvenanceCard raw={m.provenance} /></div> : null}
                    </div>
                  )
                )
              )}
              {ask.isPending ? (
                <div className="curvilo-rise flex items-center gap-2.5 pl-1" role="status">
                  <div className="relative flex h-7 w-7 items-center justify-center">
                    <div className="curvilo-orb-ring absolute inset-0 rounded-full opacity-60" aria-hidden />
                    <div className="relative flex h-6 w-6 items-center justify-center rounded-full bg-white">
                      <Bot className="h-3.5 w-3.5 text-teal-700" aria-hidden />
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 rounded-2xl border border-stone-200/80 bg-white/90 px-4 py-2.5 shadow-sm">
                    <span className="flex items-center gap-1" aria-hidden>
                      <span className="curvilo-dot h-1.5 w-1.5 rounded-full bg-teal-600" />
                      <span className="curvilo-dot h-1.5 w-1.5 rounded-full bg-teal-600" />
                      <span className="curvilo-dot h-1.5 w-1.5 rounded-full bg-teal-600" />
                    </span>
                    <span className="curvilo-shimmer-text text-xs font-medium">Thinking…</span>
                  </div>
                </div>
              ) : null}
              {error ? (
                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
                </div>
              ) : null}
              {pendingAction ? (
                <div className="curvilo-rise ml-auto max-w-[85%] rounded-xl border border-teal-300 bg-teal-50/80 p-3 shadow-sm backdrop-blur-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">Confirm action · risk {pendingAction.risk}</p>
                  {pendingAction.name === "send_staff_message" ? (
                    <div className="mt-1.5 space-y-1.5">
                      <p className="text-sm">
                        Deliver this message to <strong>{String(pendingAction.params.toName ?? pendingAction.params.toDesignation ?? "your colleague")}</strong>
                        {pendingAction.params.subject ? <span className="text-stone-600"> · {String(pendingAction.params.subject)}</span> : null}
                      </p>
                      <p className="rounded-lg border border-teal-200 bg-white/90 px-3 py-2 text-sm italic text-stone-800">&ldquo;{String(pendingAction.params.message ?? "")}&rdquo;</p>
                      {pendingAction.params.urgency && pendingAction.params.urgency !== "NORMAL" ? (
                        <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">{String(pendingAction.params.urgency)}</span>
                      ) : null}
                      <p className="text-[11px] text-muted-foreground">They will receive it on their dashboard and notification bell.</p>
                    </div>
                  ) : (
                    <>
                      <p className="mt-1 text-sm">
                        The assistant proposes: <strong>{pendingAction.name.replaceAll("_", " ")}</strong>
                      </p>
                      <pre className="mt-1 overflow-x-auto rounded bg-white/80 p-2 text-[11px]">{JSON.stringify(pendingAction.params, null, 1)}</pre>
                    </>
                  )}
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" className="bg-gradient-to-r from-teal-700 to-cyan-700 hover:from-teal-800 hover:to-cyan-800" disabled={confirmAction.isPending}
                      onClick={() => confirmAction.mutate({ action: pendingAction.name, params: pendingAction.params })}>
                      {confirmAction.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                      {pendingAction.name === "send_staff_message" ? "Send it now" : "Confirm & execute"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPendingAction(null)}>Dismiss</Button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Composer */}
            <form
              className="relative z-10 flex gap-2 border-t border-teal-100/80 bg-white/80 p-3 backdrop-blur-sm"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={aiPatientContext ? `Ask about ${aiPatientContext.name}…` : isClinical ? "Ask about data, a clinical question, or tell a colleague something…" : "Ask about patients, revenue, stock, or notify a colleague…"}
                aria-label="Ask the AI assistant"
                maxLength={1000}
                className="border-teal-200/80 focus-visible:ring-teal-600/40"
              />
              <Button
                type="submit"
                className="bg-gradient-to-r from-teal-700 to-cyan-700 hover:from-teal-800 hover:to-cyan-800"
                disabled={ask.isPending || !input.trim()}
                aria-label="Send question"
              >
                {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              </Button>
            </form>
          </div>

          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Data answers are grounded in deterministic queries of your authorized records. Clinical answers are decision support for licensed professionals - always verify against current guidelines. Never enter real patient identifiers you are not authorized to query.
          </p>
        </div>
      </div>
    </div>
  );
}

function ProvenanceCard({ raw }: { raw: string }) {
  interface ProvenanceShape {
    source?: string;
    period?: { from?: string; to?: string; label?: string };
    filters?: Record<string, unknown>;
    recordCount?: number;
    note?: string;
    results?: Array<{ title?: string; url?: string }>;
  }
  let provenance: ProvenanceShape | null = null;
  try {
    provenance = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!provenance) return null;
  const sources = Array.isArray(provenance.results) ? provenance.results.filter((r) => r?.url) : [];
  return (
    <div className="rounded-md border border-teal-200 bg-teal-50/60 px-3 py-2 text-[11px] text-teal-900">
      <div className="font-semibold">Based on: {provenance.source ?? "facility records"}</div>
      {provenance.period ? (
        <div>
          Period: {provenance.period.label ?? ""}
          {provenance.period.from ? ` (${formatDate(provenance.period.from)} to ${formatDate(provenance.period.to ?? provenance.period.from)})` : ""}
        </div>
      ) : null}
      {provenance.filters && Object.keys(provenance.filters).length > 0 ? (
        <div>Filters: {Object.entries(provenance.filters).map(([k, v]) => `${k}=${String(v)}`).join(", ")}</div>
      ) : null}
      {typeof provenance.recordCount === "number" ? <div>Records: {provenance.recordCount}</div> : null}
      {provenance.note ? <div>{provenance.note}</div> : null}
      {sources.length > 0 ? (
        <div className="mt-1.5 space-y-0.5">
          <div className="font-semibold">Sources</div>
          {sources.slice(0, 5).map((r, i) => (
            <div key={i} className="truncate">
              <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="underline decoration-teal-400 underline-offset-2 hover:text-teal-700">
                {r.title || r.url}
              </a>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
