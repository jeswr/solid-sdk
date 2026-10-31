// AUTHORED-BY Codex GPT-6.1-Sol
import type { AuthFetch, PodClient, StorageClient } from "@jeswr/storage-client";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import {
  type Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as sync from "y-protocols/sync";
import { applyUpdate, Doc, encodeStateAsUpdate, encodeStateVector } from "yjs";

const SSD = "https://jeswr.org/ns/solid-sd#";
const PROFILE = `${SSD}y-protocol-v1`;
const MAX_MESSAGE = 64 * 1024 * 1024;

export interface SyncSocketEvents {
  open: unknown;
  message: { data: unknown };
  error: unknown;
  close: unknown;
}

/** Binary browser WebSocket surface; injectable for non-browser runtimes and tests. */
export interface SyncSocket {
  readonly readyState: number;
  binaryType: string;
  send(data: Uint8Array): void;
  close(): void;
  addEventListener<K extends keyof SyncSocketEvents>(
    type: K,
    listener: (event: SyncSocketEvents[K]) => void,
  ): void;
  removeEventListener<K extends keyof SyncSocketEvents>(
    type: K,
    listener: (event: SyncSocketEvents[K]) => void,
  ): void;
}

export interface LiveOptions {
  /** The same pod-auth fetch passed to createPodClient; never defaults to global fetch. */
  fetch?: AuthFetch;
  /** createPodClient's description supplies the service's optional roomTemplate. */
  description?: PodClient["description"];
  socketFactory?: (url: string) => SyncSocket;
  /** Defaults to 1 second. Each attempt obtains a fresh ticket. */
  reconnectDelayMs?: number;
  /** Bounds ticket acquisition and the sync handshake; defaults to 10 seconds. */
  connectTimeoutMs?: number;
}

function checkedUrl(value: string, protocols: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("[y-solid] invalid sync service URL");
  }
  if (!protocols.includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("[y-solid] unsafe sync service URL");
  }
  return url;
}

export function selectLiveService(
  storage: StorageClient,
  container: string,
  options: LiveOptions,
): { endpoint: string; room?: URL } | undefined {
  const feature = storage.features.realtimeCollab;
  if (feature.state !== "available" || !feature.detail.protocols.includes(PROFILE)) return;
  const endpoint = feature.detail.endpoint;
  if (!endpoint || !options.fetch) {
    throw new Error("[y-solid] live mode requires a service endpoint and authenticated fetch");
  }
  const ticketEndpoint = checkedUrl(endpoint, ["https:", "http:"]);
  const service = options.description?.services.find(
    (entry) =>
      entry.endpoint === endpoint &&
      entry.type.includes(`${SSD}CrdtSyncService`) &&
      entry.conformsTo?.includes(PROFILE),
  );
  // RDF descriptions expand extra keys; CID descriptions retain JSON member names.
  const template = service?.extra.roomTemplate ?? service?.extra[`${SSD}roomTemplate`];
  let room: URL | undefined;
  if (template !== undefined) {
    if (typeof template !== "string" || !template.includes("{room}")) {
      throw new Error("[y-solid] invalid sync roomTemplate");
    }
    const expanded = template.replaceAll("{room}", encodeURIComponent(container));
    if (/[{}]/u.test(expanded)) throw new Error("[y-solid] invalid sync roomTemplate");
    room = checkedUrl(expanded, ticketEndpoint.protocol === "https:" ? ["wss:"] : ["ws:", "wss:"]);
  }
  return { endpoint, room };
}

