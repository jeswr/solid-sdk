// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import type { StorageClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createOutbox, type Outbox } from "@jeswr/suite-sdk/offline";
import { afterEach, beforeEach, vi } from "vitest";
import type { Message } from "../src/apps/chat/lib/client";
import { messageSubject } from "../src/apps/chat/lib/model";
import {
  CHAT_OUTBOX_NAMESPACE,
  ChatOutbox,
  type ChatOutboxConnection,
} from "../src/apps/chat/state/outbox";

const { IDBFactory } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };
export const webId = "https://alice.example/profile#me";
export const storageUrl = "https://alice.example/";
export const room = "https://alice.example/chat/rooms/a/";
export let idb: IDBFactory;
const stops: (() => void)[] = [];
export const boxes: Outbox[] = [];
beforeEach(() => {
  idb = new IDBFactory();
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const box of boxes.splice(0)) box.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
export function result(
  target: string,
  draft: string,
  input: { id?: string; at?: Date } = {},
): Message {
  return {
    id: messageSubject(target, input.at!, input.id!),
    content: draft,
    author: webId,
    mediaType: "text/plain",
    updated: undefined,
    tombstone: false,
    deleted: false,
    edited: false,
    reactions: [],
  };
}
export const sender = () => vi.fn(async (...args: Parameters<typeof result>) => result(...args));
export interface BoxOptions {
  /** Replace the queue factory (for example, one that throws or cannot open). */
  open?: (identity: string) => ChatOutboxConnection;
  /** Wrap the pod client factory (for example, to count or fail discovery). */
  storage?: () => Promise<StorageClient>;
  /** Called with each SDK instance before Chat registers on it. */
  onOpen?: (sdk: Outbox) => void;
}
export function box(
  send = sender(),
  online = () => false,
  identity = webId,
  options: BoxOptions = {},
) {
  let sdk!: Outbox;
  const queue = new ChatOutbox({ webId: identity, send, storageUrl }, online, () => {
    if (options.open) return options.open(identity);
    sdk = createOutbox({ webId: identity, idb, namespace: CHAT_OUTBOX_NAMESPACE });
    boxes.push(sdk);
    options.onOpen?.(sdk);
    return {
      outbox: sdk,
      storage:
        options.storage ??
        (async () => createMemoryStorage({ root: storageUrl, protocol: "solid" })),
    };
  });
  const close = queue.connect();
  stops.push(close);
  return {
    queue,
    close,
    send,
    get sdk() {
      return sdk;
    },
  };
}
/** A localStorage stub with key enumeration, for legacy-queue imports. */
export function stubLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  return data;
}
export async function reopen(identity = webId) {
  const sdk = createOutbox({ webId: identity, idb, namespace: CHAT_OUTBOX_NAMESPACE });
  boxes.push(sdk);
  await sdk.ready;
  return sdk;
}
