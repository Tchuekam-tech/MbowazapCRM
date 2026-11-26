"use client";

import { useSyncExternalStore } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Notification } from "@/types";

const serverSnapshot = () => 0;

const listeners = new Set<() => void>();
let currentCount = 0;
let activeGeneration = 0;
let channelSeq = 0;
let activeChannel: RealtimeChannel | null = null;
let activeClient: SupabaseClient | null = null;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function setCount(next: number | ((prev: number) => number)) {
  const value = typeof next === "function" ? next(currentCount) : next;
  if (value === currentCount) return;
  currentCount = value;
  emit();
}

function startSubscription() {
  const gen = ++activeGeneration;
  const supabase = createClient();
  activeClient = supabase;

  (async () => {
    // head:true skips fetching rows — we only need the `count`
    // supabase-js returns alongside the (empty) response body.
    const { count: unreadCount, error } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .is("read_at", null);
    if (gen !== activeGeneration || error) return;
    setCount(unreadCount ?? 0);
  })();

  // Unique monotonic channel topic avoids @supabase/realtime-js throwing
  // "cannot add `postgres_changes` callbacks ... after `subscribe()`"
  // when multiple components subscribe or a previous async removeChannel
  // is still tearing down.
  const topic = `notifications-unread-count:${++channelSeq}`;
  try {
    activeChannel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        (payload) => {
          if (gen !== activeGeneration) return;
          if (payload.eventType === "INSERT") {
            const row = payload.new as Notification;
            if (!row.read_at) setCount((n) => n + 1);
          } else if (payload.eventType === "UPDATE") {
            // Updates here only ever set read_at (marking a notification
            // read). Derive purely from the new row so we don't rely on
            // payload.old columns, which require REPLICA IDENTITY FULL.
            const newRow = payload.new as Notification;
            if (newRow.read_at) setCount((n) => Math.max(0, n - 1));
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Notification>;
            if (!oldRow.read_at) setCount((n) => Math.max(0, n - 1));
          }
        },
      )
      .subscribe();
  } catch (err) {
    console.error("[useUnreadNotifications] realtime subscribe failed:", err);
  }
}

function stopSubscription() {
  activeGeneration += 1;
  if (activeChannel && activeClient) {
    void activeClient.removeChannel(activeChannel);
  }
  activeChannel = null;
  activeClient = null;
  currentCount = 0;
}

export function subscribeUnreadNotifications(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    startSubscription();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopSubscription();
    }
  };
}

export function getUnreadNotificationsSnapshot(): number {
  return currentCount;
}

/** Test-only helper to clear module state between unit tests. */
export function _resetUnreadNotificationsStoreForTests(): void {
  listeners.clear();
  stopSubscription();
}

/**
 * Count of unread notifications for the current user. Shared across the
 * sidebar badge and mobile header bell via a single ref-counted Realtime
 * subscription so concurrent consumers never collide on channel topics or
 * duplicate queries.
 *
 * RLS on `notifications` already scopes every read to `auth.uid() =
 * user_id`, so no explicit filter is needed here — same pattern as
 * `useTotalUnread` for conversations.
 */
export function useUnreadNotifications(): number {
  return useSyncExternalStore(
    subscribeUnreadNotifications,
    getUnreadNotificationsSnapshot,
    serverSnapshot,
  );
}