function frame(type: number, write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

async function ticketJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("[y-solid] empty sync ticket response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) throw new Error("[y-solid] oversized sync ticket response");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error("[y-solid] invalid sync ticket response");
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Internal transport. SolidPersistence remains the sole owner of log writes. */
export class LiveTransport {
  connected = false;
  private wanted = false;
  private generation = 0;
  private socket?: SyncSocket;
  private cleanup?: () => void;
  private abort?: AbortController;
  private retry?: ReturnType<typeof setTimeout>;
  private readonly remoteClients = new Set<number>();
  private readonly awarenessHandler: (
    change: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => void;

  constructor(
    private readonly doc: Doc,
    readonly awareness: Awareness,
    private readonly container: string,
    private readonly service: { endpoint: string; room?: URL },
    private readonly options: LiveOptions,
    private readonly callbacks: {
      lost(checkpoint: boolean): void;
      ready(): void;
      prepare(): Promise<void>;
      settled(): Promise<void>;
      error(error: Error): void;
    },
  ) {
    for (const value of [options.reconnectDelayMs ?? 1_000, options.connectTimeoutMs ?? 10_000]) {
      if (!Number.isFinite(value) || value <= 0)
        throw new TypeError("[y-solid] invalid live timing options");
    }
    this.awarenessHandler = (change, origin) => {
      if (origin === this || !this.connected) return;
      this.send(
        frame(1, (encoder) =>
          encoding.writeVarUint8Array(
            encoder,
            encodeAwarenessUpdate(awareness, [
              ...change.added,
              ...change.updated,
              ...change.removed,
            ]),
          ),
        ),
      );
    };
    awareness.on("update", this.awarenessHandler);
  }

  async connect(): Promise<void> {
    this.wanted = true;
    await this.attempt(false);
  }

  private current(generation: number): boolean {
    return this.wanted && this.generation === generation;
  }

  private async attempt(reconnecting: boolean): Promise<void> {
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    const timeout = setTimeout(() => abort.abort(), this.options.connectTimeoutMs ?? 10_000);
    try {
      await Promise.race([
        (async () => {
          if (reconnecting) await this.callbacks.prepare();
          if (!this.current(generation)) return;
          const response = await (this.options.fetch as AuthFetch)(this.service.endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
              "cache-control": "no-store",
            },
            body: JSON.stringify({ room: this.container }),
            redirect: "error",
            signal: abort.signal,
          });
          if (!this.current(generation)) {
            void response.body?.cancel().catch(() => {});
            return;
          }
          if (!response.ok || response.redirected) {
            void response.body?.cancel().catch(() => {});
            throw new Error("[y-solid] sync ticket request failed");
          }
          const ticket = (await ticketJson(response, abort.signal)) as {
            url?: unknown;
            expires?: unknown;
          } | null;
          if (!this.current(generation)) return;
          const expires =
            typeof ticket?.expires === "number"
              ? ticket.expires
              : typeof ticket?.expires === "string"
                ? Date.parse(ticket.expires)
                : Number.NaN;
          if (
            typeof ticket?.url !== "string" ||
            !Number.isFinite(expires) ||
            expires <= Date.now()
          ) {
            throw new Error("[y-solid] invalid or expired sync ticket");
          }
          const endpoint = new URL(this.service.endpoint);
          const url = checkedUrl(
            ticket.url,
            endpoint.protocol === "https:" ? ["wss:"] : ["ws:", "wss:"],
          );
          const expected = this.service.room;
          if (
            expected
              ? url.origin !== expected.origin ||
                url.pathname !== expected.pathname ||
                [...expected.searchParams].some(
                  ([key, value]) => url.searchParams.get(key) !== value,
                )
              : url.host !== endpoint.host
          ) {
            throw new Error("[y-solid] sync ticket does not match the advertised room");
          }
          await this.open(url.href, generation);
        })(),
        new Promise<never>((_, reject) => {
          if (abort.signal.aborted) {
            reject(new Error("[y-solid] sync connection cancelled"));
            return;
          }
          abort.signal.addEventListener(
            "abort",
            () => reject(new Error("[y-solid] sync connection cancelled or timed out")),
            { once: true },
          );
        }),
      ]);
    } catch {
      // Fetch/socket errors can contain ticket-bearing URLs. Report only a fixed message.
      if (this.current(generation))
        this.lose(new Error("[y-solid] live sync unavailable; using log mode"));
    } finally {
      clearTimeout(timeout);
    }
  }

  private open(url: string, generation: number): Promise<void> {
    const factory =
      this.options.socketFactory ??
      ((target: string) => {
        const Socket = (globalThis as unknown as { WebSocket: new (url: string) => SyncSocket })
          .WebSocket;
        return new Socket(target);
      });
    const socket = factory(url);
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    return new Promise<void>((resolve, reject) => {
      let messageTail = Promise.resolve();
      const open = () => {
        if (!this.current(generation)) return;
        try {
          socket.send(frame(0, (encoder) => sync.writeSyncStep1(encoder, this.doc)));
        } catch {
          reject(new Error("[y-solid] socket send failed"));
        }
      };
      const message = ({ data }: { data: unknown }) => {
        messageTail = messageTail
          .then(async () => {
            if (!this.current(generation)) return;
            const step2 = this.receive(data, socket);
            if (step2 && !this.connected) {
              await this.callbacks.settled();
              if (!this.current(generation)) return;
              // Removals retain clock metadata at the relay and other peers.
              // Advance our clock before announcing the same state again.
              this.awareness.setLocalState(this.awareness.getLocalState());
              if (!this.current(generation)) return;
              this.connected = true;
              // State may have changed during the handshake. A full step 2 includes
              // pending dependencies and deletions as well as ordinary local edits.
              socket.send(frame(0, (encoder) => sync.writeSyncStep2(encoder, this.doc)));
              socket.send(
                frame(1, (encoder) =>
                  encoding.writeVarUint8Array(
                    encoder,
                    encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
                  ),
                ),
              );
              this.callbacks.ready();
              resolve();
            }
          })
          .catch(() => {
            if (this.current(generation))
              this.lose(new Error("[y-solid] invalid live sync message"));
            resolve();
          });
      };
      const close = () => {
        if (this.current(generation)) this.lose();
        resolve();
      };
      socket.addEventListener("open", open);
      socket.addEventListener("message", message);
      socket.addEventListener("error", close);
      socket.addEventListener("close", close);
      this.cleanup = () => {
        if (socket.readyState !== 3) {
          // Node ws can emit an asynchronous error when close() cancels a
          // connecting socket. Keep an inert listener until its close event.
          const ignoreError = () => {};
          const closed = () => {
            socket.removeEventListener("error", ignoreError);
            socket.removeEventListener("close", closed);
          };
          socket.addEventListener("error", ignoreError);
          socket.addEventListener("close", closed);
        }
        socket.removeEventListener("open", open);
        socket.removeEventListener("message", message);
        socket.removeEventListener("error", close);
        socket.removeEventListener("close", close);
        resolve();
      };
    });
  }

  private receive(data: unknown, socket: SyncSocket): boolean {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_MESSAGE)
      throw new Error("invalid frame");
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    if (type === 0) {
      const subtype = decoding.readVarUint(decoder);
      const payload = decoding.readVarUint8Array(decoder);
      if (decoding.hasContent(decoder)) throw new Error("trailing sync bytes");
      if (subtype === sync.messageYjsSyncStep1) {
        socket.send(frame(0, (encoder) => sync.writeSyncStep2(encoder, this.doc, payload)));
      } else if (subtype === sync.messageYjsSyncStep2 || subtype === sync.messageYjsUpdate) {
        const scratch = new Doc();
        try {
          applyUpdate(scratch, encodeStateAsUpdate(this.doc));
          applyUpdate(scratch, payload);
          applyUpdate(this.doc, encodeStateAsUpdate(scratch, encodeStateVector(this.doc)), this);
        } finally {
          scratch.destroy();
        }
      } else throw new Error("unknown sync subtype");
      return subtype === sync.messageYjsSyncStep2;
    }
    if (type === 1) {
      const payload = decoding.readVarUint8Array(decoder);
      // Fully decode before applying: malformed trailing states must not partially
      // mutate presence. Track only clients learned through this connection.
      const states = decoding.createDecoder(payload);
      const count = decoding.readVarUint(states);
      const clients: number[] = [];
      for (let i = 0; i < count; i++) {
        clients.push(decoding.readVarUint(states));
        decoding.readVarUint(states);
        JSON.parse(decoding.readVarString(states));
      }
      if (decoding.hasContent(states) || decoding.hasContent(decoder))
        throw new Error("trailing awareness bytes");
      for (const client of clients)
        if (client !== this.doc.clientID) this.remoteClients.add(client);
      applyAwarenessUpdate(this.awareness, payload, this);
    } else if (type === 2) {
      // y-protocols/auth permissionDenied. Never expose its untrusted reason.
      if (decoding.readVarUint(decoder) === 0) throw new Error("sync permission denied");
    } else if (type === 3) {
      socket.send(
        frame(1, (encoder) =>
          encoding.writeVarUint8Array(
            encoder,
            encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]),
          ),
        ),
      );
    } else throw new Error("unknown message type");
    return false;
  }

  private send(bytes: Uint8Array): boolean {
    if (!this.connected) return false;
    if (this.socket?.readyState !== 1) {
      this.lose();
      return false;
    }
    try {
      this.socket.send(bytes);
      return true;
    } catch {
      this.lose(new Error("[y-solid] live sync send failed"));
      return false;
    }
  }

  sendUpdate(update: Uint8Array): boolean {
    return this.send(frame(0, (encoder) => sync.writeUpdate(encoder, update)));
  }

  private lose(error?: Error): void {
    if (!this.wanted) return;
    const checkpoint = this.connected;
    this.release();
    this.callbacks.lost(checkpoint);
    if (error) this.callbacks.error(error);
    if (!this.wanted) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      if (this.wanted) void this.attempt(true);
    }, this.options.reconnectDelayMs ?? 1_000);
  }

  private release(): void {
    this.connected = false;
    this.generation++;
    this.abort?.abort();
    this.cleanup?.();
    this.cleanup = undefined;
    try {
      this.socket?.close();
    } catch {
      /* Already closed. */
    }
    this.socket = undefined;
    const removed = [...this.remoteClients].filter((client) =>
      this.awareness.getStates().has(client),
    );
    removeAwarenessStates(this.awareness, [...this.remoteClients], this);
    // These states disappeared because this connection ended, not because the
    // peer advanced its clock. Accept unchanged peers from the next snapshot.
    // Keep actual remote tombstones so older states cannot resurrect them.
    for (const client of removed) this.awareness.meta.delete(client);
    this.remoteClients.clear();
  }

  disconnect(): void {
    this.wanted = false;
    if (this.retry !== undefined) clearTimeout(this.retry);
    this.retry = undefined;
    if (this.connected) {
      // Null state removes presence without destroying caller-owned Awareness.
      this.send(
        frame(1, (encoder) =>
          encoding.writeVarUint8Array(
            encoder,
            encodeAwarenessUpdate(this.awareness, [this.doc.clientID], new Map()),
          ),
        ),
      );
    }
    this.release();
  }

  destroy(): void {
    this.disconnect();
    this.awareness.off("update", this.awarenessHandler);
  }
}
