"use client";

// Workflow builder — structured, zero-dependency visual editor for the
// declarative workflow engine (ADR 0007). Nodes are typed cards; the graph is
// a linear chain with CONDITION branch targets; no free-form code is possible.
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiSend, ApiError } from "./api";
import { toast } from "sonner";

export const NODE_TYPES_UI = [
  "CREATE_FOLLOWUP", "CREATE_TASK", "NOTIFY", "SEND_EMAIL", "SEND_SMS", "SEND_WHATSAPP",
  "CREATE_APPOINTMENT", "GENERATE_REPORT", "GENERATE_DOCUMENT", "INVOKE_WEBHOOK",
  "DELAY", "CONDITION", "APPROVAL",
] as const;

export const TRIGGERS_UI = [
  "MANUAL", "ENCOUNTER_COMPLETED", "PATIENT_REGISTERED", "APPOINTMENT_MISSED",
  "PAYMENT_RECEIVED", "INVOICE_OVERDUE", "FOLLOWUP_DUE", "STOCK_BELOW_THRESHOLD",
  "STOCK_EXPIRING", "LAB_RESULT_RELEASED", "SCHEDULED",
] as const;

type NodeType = (typeof NODE_TYPES_UI)[number];

export interface BuilderNode { id: string; type: NodeType; config: Record<string, string> }

export interface BuilderInitial {
  workflowId?: string;
  key?: string;
  name?: string;
  definition?: { trigger?: string; schedule?: { everyMinutes?: number; dailyAt?: string }; nodes?: BuilderNode[]; edges?: unknown[] };
  slaMinutes?: number | null;
}

function defaultConfig(type: NodeType): Record<string, string> {
  switch (type) {
    case "CREATE_FOLLOWUP": return { title: "Follow-up visit", days: "7" };
    case "CREATE_TASK": return { title: "", role: "NURSE", priority: "NORMAL" };
    case "NOTIFY": return { title: "", body: "", role: "ADMIN", channels: "IN_APP" };
    case "SEND_EMAIL": return { to: "", subject: "", body: "" };
    case "SEND_SMS": case "SEND_WHATSAPP": return { to: "", body: "" };
    case "CREATE_APPOINTMENT": return { daysAhead: "1", hour: "9", durationMin: "30" };
    case "GENERATE_REPORT": return { reportKey: "REVENUE_SUMMARY", title: "Weekly revenue summary" };
    case "GENERATE_DOCUMENT": return { template: "NOTE", title: "", body: "" };
    case "INVOKE_WEBHOOK": return { event: "WORKFLOW_EVENT" };
    case "DELAY": return { minutes: "60" };
    case "CONDITION": return { field: "amountMinor", operator: "gt", value: "0", trueTarget: "", falseTarget: "" };
    case "APPROVAL": return { title: "Approve before continuing", role: "ADMIN", slaMinutes: "480" };
    default: return {};
  }
}

const NODE_LABELS: Record<NodeType, string> = {
  CREATE_FOLLOWUP: "Create follow-up", CREATE_TASK: "Create task", NOTIFY: "Notify (multi-channel)",
  SEND_EMAIL: "Send email", SEND_SMS: "Send SMS", SEND_WHATSAPP: "Send WhatsApp",
  CREATE_APPOINTMENT: "Create appointment", GENERATE_REPORT: "Generate report", GENERATE_DOCUMENT: "Generate document",
  INVOKE_WEBHOOK: "Invoke webhooks", DELAY: "Wait / timer", CONDITION: "Condition (branch)", APPROVAL: "Approval gate",
};

