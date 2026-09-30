"use client";

// Communications & Integrations — provider-neutral comms log, channel adapter
// config, webhook endpoints + delivery log (spec §62, §134, §140)
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Radio, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet, apiSend, formatDateTime } from "./api";
import { LoadingState, ErrorState, EmptyState, PageHeader, StatusBadge } from "./ui-kit";
import { toast } from "sonner";

interface Message { id: string; channel: string; type: string; recipient?: string | null; subject?: string | null; bodyPreview?: string | null; status: string; provider: string; source: string; createdAt: string }
interface Endpoint { id: string; key: string; url: string; events: string; active: boolean }
interface Delivery { id: string; eventType: string; status: string; attempts: number; responseStatus?: number | null; lastError?: string | null; createdAt: string }

const CHANNELS = ["EMAIL", "SMS", "WHATSAPP"] as const;

export function Comms() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"log" | "webhooks">("log");
  const [sendOpen, setSendOpen] = useState(false);
  const [hookOpen, setHookOpen] = useState(false);
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("SMS");
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [hookUrl, setHookUrl] = useState("");
  const [hookEvents, setHookEvents] = useState("PAYMENT_RECEIVED,APPOINTMENT_MISSED");
  const [lastSecret, setLastSecret] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["comms"],
    queryFn: () => apiGet<{ messages: Message[]; providers: Array<{ channel: string; provider: string }> }>("/api/comms"),
  });
  const hooks = useQuery({
    queryKey: ["webhooks"],
    queryFn: () => apiGet<{ endpoints: Endpoint[]; deliveries: Delivery[] }>("/api/webhooks"),
    enabled: tab === "webhooks",
  });

  const send = useMutation({
    mutationFn: () => apiSend("POST", "/api/comms", { action: "SEND", channel, recipient: recipient || null, subject: subject || null, body }),
    onSuccess: () => {
      toast.success("Handed to the adapter — see the log below.");
      queryClient.invalidateQueries({ queryKey: ["comms"] });
      setSendOpen(false); setBody(""); setSubject(""); setRecipient("");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const setProvider = useMutation({
    mutationFn: (input: { ch: string; provider: string }) => apiSend("POST", "/api/comms", { action: "SET_PROVIDER", channel: input.ch, provider: input.provider }),
    onSuccess: () => {
      toast.success("Adapter registered (sandbox uses the console simulation).");
      queryClient.invalidateQueries({ queryKey: ["comms"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const createHook = useMutation({
    mutationFn: () => apiSend<{ secret: string }>("POST", "/api/webhooks", { action: "CREATE", url: hookUrl, events: hookEvents.split(",").map((s) => s.trim()).filter(Boolean) }),
    onSuccess: (res) => {
      toast.success("Endpoint created — signing secret shown once.");
      setLastSecret(res.secret);
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      setHookOpen(false); setHookUrl("");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggleHook = useMutation({
    mutationFn: (id: string) => apiSend("POST", "/api/webhooks", { action: "TOGGLE", endpointId: id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["webhooks"] }),
    onError: (e) => toast.error((e as Error).message),
  });
  const deleteHook = useMutation({
    mutationFn: (id: string) => apiSend("POST", "/api/webhooks", { action: "DELETE", endpointId: id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["webhooks"] }),
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div>
      <PageHeader
        title="Communications & Integrations"
        subtitle="Provider-neutral messaging (all vendors behind adapters — sandbox simulates delivery) and outbound webhooks with HMAC signatures."
        actions={
          tab === "log"
            ? <Button size="sm" variant="outline" onClick={() => setSendOpen(true)}><Send className="mr-1.5 h-3.5 w-3.5" /> Send message</Button>
            : <Button size="sm" variant="outline" onClick={() => { setLastSecret(null); setHookOpen(true); }}><Plus className="mr-1.5 h-3.5 w-3.5" /> Add endpoint</Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mb-3">
        <TabsList>
          <TabsTrigger value="log">Message log</TabsTrigger>
          <TabsTrigger value="webhooks"><Radio className="mr-1.5 h-3.5 w-3.5" />Webhooks</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? <LoadingState /> : null}
      {isError ? <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} /> : null}

      {tab === "log" && data ? (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Channel adapters</CardTitle></CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-3">
              {CHANNELS.map((ch) => {
                const current = data.providers.find((p) => p.channel === ch)?.provider ?? "console";
                return (
                  <div key={ch} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">{ch}</p>
                      <p className="text-xs text-muted-foreground">adapter: {current}</p>
                    </div>
                    <Button size="sm" variant="outline" disabled={current !== "console"} onClick={() => setProvider.mutate({ ch, provider: "console" })}>
                      {current === "console" ? "Simulated" : "Reset"}
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {data.messages.length === 0 ? (
            <EmptyState title="No messages yet" hint="Workflow nodes and manual sends are logged here with delivery status." />
          ) : (
            <div className="overflow-hidden rounded-lg border bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead><TableHead>Type</TableHead><TableHead>Recipient</TableHead>
                    <TableHead>Preview</TableHead><TableHead>Status</TableHead><TableHead>Source</TableHead><TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.messages.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell><Badge variant="outline" className="text-[10px]">{m.channel}</Badge></TableCell>
                      <TableCell className="text-xs">{m.type}</TableCell>
                      <TableCell className="text-xs">{m.recipient ?? "—"}</TableCell>
                      <TableCell className="max-w-48 truncate text-xs text-muted-foreground">{m.subject ?? m.bodyPreview}</TableCell>
                      <TableCell><StatusBadge status={m.status === "SIMULATED" ? "COMPLETED" : m.status} /></TableCell>
                      <TableCell className="text-xs">{m.source}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      ) : null}

      {tab === "webhooks" ? (
        hooks.isLoading ? <LoadingState /> :
        hooks.isError ? <ErrorState message={(hooks.error as Error).message} onRetry={() => void hooks.refetch()} /> : (
          <div className="space-y-4">
            {lastSecret ? (
              <p className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
                New endpoint secret (shown once — store it now): <code className="rounded bg-white px-1.5 py-0.5">{lastSecret}</code>
              </p>
            ) : null}
            {hooks.data?.endpoints.length === 0 ? (
              <EmptyState title="No webhook endpoints" hint="Register a URL and subscribe it to events like PAYMENT_RECEIVED or LAB_RESULT_RELEASED." />
            ) : (
              <div className="space-y-2">
                {hooks.data?.endpoints.map((ep) => (
                  <div key={ep.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{ep.url}</p>
                      <p className="text-xs text-muted-foreground">{ep.events.replaceAll(",", ", ")} · key {ep.key.slice(0, 12)}…</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className={ep.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : ""}>{ep.active ? "ACTIVE" : "PAUSED"}</Badge>
                      <Button size="sm" variant="outline" onClick={() => toggleHook.mutate(ep.id)}>{ep.active ? "Pause" : "Resume"}</Button>
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => deleteHook.mutate(ep.id)} aria-label="Delete endpoint">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {hooks.data && hooks.data.deliveries.length > 0 ? (
              <div className="overflow-hidden rounded-lg border bg-white">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead><TableHead>Status</TableHead><TableHead>Attempts</TableHead><TableHead>Response</TableHead><TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hooks.data.deliveries.slice(0, 15).map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="text-xs">{d.eventType}</TableCell>
                        <TableCell><StatusBadge status={d.status === "DELIVERED" ? "COMPLETED" : d.status === "DEAD" ? "FAILED" : "PENDING"} /></TableCell>
                        <TableCell className="text-xs">{d.attempts}</TableCell>
                        <TableCell className="text-xs">{d.responseStatus ?? d.lastError ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDateTime(d.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </div>
        )
      ) : null}

      {/* Send dialog */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Send a message</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Tabs value={channel} onValueChange={(v) => setChannel(v as (typeof CHANNELS)[number])}>
              <TabsList className="w-full">
                {CHANNELS.map((ch) => <TabsTrigger key={ch} value={ch} className="flex-1">{ch}</TabsTrigger>)}
              </TabsList>
            </Tabs>
            <div className="space-y-1.5">
              <Label htmlFor="msg-recipient">Recipient ({channel === "EMAIL" ? "email" : "phone"})</Label>
              <Input id="msg-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={channel === "EMAIL" ? "patient@example.com" : "0803 000 0000"} />
            </div>
            {channel === "EMAIL" ? (
              <div className="space-y-1.5">
                <Label htmlFor="msg-subject">Subject</Label>
                <Input id="msg-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="msg-body">Body</Label>
              <textarea id="msg-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => send.mutate()} disabled={send.isPending || body.trim().length < 2}>Send via adapter</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Webhook dialog */}
      <Dialog open={hookOpen} onOpenChange={setHookOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add webhook endpoint</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="hook-url">HTTPS URL</Label>
              <Input id="hook-url" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} placeholder="https://example.com/hooks/curavilo" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-events">Events (comma separated)</Label>
              <Input id="hook-events" value={hookEvents} onChange={(e) => setHookEvents(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">Deliveries are signed (HMAC-SHA256) and retried with backoff up to 5 attempts.</p>
          </div>
          <DialogFooter>
            <Button onClick={() => createHook.mutate()} disabled={createHook.isPending || !/^https:\/\//.test(hookUrl)}>Create endpoint</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
