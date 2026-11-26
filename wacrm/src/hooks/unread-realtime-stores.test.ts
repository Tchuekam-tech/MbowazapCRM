import { beforeEach, describe, expect, it, vi } from "vitest";

type PostgresCallback = (payload: {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
}) => void;

interface MockChannel {
  topic: string;
  subscribed: boolean;
  callbacks: PostgresCallback[];
  on: (
    type: string,
    filter: Record<string, unknown>,
    cb: PostgresCallback,
  ) => MockChannel;
  subscribe: () => MockChannel;
}

const mockState = {
  channels: new Map<string, MockChannel>(),
  createdTopics: [] as string[],
  removedTopics: [] as string[],
  notificationsCount: 3,
  conversations: [
    { id: "c1", unread_count: 2 },
    { id: "c2", unread_count: 0 },
    { id: "c3", unread_count: 5 },
  ],
};

function createStrictSupabaseMock() {
  return {
    from(table: string) {
      if (table === "notifications") {
        return {
          select: () => ({
            is: async () => ({ count: mockState.notificationsCount, error: null }),
          }),
        };
      }
      if (table === "conversations") {
        return {
          select: async () => ({ data: mockState.conversations, error: null }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    channel(topic: string): MockChannel {
      // Replicate @supabase/realtime-js's exact behavior: reusing an existing
      // channel topic returns the existing instance, and calling .on() after
      // .subscribe() synchronously throws.
      const existing = mockState.channels.get(topic);
      if (existing) return existing;

      mockState.createdTopics.push(topic);
      const chan: MockChannel = {
        topic,
        subscribed: false,
        callbacks: [],
        on(type, _filter, cb) {
          if (chan.subscribed && type === "postgres_changes") {
            throw new Error(
              `cannot add \`${type}\` callbacks for realtime:${topic} after \`subscribe()\`.`,
            );
          }
          chan.callbacks.push(cb);
          return chan;
        },
        subscribe() {
          chan.subscribed = true;
          return chan;
        },
      };
      mockState.channels.set(topic, chan);
      return chan;
    },
    async removeChannel(chan: MockChannel) {
      mockState.removedTopics.push(chan.topic);
      // Intentionally simulate async teardown lag: even if the channel is still
      // present during immediate remount, the store must allocate a fresh topic.
      await Promise.resolve();
      mockState.channels.delete(chan.topic);
      return "ok";
    },
  };
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => createStrictSupabaseMock(),
}));

import {
  _resetUnreadNotificationsStoreForTests,
  getUnreadNotificationsSnapshot,
  subscribeUnreadNotifications,
} from "./use-unread-notifications";
import {
  _resetTotalUnreadStoreForTests,
  getTotalUnreadSnapshot,
  subscribeTotalUnread,
} from "./use-total-unread";

describe("shared realtime unread stores", () => {
  beforeEach(() => {
    _resetUnreadNotificationsStoreForTests();
    _resetTotalUnreadStoreForTests();
    mockState.channels.clear();
    mockState.createdTopics = [];
    mockState.removedTopics = [];
    mockState.notificationsCount = 3;
    mockState.conversations = [
      { id: "c1", unread_count: 2 },
      { id: "c2", unread_count: 0 },
      { id: "c3", unread_count: 5 },
    ];
  });

  it("shares a single notifications channel across Sidebar and Header without colliding", async () => {
    const sidebarListener = vi.fn();
    const headerListener = vi.fn();

    // Mounting both Sidebar and Header in the same commit must NOT throw
    // "cannot add `postgres_changes` callbacks ... after `subscribe()`".
    const unsubSidebar = subscribeUnreadNotifications(sidebarListener);
    const unsubHeader = subscribeUnreadNotifications(headerListener);

    expect(mockState.createdTopics).toHaveLength(1);
    const topic = mockState.createdTopics[0];
    expect(topic).toMatch(/^notifications-unread-count:\d+$/);

    // Wait for initial count fetch
    await Promise.resolve();
    await Promise.resolve();
    expect(getUnreadNotificationsSnapshot()).toBe(3);
    expect(sidebarListener).toHaveBeenCalled();
    expect(headerListener).toHaveBeenCalled();

    // Realtime INSERT updates both subscribers
    const channel = mockState.channels.get(topic)!;
    channel.callbacks.forEach((cb) =>
      cb({
        eventType: "INSERT",
        new: { id: "n4", type: "jarvis_alert", read_at: null },
      }),
    );
    expect(getUnreadNotificationsSnapshot()).toBe(4);

    // Unmounting only one consumer keeps the shared channel alive
    unsubHeader();
    expect(mockState.removedTopics).toHaveLength(0);

    // Unmounting the last consumer tears down the channel
    unsubSidebar();
    expect(mockState.removedTopics).toEqual([topic]);

    // Immediate remount before async removeChannel completes allocates a fresh topic
    const unsubRemount = subscribeUnreadNotifications(vi.fn());
    expect(mockState.createdTopics).toHaveLength(2);
    expect(mockState.createdTopics[1]).not.toBe(topic);
    unsubRemount();
  });

  it("shares a single total-unread channel across Sidebar and MobileBottomDock without colliding", async () => {
    const sidebarListener = vi.fn();
    const dockListener = vi.fn();

    const unsubSidebar = subscribeTotalUnread(sidebarListener);
    const unsubDock = subscribeTotalUnread(dockListener);

    expect(mockState.createdTopics).toHaveLength(1);
    const topic = mockState.createdTopics[0];
    expect(topic).toMatch(/^total-unread-realtime:\d+$/);

    await Promise.resolve();
    await Promise.resolve();
    // c1 (2) and c3 (5) have unread messages -> 2 conversations
    expect(getTotalUnreadSnapshot()).toBe(2);

    // Realtime UPDATE marks c2 unread -> 3 conversations
    const channel = mockState.channels.get(topic)!;
    channel.callbacks.forEach((cb) =>
      cb({
        eventType: "UPDATE",
        new: { id: "c2", unread_count: 1 },
      }),
    );
    expect(getTotalUnreadSnapshot()).toBe(3);

    // Unmounting Sidebar keeps MobileBottomDock subscribed
    unsubSidebar();
    expect(mockState.removedTopics).toHaveLength(0);

    // Unmounting MobileBottomDock tears down cleanly, and remounting gets a new topic
    unsubDock();
    expect(mockState.removedTopics).toEqual([topic]);

    const unsubRemount = subscribeTotalUnread(vi.fn());
    expect(mockState.createdTopics).toHaveLength(2);
    expect(mockState.createdTopics[1]).not.toBe(topic);
    unsubRemount();
  });
});
