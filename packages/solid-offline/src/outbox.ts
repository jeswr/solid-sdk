// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type Body,
  type CreateOptions,
  type StorageClient,
  StorageError,
  type WriteOptions,
  type WriteResult,
} from '@jeswr/storage-client';
import { DataFactory, Writer } from 'n3';

export interface OutboxItem {
  id: string;
  op: 'write' | 'create' | 'delete';
  url: string;
  container?: string;
  name?: string;
  contentType?: string;
  size: number;
  label?: string;
  createdAt: number;
  status: 'waiting' | 'replaying' | 'failed' | 'conflict';
  error?: string;
}

export interface ConflictRecord {
  id: string;
  itemId: string;
  url: string;
  kind: 'rdf' | 'binary';
  localEtag: string | null;
  remoteEtag: string | null;
  contentType: string;
}

/** Persistable input. Signals and credentials are never stored. */
export interface OutboxOperation {
  op: OutboxItem['op'];
  url: string;
  body?: Body | null;
  contentType?: string;
  ifMatch?: string;
  container?: string;
  name?: string;
  label?: string;
  createOptions?: Omit<CreateOptions, 'signal'>;
  deleteOptions?: { recursive?: boolean };
}

export interface ReplayOptions {
  /** Per-item byte progress, at start (0) and successful completion (size). */
  onProgress?: (sent: number, total: number) => void;
  /** Stops before the next item and cancels the active request. */
  signal?: AbortSignal;
}

export interface Outbox {
  readonly webId: string;
  /** Await hydration before reading the initial synchronous snapshots. */
  readonly ready: Promise<void>;
  pending(): OutboxItem[];
  conflicts(): ConflictRecord[];
  /** Durable enqueue; normally called by withOutbox. */
  enqueue(operation: OutboxOperation): Promise<OutboxItem>;
  /** Accepts a conflict ID or an item ID; returns a defensive copy. */
  localBody(id: string): Promise<Uint8Array | null>;
  replay(client: StorageClient, options?: ReplayOptions): Promise<void>;
  /** Uses the client supplied to withOutbox or the most recent replay. */
  retry(id?: string): Promise<void>;
  resolve(id: string, strategy: 'mine' | 'theirs' | 'both'): Promise<void>;
  on(event: 'change' | 'conflict', listener: () => void): () => void;
  /** Deletes only this WebID's queue. Logout deliberately does not call this. */
  purge(): Promise<void>;
  /** Releases listeners; persisted changes survive. */
  close(): void;
}

type QueueOption = { offline?: 'queue' };
type RdfOptions = Parameters<StorageClient['writeRdf']>[2];
type DeleteOptions = NonNullable<Parameters<StorageClient['delete']>[1]>;
export type QueueingWriteResult = WriteResult & { queued?: true };
export interface QueueingStorageClient extends StorageClient {
  write(url: string, body: Body, opts: WriteOptions & QueueOption): Promise<QueueingWriteResult>;
  writeRdf(
    url: string,
    dataset: Parameters<StorageClient['writeRdf']>[1],
    opts: RdfOptions & QueueOption,
  ): Promise<QueueingWriteResult>;
  create(
    container: string,
    body: Body | null,
    opts?: CreateOptions & QueueOption,
  ): Promise<QueueingWriteResult>;
  delete(url: string, opts?: DeleteOptions & QueueOption): Promise<void>;
}

interface StoredItem {
  order?: number;
  item: OutboxItem;
  body: Uint8Array | null;
  ifMatch?: string;
  createOptions?: OutboxOperation['createOptions'];
  deleteOptions?: OutboxOperation['deleteOptions'];
  conflict?: ConflictRecord;
}

const clients = new WeakMap<Outbox, StorageClient>();
const underlying = new WeakMap<StorageClient, StorageClient>();
// Also serialize instances in the same realm, including tests without Web Locks.
const queues = new WeakMap<IDBFactory, Map<string, Promise<unknown>>>();
const encoder = new TextEncoder();
const isRdf = (type: string) =>
  /^(text\/turtle|text\/n3|application\/(ld\+json|rdf\+xml|n-triples|n-quads|trig))(?:\s*;|$)/i.test(
    type,
  );
const networkFailure = (error: unknown) =>
  (error instanceof StorageError && error.code === 'network') ||
  (error instanceof TypeError && /fetch|network/i.test(error.message));

