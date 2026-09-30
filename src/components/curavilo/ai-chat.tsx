"use client";

// AI Assistant — grounded Q&A with provenance (spec §41–48)
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Sparkles, X, Database, ShieldAlert } from "lucide-react";
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

const SUGGESTIONS = [
  "How many patients did we see this month?",
  "What was our revenue this month?",
  "How many appointments were missed last month?",
  "Which items are low on stock?",
  "How many follow-ups are overdue?",
  "What was our pharmacy revenue this month?",
];

export function AIChat() {
  const { session, aiPatientContext, setAiPatientContext } = useApp();
  const user = session?.user;
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessageView[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const conversations = useQuery({
    queryKey: ["ai-conversations"],
    queryFn: () => apiGet<{ conversations: Conversation[] }>("/api/ai"),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const ask = useMutation({
    mutationFn: (message: string) => apiSend<{ conversationId: string; answer: string; provenance: unknown; usedTool: boolean; toolName: string | null }>("POST", "/api/ai", { conversationId, message }),
    onSuccess: (res) => {
      setConversationId(res.conversationId);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", content: res.answer, provenance: res.provenance ? JSON.stringify(res.provenance) : null },
      ]);
      queryClient.invalidateQueries({ queryKey: ["ai-conversations"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 429) setError(e.message);
      else setError((e as Error).message);
    },
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
  };

  if (!user) return null;

  return (
    <div>
      <PageHeader
        title="AI Assistant"
        subtitle="Ask about your facility's operational data — answers come from your records, with provenance."
        actions={<Button variant="outline" size="sm" onClick={newConversation}>New conversation</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <aside className="lg:col-span-1" aria-label="Conversation history">
          <div className="rounded-lg border bg-white">
            <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</div>
            <ul className="max-h-64 overflow-y-auto p-1 lg:max-h-[420px]">
              {(conversations.data?.conversations ?? []).length === 0 ? (
                <li className="px-3 py-4 text-center text-xs text-muted-foreground">No conversations yet</li>
              ) : (
                (conversations.data?.conversations ?? []).map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => void openConversation(c.id)}
                      className={`w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-stone-50 ${conversationId === c.id ? "bg-teal-50 font-medium" : ""}`}
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
          <div className="flex h-[520px] flex-col rounded-lg border bg-white">
            {aiPatientContext ? (
              <div className="flex items-center gap-2 border-b bg-teal-50/60 px-4 py-2 text-sm">
                <Database className="h-4 w-4 text-teal-700" aria-hidden />
                <span>Context: patient <strong>{aiPatientContext.name}</strong> — questions will be answered from their authorized records.</span>
                <Button variant="ghost" size="sm" className="ml-auto h-7 w-7 p-0" aria-label="Clear patient context" onClick={() => setAiPatientContext(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="border-b px-4 py-2 text-xs text-muted-foreground">
                Context: <strong>{user.facilityName}</strong> · your permissions apply — the AI cannot access data beyond your role.
              </div>
            )}

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
              {messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <Sparkles className="h-8 w-8 text-teal-700/50" aria-hidden />
                  <p className="text-sm font-medium">Ask Curavilo AI</p>
                  <div className="flex max-w-md flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => send(s)} className="rounded-full border px-3 py-1 text-xs text-stone-600 transition hover:border-teal-500 hover:bg-teal-50/50">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m) => (
                  m.role === "user" ? (
                    <div key={m.id} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-teal-700 px-4 py-2 text-sm text-white">
                      {m.content}
                    </div>
                  ) : (
                    <div key={m.id} className="max-w-[85%] space-y-1.5">
                      <div className="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-stone-100 px-4 py-2.5 text-sm text-stone-800">
                        {m.content}
                      </div>
                      {m.provenance ? <ProvenanceCard raw={m.provenance} /> : null}
                    </div>
                  )
                ))
              )}
              {ask.isPending ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking your records…
                </div>
              ) : null}
              {error ? (
                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
                </div>
              ) : null}
            </div>

            <form
              className="flex gap-2 border-t p-3"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={aiPatientContext ? `Ask about ${aiPatientContext.name}…` : "Ask about patients, revenue, stock, follow-ups…"}
                aria-label="Ask the AI assistant"
                maxLength={1000}
              />
              <Button type="submit" className="bg-teal-700 hover:bg-teal-800" disabled={ask.isPending || !input.trim()} aria-label="Send question">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>

          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            AI answers are grounded in deterministic queries of your authorized data. Always verify critical figures in the underlying records.
          </p>
        </div>
      </div>
    </div>
  );
}

function ProvenanceCard({ raw }: { raw: string }) {
  let provenance: { source?: string; period?: { from?: string; to?: string; label?: string }; filters?: Record<string, unknown>; recordCount?: number; note?: string } | null = null;
  try {
    provenance = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!provenance) return null;
  return (
    <div className="ml-2 rounded-md border border-teal-200 bg-teal-50/50 px-3 py-2 text-[11px] text-teal-900">
      <div className="font-semibold">Based on: {provenance.source ?? "facility records"}</div>
      {provenance.period ? (
        <div>
          Period: {provenance.period.label ?? ""}
          {provenance.period.from ? ` (${formatDate(provenance.period.from)} – ${formatDate(provenance.period.to ?? provenance.period.from)})` : ""}
        </div>
      ) : null}
      {provenance.filters && Object.keys(provenance.filters).length > 0 ? (
        <div>Filters: {Object.entries(provenance.filters).map(([k, v]) => `${k}=${String(v)}`).join(", ")}</div>
      ) : null}
      {typeof provenance.recordCount === "number" ? <div>Records: {provenance.recordCount}</div> : null}
      {provenance.note ? <div>{provenance.note}</div> : null}
    </div>
  );
}
