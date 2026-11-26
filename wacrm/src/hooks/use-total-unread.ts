"use client";

import { useSyncExternalStore } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Conversation } from "@/types";

const serverSnapshot = () => 0;

const listeners = new Set<() => void>();
let currentTotal = 0;
let countsMap = new Map<string, number>();
let activeGeneration = 0;
let channelSeq = 0;
let activeChannel: RealtimeChannel | null = null;
let activeClient: SupabaseClient | null = null;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function recomputeTotal() {
  let sum = 0;
  for (const n of countsMap.values()) {
    if (n > 0) sum += 1;
  }
  if (sum !== currentTotal) {
    currentTotal = sum;
    emit();
  }
}

function startSubscription() {
  const gen = ++activeGeneration;
  const supabase = createClient();
  activeClient = supabase;

  // Initial load. RLS scopes this to the signed-in user automatically —
  // no explicit user_id filter needed here.
  (async () => {
    const { data, error } = await supabase
      .from("conversations")
      .select("id, unread_count");
    if (gen !== activeGeneration || error || !data) return;

    const map = new Map<string, number>();
    for (const row of data as { id: string; unread_count: number }[]) {
      map.set(row.id, row.unread_count ?? 0);
    }
    countsMap = map;
    recomputeTotal();
  })();

  // Unique monotonic channel topic avoids @supabase/realtime-js throwing
  // "cannot add `postgres_changes` callbacks ... after `subscribe()`"
  // across concurrent consumers (Sidebar + MobileBottomDock) or rapid
  // unmount/remount cycles while removeChannel is still settling.
  const topic = `total-unread-realtime:${++channelSeq}`;
  try {
    activeChannel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          if (gen !== activeGeneration) return;
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Conversation>;
            if (oldRow.id) countsMap.delete(oldRow.id);
          } else {
            const row = payload.new as Conversation;
            countsMap.set(row.id, row.unread_count ?? 0);
          }
          recomputeTotal();
        },
      )
      .subscribe();
  } catch (err) {
    console.error("[useTotalUnread] realtime subscribe failed:", err);
  }
}

function stopSubscription() {
  activeGeneration += 1;
  if (activeChannel && activeClient) {
    void activeClient.removeChannel(activeChannel);
  }
  activeChannel = null;
  activeClient = null;
  countsMap = new Map();
  currentTotal = 0;
}

export function subscribeTotalUnread(listener: () => void): () => void {
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

export function getTotalUnreadSnapshot(): number {
  return currentTotal;
}

/** Test-only helper to clear module state between unit tests. */
export function _resetTotalUnreadStoreForTests(): void {
  listeners.clear();
  stopSubscription();
}

/**
 * Count of conversations with at least one unread inbound message for
 * the current user. Shared across the sidebar Inbox indicator and the
 * mobile bottom dock via a single ref-counted Realtime subscription so
 * concurrent consumers never collide on channel topics or duplicate queries.
 */
export function useTotalUnread(): number {
  return useSyncExternalStore(
    subscribeTotalUnread,
    getTotalUnreadSnapshot,
    serverSnapshot,
  );
}