/** Rebuild from public RDF/JS fields; never trust private N3 ids or term methods. */
async function serializeRdf(
  dataset: Parameters<StorageClient['writeRdf']>[1],
  contentType: NonNullable<RdfOptions['contentType']>,
): Promise<string> {
  const quads = [...dataset];
  type Term = (typeof quads)[number]['object'];
  const labels = new Map<string, string>();
  const iri = (value: string) => {
    if (
      typeof value !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) ||
      [...value].some(
        (c) =>
          (c.codePointAt(0) ?? 0) <= 32 ||
          '<>"{}|^`\\'.includes(c) ||
          ((c.codePointAt(0) ?? 0) >= 0xd800 && (c.codePointAt(0) ?? 0) <= 0xdfff),
      )
    ) {
      throw new TypeError('[solid-offline] queued RDF requires safe absolute IRIs');
    }
    return DataFactory.namedNode(value);
  };
  const node = (term: Term) => {
    if (term.termType === 'NamedNode') return iri(term.value);
    if (term.termType !== 'BlankNode' || typeof term.value !== 'string') {
      throw new TypeError('[solid-offline] invalid queued RDF node');
    }
    let label = labels.get(term.value);
    if (label === undefined) {
      label = `b${labels.size}`;
      labels.set(term.value, label);
    }
    return DataFactory.blankNode(label);
  };
  const safe = quads.map((q) => {
    if (contentType === 'text/turtle' && q.graph.termType !== 'DefaultGraph') {
      throw new TypeError('[solid-offline] queued Turtle writes require the default graph');
    }
    if (q.predicate.termType !== 'NamedNode')
      throw new TypeError('[solid-offline] invalid queued RDF predicate');
    const subject = node(q.subject);
    let object: ReturnType<typeof node> | ReturnType<typeof DataFactory.literal>;
    if (q.object.termType === 'Literal') {
      const { value, language, datatype } = q.object;
      // N3's direction getter may misread "--" in datatype IRIs with no language.
      const direction = language && (q.object as Term & { direction?: string }).direction;
      if (
        typeof value !== 'string' ||
        typeof language !== 'string' ||
        datatype.termType !== 'NamedNode' ||
        (language && !/^[A-Za-z]+(?:-[A-Za-z0-9]+)*$/.test(language)) ||
        direction ||
        Boolean(language) !==
          (datatype.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString')
      ) {
        throw new TypeError('[solid-offline] invalid queued RDF literal');
      }
      object = DataFactory.literal(value, language || iri(datatype.value));
    } else object = node(q.object);
    const graph = q.graph.termType === 'DefaultGraph' ? DataFactory.defaultGraph() : node(q.graph);
    return DataFactory.quad(subject, iri(q.predicate.value), object, graph);
  });
  if (contentType === 'application/ld+json') {
    // Expanded, context-free JSON-LD built only from validated RDF/JS terms.
    const id = (term: Pick<Term, 'termType' | 'value'>) =>
      term.termType === 'BlankNode' ? `_:${term.value}` : term.value;
    type JsonSubject = Record<string, string | unknown[]>;
    const graphs = new Map<string, Map<string, JsonSubject>>();
    for (const q of safe) {
      const graphId = q.graph.termType === 'DefaultGraph' ? '' : id(q.graph);
      let subjects = graphs.get(graphId);
      if (!subjects) {
        subjects = new Map();
        graphs.set(graphId, subjects);
      }
      const subjectId = id(q.subject);
      let subject = subjects.get(subjectId);
      if (!subject) {
        subject = { '@id': subjectId };
        subjects.set(subjectId, subject);
      }
      const values = subject[q.predicate.value];
      const value =
        q.object.termType === 'Literal'
          ? {
              '@value': q.object.value,
              ...(q.object.language
                ? { '@language': q.object.language }
                : { '@type': q.object.datatype.value }),
            }
          : { '@id': id(q.object) };
      if (Array.isArray(values)) values.push(value);
      else subject[q.predicate.value] = [value];
    }
    return JSON.stringify(
      [...graphs].flatMap(([graph, subjects]) =>
        graph ? [{ '@id': graph, '@graph': [...subjects.values()] }] : [...subjects.values()],
      ),
    );
  }
  // Prefixes affect presentation only; omit them to avoid ambiguous/unsafe prefix mappings.
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: 'Turtle' });
    writer.addQuads(safe);
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}

async function bytes(body: Body | null | undefined): Promise<Uint8Array | null> {
  if (body == null) return null;
  if (typeof body === 'string') return encoder.encode(body);
  if (body instanceof Uint8Array) return body.slice();
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  return new Uint8Array(await new Response(body).arrayBuffer());
}

