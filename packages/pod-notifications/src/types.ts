// AUTHORED-BY Codex GPT-6.1-Sol
import type { StorageClient } from "@jeswr/storage-client";

/** ActivityStreams change verbs supported across Solid and LWS. */
export type ChangeType = "Create" | "Update" | "Delete" | "Move" | "Add" | "Remove";

/** An invalidation hint, never an authoritative resource representation. */
export interface ChangeEvent {
  type: ChangeType;
  object: string;
  objectKind: "container" | "resource" | "unknown";
  target?: string;
  origin?: string;
  published: Date;
  actor?: string;
  state?: string;
  id: string;
  via: "websocket" | "sse" | "webhook-relay" | "poll" | "legacy-ws";
  raw: unknown;
}

/** Topic depth is best effort; Solid containers cover membership only. */
export interface SubscribeOptions {
  depth?: "resource" | "members" | "recursive";
  hot?: readonly string[];
  /** Default 30 seconds; zero disables the polling fallback. */
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

/** Polling and reconnecting subscriptions are degraded. */
export type SubscriptionState = "connecting" | "live" | "degraded" | "closed";

/** Close releases timers, in-flight requests, event listeners and iterator waiters. */
export interface Subscription extends AsyncIterable<ChangeEvent> {
  readonly topics: readonly string[];
  readonly state: SubscriptionState;
  readonly channel: ChangeEvent["via"] | null;
  on(event: "change", handler: (change: ChangeEvent) => void): () => void;
  on(event: "state", handler: (state: SubscriptionState, reason?: string) => void): () => void;
  on(event: "resync", handler: (since: Date) => void): () => void;
  close(): Promise<void>;
}

/** Advertised transport preference; selection does not perform network requests. */
export interface NotificationPlan {
  channel: ChangeEvent["via"] | "none";
  reason: string;
}

/** Storage-scoped change subscriptions. */
export interface NotificationsClient {
  subscribe(topics: readonly string[], options?: SubscribeOptions): Promise<Subscription>;
  plan(): NotificationPlan;
}

/** Injectable one-shot scheduler. Handles are opaque to the notification client. */
export interface Timers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Minimal transport events shared by real and fake sockets/event sources. */
export interface TransportEvents {
  open: unknown;
  message: { data: unknown; lastEventId?: string };
  error: unknown;
  close: unknown;
}

/** Browser-compatible socket surface used by channel implementations. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener<K extends keyof TransportEvents>(
    type: K,
    handler: (event: TransportEvents[K]) => void,
  ): void;
  removeEventListener<K extends keyof TransportEvents>(
    type: K,
    handler: (event: TransportEvents[K]) => void,
  ): void;
}

/** Browser-compatible event source surface; close is always explicit. */
export type EventSourceLike = Omit<WebSocketLike, "send">;

/** All I/O is injected; browser WebSocket and system clocks are the defaults. */
export interface NotificationsDependencies {
  fetch: typeof fetch;
  storage: StorageClient;
  relay?: { url: string };
  socketFactory?: (url: string, protocols?: string[]) => WebSocketLike;
  eventSourceFactory?: (url: string) => EventSourceLike;
  timers?: Timers;
  now?: () => number;
  random?: () => number;
  /** Permit HTTP/WS only when both storage and destination are loopback. Default false. */
  allowInsecureLoopback?: boolean;
}