export function WorkflowBuilderDialog({
  open, onClose, initial, nodeTypes = NODE_TYPES_UI,
}: {
  open: boolean;
  onClose: () => void;
  initial?: BuilderInitial;
  nodeTypes?: readonly string[];
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [key, setKey] = useState(initial?.key ?? "");
  const [trigger, setTrigger] = useState((initial?.definition?.trigger as (typeof TRIGGERS_UI)[number]) ?? "ENCOUNTER_COMPLETED");
  const [slaMinutes, setSlaMinutes] = useState(initial?.slaMinutes ? String(initial.slaMinutes) : "");
  const [everyMinutes, setEveryMinutes] = useState(initial?.definition?.schedule?.everyMinutes ? String(initial.definition.schedule.everyMinutes) : "");
  const [dailyAt, setDailyAt] = useState(initial?.definition?.schedule?.dailyAt ?? "");
  const [nodes, setNodes] = useState<BuilderNode[]>(
    initial?.definition?.nodes?.length
      ? initial.definition.nodes
      : [{ id: "n1", type: "CREATE_FOLLOWUP", config: defaultConfig("CREATE_FOLLOWUP") }],
  );
  const [dryRunResult, setDryRunResult] = useState<Array<{ nodeKey: string; type: string; status: string; output?: string | null; error?: string | null }> | null>(null);

  const types = (nodeTypes.length ? nodeTypes : NODE_TYPES_UI) as readonly NodeType[];

  const isEdit = !!initial?.workflowId;
  const definition = useMemo(() => {
    const edges: Array<{ from: string; to: string; label?: string }> = [];
    nodes.forEach((n, i) => {
      if (n.type === "CONDITION") {
        if (n.config.trueTarget) edges.push({ from: n.id, to: n.config.trueTarget, label: "true" });
        if (n.config.falseTarget) edges.push({ from: n.id, to: n.config.falseTarget, label: "false" });
      } else if (i < nodes.length - 1) {
        edges.push({ from: n.id, to: nodes[i + 1].id });
      }
    });
    return {
      trigger,
      ...((everyMinutes || dailyAt) ? { schedule: { ...(everyMinutes ? { everyMinutes: Number(everyMinutes) } : {}), ...(dailyAt ? { dailyAt } : {}) } } : {}),
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        config: Object.fromEntries(Object.entries(n.config).filter(([, v]) => v !== "").map(([k, v]) =>
          ["days", "minutes", "daysAhead", "hour", "durationMin", "slaMinutes"].includes(k) ? [k, Number(v)] : [k, v],
        )),
      })),
      edges,
    };
  }, [nodes, trigger, everyMinutes, dailyAt]);

  const save = useMutation({
    mutationFn: () => apiSend<{ workflow?: { id: string } }>("POST", "/api/workflows", {
      action: isEdit ? "UPDATE" : "CREATE",
      ...(isEdit ? { workflowId: initial!.workflowId } : { key: key.trim() }),
      name: name.trim(),
      definition,
      slaMinutes: slaMinutes ? Number(slaMinutes) : null,
    }),
    onSuccess: () => {
      toast.success(isEdit ? "Workflow updated." : "Workflow created as draft — dry-run it, then publish.");
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : (e as Error).message),
  });

  const dryRun = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        const res = await apiSend<{ dryRun: { status: string; nodes: Array<{ nodeKey: string; type: string; status: string; output?: string | null; error?: string | null }> } }>(
          "POST", "/api/workflows", { action: "DRY_RUN", workflowId: initial!.workflowId, payload: {} },
        );
        return res.dryRun.nodes;
      }
      // Unsaved draft: create first (as draft), then dry-run it.
      const created = await apiSend<{ workflow: { id: string } }>("POST", "/api/workflows", {
        action: "CREATE", key: key.trim(), name: name.trim(), definition, slaMinutes: slaMinutes ? Number(slaMinutes) : null,
      });
      const res = await apiSend<{ dryRun: { nodes: Array<{ nodeKey: string; type: string; status: string; output?: string | null; error?: string | null }> } }>(
        "POST", "/api/workflows", { action: "DRY_RUN", workflowId: created.workflow.id, payload: {} },
      );
      return res.dryRun.nodes;
    },
    onSuccess: (steps) => {
      setDryRunResult(steps);
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      toast.success("Dry-run complete — side effects were simulated only.");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : (e as Error).message),
  });

  const updateNode = (idx: number, patch: Partial<BuilderNode>) =>
    setNodes((ns) => ns.map((n, i) => (i === idx ? { ...n, ...patch } : n)));
  const updateConfig = (idx: number, k: string, v: string) =>
    setNodes((ns) => ns.map((n, i) => (i === idx ? { ...n, config: { ...n.config, [k]: v } } : n)));

  const move = (idx: number, dir: -1 | 1) =>
    setNodes((ns) => {
      const next = [...ns];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return ns;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });

  const strField = (idx: number, k: string, label: string, placeholder = "") => (
    <div key={k} className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={nodes[idx].config[k] ?? ""} onChange={(e) => updateConfig(idx, k, e.target.value)} placeholder={placeholder} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit workflow (creates a new draft version if published)" : "Build workflow"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Outpatient follow-up flow" />
          </div>
          <div className="space-y-1">
            <Label>Key (unique, lowercase)</Label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} disabled={isEdit} placeholder="outpatient-followup" />
          </div>
          <div className="space-y-1">
            <Label>Trigger</Label>
            <Select value={trigger} onValueChange={(v) => setTrigger(v as (typeof TRIGGERS_UI)[number])}>
              <SelectTrigger aria-label="Trigger"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRIGGERS_UI.map((t) => <SelectItem key={t} value={t}>{t.replaceAll("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Run SLA (minutes, optional)</Label>
            <Input value={slaMinutes} onChange={(e) => setSlaMinutes(e.target.value)} placeholder="240" inputMode="numeric" />
          </div>
          {trigger === "SCHEDULED" ? (
            <>
              <div className="space-y-1">
                <Label>Every N minutes</Label>
                <Input value={everyMinutes} onChange={(e) => setEveryMinutes(e.target.value)} placeholder="60" inputMode="numeric" />
              </div>
              <div className="space-y-1">
                <Label>…or daily at (HH:MM)</Label>
                <Input value={dailyAt} onChange={(e) => setDailyAt(e.target.value)} placeholder="08:00" />
              </div>
            </>
          ) : null}
        </div>

        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between">
            <Label>Steps (executed in order)</Label>
            <Button size="sm" variant="outline" onClick={() => setNodes((ns) => [...ns, { id: `n${Date.now()}`, type: "CREATE_TASK", config: defaultConfig("CREATE_TASK") }])}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add step
            </Button>
          </div>

          {nodes.map((node, idx) => (
            <div key={node.id} className="rounded-lg border bg-stone-50/60 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-700 text-xs font-semibold text-white">{idx + 1}</span>
                <Select value={node.type} onValueChange={(v) => updateNode(idx, { type: v as NodeType, config: defaultConfig(v as NodeType) })}>
                  <SelectTrigger className="h-8 w-56" aria-label="Node type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {types.map((t) => <SelectItem key={t} value={t}>{NODE_LABELS[t] ?? t}</SelectItem>)}
                  </SelectContent>
                </Select>
                {node.type === "DELAY" ? <Badge variant="outline" className="text-[10px]"><ArrowDown className="h-3 w-3" /> pauses run</Badge> : null}
                {node.type === "APPROVAL" ? <Badge variant="outline" className="text-[10px]">pauses for decision</Badge> : null}
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => move(idx, 1)} disabled={idx === nodes.length - 1} aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600" onClick={() => setNodes((ns) => ns.filter((_, i) => i !== idx))} aria-label="Remove step"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {node.type === "CREATE_FOLLOWUP" ? [strField(idx, "title", "Title"), strField(idx, "days", "Due in days", "7")] : null}
                {node.type === "CREATE_TASK" ? [strField(idx, "title", "Title"), strField(idx, "role", "Assign to role", "NURSE")] : null}
                {node.type === "NOTIFY" ? [strField(idx, "title", "Title"), strField(idx, "body", "Body"), strField(idx, "role", "Role"), strField(idx, "channels", "Channels (IN_APP,EMAIL,SMS)")] : null}
                {node.type === "SEND_EMAIL" ? [strField(idx, "to", "To"), strField(idx, "subject", "Subject"), strField(idx, "body", "Body")] : null}
                {["SEND_SMS", "SEND_WHATSAPP"].includes(node.type) ? [strField(idx, "to", "Phone"), strField(idx, "body", "Body")] : null}
                {node.type === "CREATE_APPOINTMENT" ? [strField(idx, "daysAhead", "In days", "1"), strField(idx, "hour", "Hour (24h)", "9")] : null}
                {node.type === "GENERATE_REPORT" ? [strField(idx, "reportKey", "Report key", "REVENUE_SUMMARY"), strField(idx, "title", "Document title")] : null}
                {node.type === "GENERATE_DOCUMENT" ? [strField(idx, "template", "Template key"), strField(idx, "title", "Title"), strField(idx, "body", "Body")] : null}
                {node.type === "INVOKE_WEBHOOK" ? [strField(idx, "event", "Event name", "WORKFLOW_EVENT")] : null}
                {node.type === "DELAY" ? [strField(idx, "minutes", "Wait minutes", "60")] : null}
                {node.type === "APPROVAL" ? [strField(idx, "title", "Approval title"), strField(idx, "role", "Decider role", "ADMIN"), strField(idx, "slaMinutes", "Decision SLA (min)", "480")] : null}
                {node.type === "CONDITION" ? (
                  <>
                    {strField(idx, "field", "Payload field", "amountMinor")}
                    <div className="space-y-1">
                      <Label className="text-xs">Operator</Label>
                      <Select value={nodes[idx].config.operator ?? "gt"} onValueChange={(v) => updateConfig(idx, "operator", v)}>
                        <SelectTrigger className="h-9" aria-label="Operator"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["eq", "neq", "gt", "lt", "exists"].map((op) => <SelectItem key={op} value={op}>{op}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    {strField(idx, "value", "Compare value")}
                    <div className="space-y-1">
                      <Label className="text-xs">TRUE → step</Label>
                      <Select value={nodes[idx].config.trueTarget ?? ""} onValueChange={(v) => updateConfig(idx, "trueTarget", v)}>
                        <SelectTrigger className="h-9" aria-label="True branch"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {nodes.filter((n2) => n2.id !== node.id).map((n) => <SelectItem key={n.id} value={n.id}>{nodes.indexOf(n) + 1}. {NODE_LABELS[n.type] ?? n.type}</SelectItem>)}
                          {nodes.length <= 1 ? <SelectItem value="end">End of flow</SelectItem> : null}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">FALSE → step</Label>
                      <Select value={nodes[idx].config.falseTarget ?? ""} onValueChange={(v) => updateConfig(idx, "falseTarget", v)}>
                        <SelectTrigger className="h-9" aria-label="False branch"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {nodes.filter((n2) => n2.id !== node.id).map((n) => <SelectItem key={n.id} value={n.id}>{nodes.indexOf(n) + 1}. {NODE_LABELS[n.type] ?? n.type}</SelectItem>)}
                          {nodes.length <= 1 ? <SelectItem value="end">End of flow</SelectItem> : null}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                ) : null}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Tip: use {"{{patientName}}"}, {"{{invoiceNumber}}"} placeholders in texts — they resolve from the trigger payload.</p>
            </div>
          ))}
        </div>

        {dryRunResult ? (
          <div className="rounded-lg border bg-stone-50 p-3 text-sm">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dry-run result (no side effects)</p>
            <ul className="space-y-1">
              {dryRunResult.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-xs">
                  <span>{s.nodeKey} · {s.type.replaceAll("_", " ")}</span>
                  <span className={s.status === "COMPLETED" ? "text-emerald-700" : s.status === "FAILED" ? "text-red-700" : "text-amber-700"}>
                    {s.status}{s.output && s.status === "COMPLETED" ? ` — ${s.output.slice(0, 60)}` : ""}{s.error ? ` — ${s.error}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => dryRun.mutate()} disabled={dryRun.isPending || (!isEdit && key.trim().length < 2) || name.trim().length < 2}>
            <Play className="mr-1.5 h-4 w-4" /> Dry run
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || name.trim().length < 2 || (!isEdit && key.trim().length < 2)}>
            {isEdit ? "Save changes" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