function childUrl(container: string, name: string): string {
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    [...name].some(
      (c) => c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159),
    )
  ) {
    throw new Error('[solid-offline] invalid create name');
  }
  return new URL(encodeURIComponent(name), container.endsWith('/') ? container : `${container}/`)
    .href;
}

/** A separate DB from read metadata: logout may purge the cache, never unsent writes. */
export function createOutbox(options: {
  webId: string;
  idb?: IDBFactory;
  now?: () => number;
}): Outbox {
  if (!options.webId) throw new Error('[solid-offline] outbox requires a WebID');
  const factory = options.idb ?? globalThis.indexedDB;
  if (!factory) throw new Error('[solid-offline] outbox requires IndexedDB');
  const now = options.now ?? Date.now;
  // Full identity avoids the collision risk of the read-cache's short hash.
  const dbName = `solid-offline-outbox:${encodeURIComponent(options.webId)}`;
  const listeners = { change: new Set<() => void>(), conflict: new Set<() => void>() };
  let records: StoredItem[] = [];
  let closed = false;
  const channel =
    typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(dbName);
  // Node's BroadcastChannel should not keep tooling/SSR processes alive.
  (channel as (BroadcastChannel & { unref?: () => void }) | undefined)?.unref?.();

  async function transaction<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('items', { keyPath: 'order', autoIncrement: true });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction('items', mode);
        const request = run(tx.objectStore('items'));
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = tx.onerror = () => reject(tx.error ?? request.error);
      });
    } finally {
      db.close();
    }
  }

  async function refresh(): Promise<void> {
    records = await transaction<StoredItem[]>('readonly', (store) => store.getAll());
    records.sort((a, b) => a.item.createdAt - b.item.createdAt || (a.order ?? 0) - (b.order ?? 0));
  }

  function emit(event: 'change' | 'conflict'): void {
    if (closed) return;
    for (const listener of listeners[event]) {
      try {
        listener();
      } catch {
        /* UI observers cannot corrupt queue state. */
      }
    }
  }

  function notify(event: 'change' | 'conflict' = 'change'): void {
    if (closed) return;
    emit('change');
    if (event === 'conflict') emit('conflict');
    try {
      channel?.postMessage({ event });
    } catch {
      /* Persistence is already committed. */
    }
  }

  const ready = refresh().then(() => emit('change'));
  // Still expose rejection through ready, without an unhandled rejection on construction.
  void ready.catch(() => undefined);
  channel?.addEventListener('message', (message: MessageEvent) => {
    if (message.data?.event !== 'change' && message.data?.event !== 'conflict') return;
    void refresh()
      .then(() => {
        emit('change');
        if (message.data.event === 'conflict') emit('conflict');
      })
      .catch(() => undefined);
  });

  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    let scoped = queues.get(factory);
    if (!scoped) {
      scoped = new Map();
      queues.set(factory, scoped);
    }
    const previous = scoped.get(dbName) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await ready;
        if (closed) throw new Error('[solid-offline] outbox is closed');
        const run = async () => {
          await refresh();
          return task();
        };
        return typeof navigator !== 'undefined' && navigator.locks
          ? navigator.locks.request(dbName, run)
          : run();
      });
    scoped.set(dbName, next);
    return next;
  }

  async function save(record: StoredItem): Promise<void> {
    record.order = Number(await transaction('readwrite', (store) => store.put(record)));
    await refresh();
    notify(record.conflict ? 'conflict' : 'change');
  }

  async function drop(record: StoredItem): Promise<void> {
    await transaction('readwrite', (store) => store.delete(record.order as number));
    await refresh();
    notify();
  }

  function client(): StorageClient {
    const storage = clients.get(outbox);
    if (!storage) throw new Error('[solid-offline] call withOutbox or replay before retry/resolve');
    return storage;
  }

  async function send(
    record: StoredItem,
    storage: StorageClient,
    signal?: AbortSignal,
  ): Promise<void> {
    const { item } = record;
    if (item.op === 'delete') {
      await storage.delete(item.url, { ...record.deleteOptions, ifMatch: record.ifMatch, signal });
    } else if (item.op === 'create') {
      await storage.create(item.container as string, record.body, {
        ...record.createOptions,
        signal,
      });
    } else {
      await storage.write(item.url, record.body ?? new Uint8Array(), {
        contentType: item.contentType as string,
        ifMatch: record.ifMatch as string,
        signal,
      });
    }
  }

  async function replay(storage: StorageClient, opts: ReplayOptions = {}): Promise<void> {
    const progress = (sent: number, total: number) => {
      try {
        opts.onProgress?.(sent, total);
      } catch {
        /* Observers cannot interrupt persistence. */
      }
    };
    const blocked = new Set(records.filter((r) => r.conflict).map((r) => r.item.url));
    for (const record of [...records]) {
      if (closed || opts.signal?.aborted) break;
      if (!['waiting', 'replaying'].includes(record.item.status) || blocked.has(record.item.url))
        continue;
      record.item.status = 'replaying';
      await save(record);
      progress(0, record.item.size);
      try {
        await send(record, storage, opts.signal);
      } catch (error) {
        if (networkFailure(error) || opts.signal?.aborted) {
          record.item.status = 'waiting';
          await save(record);
          break;
        }
        if (
          error instanceof StorageError &&
          (error.status === 412 || error.code === 'precondition-failed')
        ) {
          record.item.status = 'conflict';
          record.conflict = {
            id: crypto.randomUUID(),
            itemId: record.item.id,
            url: record.item.url,
            kind: isRdf(record.item.contentType ?? '') ? 'rdf' : 'binary',
            localEtag: record.ifMatch ?? null,
            remoteEtag: error.etag,
            contentType: record.item.contentType ?? 'application/octet-stream',
          };
          blocked.add(record.item.url);
        } else {
          record.item.status = 'failed';
          record.item.error = error instanceof Error ? error.message : String(error);
        }
        await save(record);
        continue;
      }
      await drop(record);
      progress(record.item.size, record.item.size);
    }
  }

  const outbox: Outbox = {
    webId: options.webId,
    ready,
    pending: () => records.map((r) => ({ ...r.item })),
    conflicts: () => records.flatMap((r) => (r.conflict ? [{ ...r.conflict }] : [])),
    async enqueue(operation) {
      // Snapshot mutable/stream bodies before waiting for the database lock.
      const body = await bytes(operation.body);
      return exclusive(async () => {
        const item: OutboxItem = {
          id: crypto.randomUUID(),
          op: operation.op,
          url: operation.url,
          container: operation.container,
          name: operation.name,
          contentType: operation.contentType,
          label: operation.label,
          size: body?.byteLength ?? 0,
          createdAt: now(),
          status: 'waiting',
        };
        await save({
          item,
          body,
          ifMatch: operation.ifMatch,
          createOptions: operation.createOptions,
          deleteOptions: operation.deleteOptions,
        });
        return { ...item };
      });
    },
    async localBody(id) {
      await ready;
      await refresh();
      return records.find((r) => r.item.id === id || r.conflict?.id === id)?.body?.slice() ?? null;
    },
    replay(storage, opts) {
      const raw = underlying.get(storage) ?? storage;
      clients.set(outbox, raw);
      return exclusive(() => replay(raw, opts));
    },
    retry(id) {
      return exclusive(async () => {
        const storage = client();
        for (const record of [...records]) {
          if (record.item.status !== 'failed' || (id !== undefined && record.item.id !== id))
            continue;
          record.item.status = 'waiting';
          delete record.item.error;
          await save(record);
        }
        await replay(storage);
      });
    },
    resolve(id, strategy) {
      return exclusive(async () => {
        const record = records.find((r) => r.conflict?.id === id);
        if (!record) throw new Error('[solid-offline] conflict not found');
        const { item } = record;
        if (strategy === 'theirs') {
          await drop(record);
          return;
        }
        const storage = client();
        if (strategy === 'mine') {
          const head = await storage.head(item.url, { revalidate: true });
          if (!head.etag)
            throw new Error('[solid-offline] cannot overwrite without a current ETag');
          if (item.op === 'delete') {
            await storage.delete(item.url, { ...record.deleteOptions, ifMatch: head.etag });
          } else {
            await storage.write(item.url, record.body ?? new Uint8Array(), {
              contentType: item.contentType ?? 'application/octet-stream',
              ifMatch: head.etag,
            });
          }
        } else if (strategy === 'both') {
          if (item.op === 'delete')
            throw new Error('[solid-offline] keep both is unavailable for deletes');
          const container = item.container ?? (await storage.parentOf(item.url));
          if (!container) throw new Error('[solid-offline] conflict has no parent container');
          const original =
            item.name ??
            decodeURIComponent(new URL(item.url).pathname.split('/').pop() ?? 'resource');
          const dot = original.lastIndexOf('.');
          const stem = dot > 0 ? original.slice(0, dot) : original;
          const ext = dot > 0 ? original.slice(dot) : '';
          const name = `${stem}${record.conflict?.kind === 'rdf' ? ' (copy)' : `-conflict-${now()}`}${ext}`;
          // StorageClient.create's named Solid PUT uses If-None-Match: *.
          await storage.create(container, record.body, {
            ...record.createOptions,
            name,
            contentType: item.contentType,
          });
        } else {
          throw new Error('[solid-offline] invalid conflict strategy');
        }
        await drop(record);
      });
    },
    on(event, listener) {
      listeners[event].add(listener);
      return () => {
        listeners[event].delete(listener);
      };
    },
    purge() {
      return exclusive(async () => {
        await transaction('readwrite', (store) => store.clear());
        await refresh();
        notify();
      });
    },
    close() {
      closed = true;
      channel?.close();
      listeners.change.clear();
      listeners.conflict.clear();
    },
  };
  return outbox;
}

