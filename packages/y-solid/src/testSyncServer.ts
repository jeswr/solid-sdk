// AUTHORED-BY Codex GPT-6.1-Sol
import type { PodClient, StorageClient } from "@jeswr/storage-client";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";
import type { SyncSocket, SyncSocketEvents } from "./live.js";
import { SolidUpdateStore } from "./store.js";

export const SSD = "https://jeswr.org/ns/solid-sd#";
export const ENDPOINT = "https://pod.example/.sync/tickets";
export const TEMPLATE = "wss://relay.example/sync/{room}";

export function message(type: number, write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

/** In-process socket pair. Both directions carry the actual y-websocket bytes. */
export class FakeSyncSocket implements SyncSocket {
  readyState = 0;
  binaryType = "blob";
  readonly sent: Uint8Array[] = [];
  readonly clients = new Set<number>();
  private readonly listeners = new Map<string, Set<(event: never) => void>>();
  constructor(readonly server: FakeSyncServer) {}
  addEventListener<K extends keyof SyncSocketEvents>(
    type: K,
    listener: (event: SyncSocketEvents[K]) => void,
  ): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as (event: never) => void);
    this.listeners.set(type, set);
  }
  removeEventListener<K extends keyof SyncSocketEvents>(
    type: K,
    listener: (event: SyncSocketEvents[K]) => void,
  ): void {
    this.listeners.get(type)?.delete(listener as (event: never) => void);
  }
  emit<K extends keyof SyncSocketEvents>(type: K, event: SyncSocketEvents[K]): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event as never);
  }
  send(bytes: Uint8Array): void {
    if (this.readyState !== 1) throw new Error("closed socket");
    this.sent.push(bytes.slice());
    queueMicrotask(() => {
      if (this.readyState === 1) this.server.receive(this, bytes);
    });
  }
  deliver(bytes: Uint8Array): void {
    queueMicrotask(() => {
      if (this.readyState === 1) this.emit("message", { data: bytes.slice().buffer });
    });
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.server.closed(this);
    this.emit("close", {});
  }
  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

/** A persistence-authoritative relay, interoperating through y-protocols. */
export class FakeSyncServer {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  readonly sockets: FakeSyncSocket[] = [];
  readonly opened: string[] = [];
  readonly requests: { url: string; init?: RequestInit }[] = [];
  readonly description: PodClient["description"];
  readonly storage: StorageClient;
  readonly store: SolidUpdateStore;
  online = true;
  handshake = true;
  writes: Promise<unknown> = Promise.resolve();
  private readonly tickets = new Set<string>();

  constructor(
    storage: StorageClient,
    readonly container: string,
  ) {
    this.storage = {
      ...storage,
      features: {
        ...storage.features,
        realtimeCollab: {
          state: "available",
          evidence: "test-service",
          detail: { endpoint: ENDPOINT, protocols: [`${SSD}y-protocol-v1`] },
        },
      },
    };
    this.store = new SolidUpdateStore({ storage, container });
    this.description = {
      protocol: storage.protocol,
      id: storage.root,
      root: storage.root,
      descriptionUrl: null,
      services: [
        {
          type: [`${SSD}CrdtSyncService`],
          endpoint: ENDPOINT,
          conformsTo: [`${SSD}y-protocol-v1`],
          extra: { roomTemplate: TEMPLATE },
        },
      ],
      capabilities: [],
      sources: ["solid-description"],
      fetchedAt: Date.now(),
      etag: null,
      maxAgeMs: 1_000,
      verificationMethods: [],
    };
    this.awareness.setLocalState(null);
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "hydrate") return;
      this.writes = this.writes.then(() => this.store.appendUpdate(update));
      const bytes = message(0, (encoder) => sync.writeUpdate(encoder, update));
      for (const socket of this.sockets) if (socket !== origin) socket.deliver(bytes);
    });
    this.awareness.on(
      "update",
      (change: { added: number[]; updated: number[]; removed: number[] }) => {
        const clients = [...change.added, ...change.updated, ...change.removed];
        const bytes = message(1, (encoder) =>
          encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(this.awareness, clients)),
        );
        for (const socket of this.sockets) socket.deliver(bytes);
      },
    );
  }

  readonly fetch: typeof fetch = async (input, init) => {
    this.requests.push({ url: String(input), init });
    if (!this.online) throw new Error("offline");
    const room = JSON.parse(String(init?.body)).room;
    if (room !== this.container) return new Response(null, { status: 403 });
    const url = `${TEMPLATE.replace("{room}", encodeURIComponent(room))}?ticket=test-${this.requests.length}`;
    this.tickets.add(url);
    return Response.json({ url, expires: Date.now() + 60_000 });
  };

  readonly socketFactory = (url: string): FakeSyncSocket => {
    if (!this.tickets.delete(url)) throw new Error("invalid ticket");
    this.opened.push(url);
    const socket = new FakeSyncSocket(this);
    this.sockets.push(socket);
    void (async () => {
      for (const record of await this.store.loadUpdates())
        Y.applyUpdate(this.doc, record.update, "hydrate");
      if (socket.readyState === 3) return;
      socket.readyState = 1;
      socket.emit("open", {});
      if (this.handshake)
        socket.deliver(message(0, (encoder) => sync.writeSyncStep1(encoder, this.doc)));
      socket.deliver(
        message(1, (encoder) =>
          encoding.writeVarUint8Array(
            encoder,
            encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]),
          ),
        ),
      );
    })();
    return socket;
  };

  receive(socket: FakeSyncSocket, bytes: Uint8Array): void {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    if (type === 0 && this.handshake) {
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, 0);
      sync.readSyncMessage(decoder, reply, this.doc, socket);
      if (encoding.length(reply) > 1) socket.deliver(encoding.toUint8Array(reply));
    } else if (type === 1) {
      const payload = decoding.readVarUint8Array(decoder);
      const states = decoding.createDecoder(payload);
      const count = decoding.readVarUint(states);
      for (let i = 0; i < count; i++) {
        socket.clients.add(decoding.readVarUint(states));
        decoding.readVarUint(states);
        decoding.readVarString(states);
      }
      applyAwarenessUpdate(this.awareness, payload, socket);
    }
  }

  closed(socket: FakeSyncSocket): void {
    removeAwarenessStates(this.awareness, [...socket.clients], socket);
  }
  drop(): void {
    this.online = false;
    for (const socket of this.sockets) socket.close();
  }
  destroy(): void {
    for (const socket of this.sockets) socket.close();
    this.awareness.destroy();
    this.doc.destroy();
  }
}
