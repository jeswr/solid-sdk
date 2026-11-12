// AUTHORED-BY Codex GPT-6.1-Sol
import type {
  GuardPolicy,
  Outbox,
  OutboxItem,
  QueueingStorageClient,
  QueueingWriteResult,
  ReplayDelegate,
} from "@jeswr/solid-offline/outbox";
import type { StorageClient } from "@jeswr/storage-client";

export interface IntentContext {
  fetch: typeof globalThis.fetch;
  webId: string;
  storage: StorageClient;
  signal: AbortSignal;
}
export interface IntentSession {
  registerReplayDelegate(
    tag: string,
    factory: (session: IntentContext) => ReplayDelegate,
  ): () => void;
  registerGuardPolicy(tag: string, matches: GuardPolicy): () => void;
}
type PendingState = Pick<OutboxItem, "id" | "status" | "blocked" | "error">;
/** An invalid persisted body has an error and no decoded intent. */
export type PendingIntent<T> = PendingState & ({ intent: T } | { intent?: never; error: string });
export interface IntentChannel<T> {
  readonly tag: string;
  /** Validate before storing anything, then deliver now or queue on network failure. */
  submit(storage: QueueingStorageClient, intent: T): Promise<QueueingWriteResult>;
  /** Persist without an online attempt, for intents ordered behind retained work. */
  enqueue(outbox: Outbox, intent: T): Promise<void>;
  pending(outbox: Outbox): Promise<Array<PendingIntent<T>>>;
  /** Install for one shell session after its storage opens. Cleanup is idempotent. */
  register(session: IntentSession): () => void;
}

/** JSON domain policy over the shared durable outbox; no raw delivery of intent bytes. */
export function createIntentChannel<T>(options: {
  tag: string;
  destination(intent: T): string;
  matches(url: string): boolean;
  decode(value: unknown): T;
  deliver(intent: T, ctx: IntentContext): Promise<void>;
  maxBytes?: number;
}): IntentChannel<T> {
  const { tag, destination, matches, decode, deliver, maxBytes = 64 * 1024 } = options;
  if (typeof tag !== "string" || !/^[a-z][a-z0-9.-]{0,63}$/.test(tag))
    throw new TypeError("Invalid intent channel tag");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new TypeError("Invalid intent byte limit");
  const encoder = new TextEncoder();
  const invalid = () => new TypeError("Invalid intent body");
  function read(body: Uint8Array | null): T {
    if (!body || body.byteLength > maxBytes) throw invalid();
    try {
      return decode(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
    } catch {
      // JSON and domain decoder errors can contain private body bytes.
      throw invalid();
    }
  }
  function target(intent: T): string {
    try {
      const url = destination(intent);
      if (!matches(url)) throw invalid();
      return url;
    } catch {
      throw new TypeError("Invalid intent destination");
    }
  }
  function prepare(intent: T) {
    let body: Uint8Array;
    let validated: T;
    try {
      const json = JSON.stringify(intent);
      validated = decode(JSON.parse(json));
      body = encoder.encode(json);
      if (body.byteLength > maxBytes) throw invalid();
    } catch {
      throw invalid();
    }
    return { url: target(validated), body, contentType: "application/json", guard: { tag } };
  }
  return {
    tag,
    async submit(storage, intent) {
      const { url, body, ...options } = prepare(intent);
      return storage.write(url, body, {
        ...options,
        // The delegate obtains the actual domain validator.
        ifMatch: "*",
        offline: "queue",
      });
    },
    async enqueue(outbox, intent) {
      await outbox.enqueue({ op: "write", ...prepare(intent) });
    },
    async pending(outbox) {
      await outbox.ready;
      const result: Array<PendingIntent<T>> = [];
      for (const item of outbox.pending()) {
        if (item.guard?.tag !== tag) continue;
        const { id, status, blocked, error } = item;
        try {
          if (item.op !== "write" || item.contentType !== "application/json") throw invalid();
          const intent = read(await outbox.localBody(id));
          if (target(intent) !== item.url) throw invalid();
          result.push({ id, intent, status, blocked, error });
        } catch {
          result.push({ id, status, blocked, error: "Invalid pending intent" });
        }
      }
      return result;
    },
    register(session) {
      // Named creates can also PUT to a matching resource. Protect the destination
      // for every mutation; the delegate then permits only intent writes.
      const stopPolicy = session.registerGuardPolicy(tag, ({ url }) => matches(url));
      let stopDelegate: () => void;
      try {
        stopDelegate = session.registerReplayDelegate(tag, (context) => async (delivery, ctx) => {
          if (delivery.op !== "write" || delivery.contentType !== "application/json")
            throw invalid();
          const intent = read(delivery.body);
          if (target(intent) !== delivery.url) throw new TypeError("Intent destination mismatch");
          const signal = AbortSignal.any([context.signal, ctx.signal]);
          signal.throwIfAborted();
          await deliver(intent, {
            fetch: context.fetch,
            webId: context.webId,
            storage: ctx.storage,
            signal,
          });
        });
      } catch (error) {
        stopPolicy();
        throw error;
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        stopDelegate();
        stopPolicy();
      };
    },
  };
}