/** Opt-in only. Patch/move and every read keep the wrapped client's behavior. */
export function withOutbox(client: StorageClient, outbox: Outbox): QueueingStorageClient {
  const raw = underlying.get(client) ?? client;
  clients.set(outbox, raw);

  async function attempt(
    operation: OutboxOperation,
    send: (body: Uint8Array | null) => Promise<WriteResult> | Promise<void>,
    signal?: AbortSignal,
  ): Promise<QueueingWriteResult> {
    signal?.throwIfAborted();
    if (!raw.isWithinStorage(operation.container ?? operation.url)) {
      throw new StorageError('scope', { url: operation.url, method: operation.op.toUpperCase() });
    }
    const body = await bytes(operation.body);
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!offline) {
      try {
        const result = await send(body);
        return result ?? { url: operation.url, etag: null, created: false };
      } catch (error) {
        if (signal?.aborted || !networkFailure(error)) throw error;
      }
    }
    signal?.throwIfAborted();
    await outbox.enqueue({ ...operation, body });
    return { url: operation.url, etag: null, created: false, queued: true };
  }

  const overrides: Pick<QueueingStorageClient, 'write' | 'writeRdf' | 'create' | 'delete'> = {
    write(url, body, opts) {
      if (opts.offline !== 'queue') return client.write(url, body, opts);
      const { offline: _offline, ...writeOpts } = opts;
      return attempt(
        { op: 'write', url, body, contentType: opts.contentType, ifMatch: opts.ifMatch },
        (copy) => raw.write(url, copy ?? new Uint8Array(), writeOpts),
        opts.signal,
      );
    },
    async writeRdf(url, dataset, opts) {
      if (opts.offline !== 'queue') return client.writeRdf(url, dataset, opts);
      const quads = [...dataset];
      const contentType = opts.contentType ?? 'text/turtle';
      const body = await serializeRdf(quads, contentType);
      const { offline: _offline, ...rdfOpts } = opts;
      return attempt(
        { op: 'write', url, body, contentType, ifMatch: opts.ifMatch },
        () => raw.writeRdf(url, quads, rdfOpts),
        opts.signal,
      );
    },
    async create(container, body, opts) {
      if (opts?.offline !== 'queue') return client.create(container, body, opts);
      const { offline: _offline, signal, ...createOpts } = opts;
      const name = opts.name ?? `offline-${crypto.randomUUID()}`;
      const url = `${childUrl(container, name)}${opts.kind === 'container' ? '/' : ''}`;
      return attempt(
        {
          op: 'create',
          url,
          container,
          name,
          body,
          contentType: opts.contentType,
          createOptions: { ...createOpts, name },
        },
        (copy) => raw.create(container, copy, { ...createOpts, name, signal }),
        signal,
      );
    },
    async delete(url, opts) {
      if (opts?.offline !== 'queue') return client.delete(url, opts);
      const { offline: _offline, ...deleteOpts } = opts;
      await attempt(
        { op: 'delete', url, ifMatch: opts.ifMatch, deleteOptions: { recursive: opts.recursive } },
        () => raw.delete(url, deleteOpts),
        opts.signal,
      );
    },
  };
  // A proxy preserves class/prototype methods, getters and their original receiver.
  const decorated = new Proxy(client, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property as keyof typeof overrides];
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as QueueingStorageClient;
  underlying.set(decorated, raw);
  return decorated;
}
