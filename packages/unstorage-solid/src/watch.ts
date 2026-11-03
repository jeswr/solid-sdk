// AUTHORED-BY Codex GPT-6.1-Sol
import type { NotificationsClient, Subscription } from "@jeswr/pod-notifications";
import type { WatchCallback } from "unstorage";
import { assertWithinBase, urlToKey } from "./keys.js";

/** Legacy internal seam retained for declaration compatibility; SDK owns transports. */
export interface WatchSocket {
  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: "error", listener: (ev: unknown) => void): void;
  addEventListener(type: "close", listener: (ev: unknown) => void): void;
  close(): void;
}
/** Legacy socket construction seam retained for source compatibility. */
export type WatchSocketFactory = (url: string) => WatchSocket;

export interface StartWatchOptions {
  readonly base: string;
  readonly notifications: NotificationsClient;
  readonly callback: WatchCallback;
  readonly onDegrade?: (reason: string) => void;
}
export interface ActiveWatch {
  unwatch: () => void;
}

/** Map normalized invalidations and release subscription listeners on unwatch. */
export async function startWatch(options: StartWatchOptions): Promise<ActiveWatch> {
  let subscription: Subscription | undefined;
  try {
    const active = await options.notifications.subscribe([options.base], {
      depth: "recursive",
    });
    subscription = active;
    let closed = false;
    const off = active.on("change", (change) => {
      if (closed) return;
      try {
        assertWithinBase(options.base, change.object);
        const key = urlToKey(options.base, change.object);
        if (key) {
          const result = options.callback(
            change.type === "Delete" || change.type === "Remove" ? "remove" : "update",
            key,
          );
          void Promise.resolve(result).catch(() => {});
        }
      } catch {
        /* Ignore unsafe hints and isolate consumer callback failures. */
      }
    });
    return {
      unwatch: () => {
        if (closed) return;
        closed = true;
        try {
          off();
        } catch {
          /* Continue cleanup when listener removal fails. */
        }
        void active.close().catch(() => {});
      },
    };
  } catch {
    await subscription?.close().catch(() => {});
    options.onDegrade?.("notification subscription failed");
    return { unwatch: () => {} };
  }
}
