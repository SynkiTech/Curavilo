"use client";

// Staff notifications: AI-relayed colleague messages + system alerts.
// Two delivery surfaces, one polling inbox:
//   - NotificationBell in the top bar (all pages), with unread badge + toasts
//   - TeamMessagesWidget on the role dashboard (spec §67)
// Messages are sent by colleagues through the AI assistant and delivered here.

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, MessageSquareText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiGet, apiSend, formatDateTime } from "./api";
import { useApp } from "./store";
import { toast } from "sonner";

export interface StaffNotification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: StaffNotification[];
  unread: number;
}

export function useNotifications(pollMs = 25_000) {
  const { session } = useApp();
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiGet<NotificationsResponse>("/api/notifications"),
    refetchInterval: pollMs,
    enabled: !!session?.user,
  });
}

function isStaffMessage(n: StaffNotification): boolean {
  return n.type.startsWith("STAFF_MESSAGE");
}

/** Top-bar bell: unread badge, latest notifications, mark read, arrival toasts. */
export function NotificationBell() {
  const { session } = useApp();
  const queryClient = useQueryClient();
  const { data } = useNotifications();
  const seenRef = useRef<Set<string> | null>(null);
  const unread = data?.unread ?? 0;
  const items = data?.notifications ?? [];

  // Toast newly arrived notifications (skip the initial backfill after login).
  useEffect(() => {
    if (!data) return;
    const unreadIds = data.notifications.filter((n) => !n.readAt).map((n) => n.id);
    if (seenRef.current === null) {
      seenRef.current = new Set(unreadIds);
      return;
    }
    const fresh = data.notifications.filter((n) => !n.readAt && !seenRef.current!.has(n.id));
    for (const n of fresh.slice(0, 3)) {
      toast(n.title, { description: n.body ?? undefined });
    }
    seenRef.current = new Set(unreadIds);
  }, [data]);

  const markAll = useMutation({
    mutationFn: () => apiSend("POST", "/api/notifications", { action: "MARK_ALL_READ" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => apiSend("POST", "/api/notifications", { action: "MARK_READ", id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  if (!session?.user) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="relative h-9 w-9 border-teal-900/10 bg-white/70 p-0"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        >
          <Bell className={`h-4 w-4 ${unread ? "text-teal-700" : "text-stone-500"}`} aria-hidden />
          {unread > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gradient-to-r from-teal-600 to-cyan-600 px-1 text-[10px] font-bold text-white shadow" aria-hidden>
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 ? (
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-teal-700" disabled={markAll.isPending} onClick={() => markAll.mutate()}>
              <CheckCheck className="h-3.5 w-3.5" aria-hidden /> Mark all read
            </Button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            No notifications yet. Colleagues can reach you here through the AI assistant.
          </p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {items.slice(0, 12).map((n) => (
              <li key={n.id}>
                <button
                  className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-teal-50/50 ${n.readAt ? "opacity-70" : "bg-teal-50/20"}`}
                  onClick={() => {
                    if (!n.readAt) markOne.mutate(n.id);
                  }}
                  aria-label={n.readAt ? n.title : `Mark read: ${n.title}`}
                >
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${isStaffMessage(n) ? "bg-gradient-to-br from-teal-100 to-cyan-100" : "bg-stone-100"}`}>
                    {isStaffMessage(n) ? <MessageSquareText className="h-3.5 w-3.5 text-teal-700" aria-hidden /> : <Bell className="h-3.5 w-3.5 text-stone-500" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${n.readAt ? "text-stone-600" : "font-semibold text-stone-800"}`}>{n.title}</span>
                    {n.body ? <span className="mt-0.5 line-clamp-2 block text-xs text-stone-500">{n.body}</span> : null}
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">{formatDateTime(n.createdAt)}</span>
                  </span>
                  {!n.readAt ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-500" aria-hidden /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Dashboard widget: the team-message thread as delivered through the AI. */
export function TeamMessagesWidget() {
  const { data, isLoading } = useNotifications(30_000);
  const queryClient = useQueryClient();
  const markOne = useMutation({
    mutationFn: (id: string) => apiSend("POST", "/api/notifications", { action: "MARK_READ", id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const items = data?.notifications ?? [];
  const unread = data?.unread ?? 0;

  return (
    <section aria-label="Team messages" className="curvilo-card curvilo-rise rounded-xl border bg-white" style={{ animationDelay: "520ms" }}>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-teal-600" aria-hidden /> Team messages
        </h2>
        {unread > 0 ? (
          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">{unread} new</span>
        ) : null}
      </div>
      {isLoading ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">Loading messages…</p>
      ) : items.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          No team messages. Ask the AI assistant to notify a colleague for you.
        </p>
      ) : (
        <ul className="max-h-64 divide-y overflow-y-auto">
          {items.slice(0, 6).map((n) => (
            <li key={n.id} className="curvilo-rise px-4 py-2.5 text-sm" style={{ animationDelay: "560ms" }}>
              <button
                className={`flex w-full items-start gap-2.5 text-left ${n.readAt ? "opacity-75" : ""}`}
                onClick={() => {
                  if (!n.readAt) markOne.mutate(n.id);
                }}
                aria-label={n.readAt ? n.title : `Mark read: ${n.title}`}
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-100 to-cyan-100">
                  <MessageSquareText className="h-3.5 w-3.5 text-teal-700" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${n.readAt ? "text-stone-600" : "font-semibold text-stone-800"}`}>{n.title}</span>
                  {n.body ? <span className="mt-0.5 line-clamp-2 block text-xs text-stone-500">{n.body}</span> : null}
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">{formatDateTime(n.createdAt)}</span>
                </span>
                {!n.readAt ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-500" aria-hidden /> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
