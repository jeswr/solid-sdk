// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  type Body,
  type CreateOptions,
  type StorageClient,
  StorageError,
  type WriteOptions,
  type WriteResult,
} from '@jeswr/storage-client';
import { DataFactory, Writer } from 'n3';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Persisted application policy; assertions are visible only to delivery delegates. */
export interface OutboxGuard {
  tag: string;
  assertions?: JsonValue;
}

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
  readonly guard?: { readonly tag: string };
  readonly blocked?: 'no-delegate' | 'guard-required';
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
  keepalive?: boolean;
  container?: string;
  name?: string;
  label?: string;
  createOptions?: Omit<CreateOptions, 'signal'>;
  deleteOptions?: { recursive?: boolean };
  guard?: OutboxGuard;
}

/** A defensive snapshot of the actual request, including conflict-resolution changes. */
export interface GuardedDelivery {
  op: OutboxOperation['op'];
  url: string;
  container?: string;
  name?: string;
  contentType?: string;
  body: Uint8Array | null;
  ifMatch?: string;
  keepalive?: boolean;
  createOptions?: OutboxOperation['createOptions'];
  deleteOptions?: OutboxOperation['deleteOptions'];
  assertions?: JsonValue;
  purpose: 'replay' | 'resolve-mine' | 'resolve-both';
}

export type ReplayDelegate = (
  delivery: GuardedDelivery,
  ctx: { storage: StorageClient; signal: AbortSignal },
  // biome-ignore lint/suspicious/noConfusingVoidType: Delegates may intentionally return no result.
) => Promise<WriteResult | void>;

/** Trusted session policy, independent of editable queue records. Throwing fails closed. */
export type GuardPolicy = (operation: Pick<OutboxOperation, 'op' | 'url' | 'container'>) => boolean;

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
  /** Session-local registration. Duplicate tags throw; close unregisters everything. */
  registerDelegate(tag: string, delegate: ReplayDelegate): () => void;
  /** Require this guard tag for matching operations. Session-local; duplicate tags throw. */
  registerGuardPolicy(tag: string, matches: GuardPolicy): () => void;
  /** Accepts a conflict ID or an item ID; returns a defensive copy. */
  localBody(id: string): Promise<Uint8Array | null>;
  replay(client: StorageClient, options?: ReplayOptions): Promise<void>;
  /** Uses the client supplied to withOutbox or the most recent replay. */
  retry(id?: string): Promise<void>;
  resolve(id: string, strategy: 'mine' | 'theirs' | 'both'): Promise<void>;
  on(event: 'change' | 'conflict', listener: () => void): () => void;
  /** Deletes only this WebID's queue. Logout deliberately does not call this. */
  purge(): Promise<void>;
  /** Releases listeners/delegates and aborts guarded deliveries; persisted changes survive. */
  close(): void;
}

export type QueueOption = { offline?: 'queue'; guard?: OutboxGuard; keepalive?: boolean };
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
  keepalive?: boolean;
  createOptions?: OutboxOperation['createOptions'];
  deleteOptions?: OutboxOperation['deleteOptions'];
  conflict?: ConflictRecord;
  guard?: { tag: string; assertions?: string };
  request?: RequestDescription;
  createMode?: 'solid' | 'container';
}

/** Derived only from the arguments sent to storage, never from policy metadata. */
interface RequestDescription {
  op: OutboxOperation['op'];
  url: string;
  container?: string;
  name?: string;
  kind?: CreateOptions['kind'];
}

const clients = new WeakMap<Outbox, StorageClient>();
const sessions = new WeakMap<
  Outbox,
  {
    delegates: Map<string, ReplayDelegate>;
    policies: Map<string, GuardPolicy>;
    signal: AbortSignal;
  }
>();
const underlying = new WeakMap<StorageClient, StorageClient>();
// Also serialize instances in the same realm, including tests without Web Locks.
const queues = new WeakMap<IDBFactory, Map<string, Promise<unknown>>>();
const encoder = new TextEncoder();
const maxAssertionBytes = 16 * 1024;
const isRdf = (type: string) =>
  /^(text\/turtle|text\/n3|application\/(ld\+json|rdf\+xml|n-triples|n-quads|trig))(?:\s*;|$)/i.test(
    type,
  );
const networkFailure = (error: unknown) =>
  (error instanceof StorageError && error.code === 'network') ||
  (error instanceof TypeError && /fetch|network/i.test(error.message));

class MissingDelegateError extends Error {}
class GuardRequiredError extends Error {}
class InvalidRequestError extends TypeError {}

function canonicalTarget(url: string, storage?: StorageClient): string {
  // Match storage-client's http.scoped / mutation target normalization. isWithinStorage
  // supplies its scope checks; WHATWG parsing retains encoded segments verbatim.
  if (typeof url !== 'string' || !URL.canParse(url))
    throw new TypeError('[solid-offline] invalid destination URL');
  const parsed = new URL(url);
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    /%2f|%5c/i.test(parsed.pathname) ||
    (storage && (!storage.isWithinStorage(url) || parsed.href !== new URL(url, storage.root).href))
  )
    throw new StorageError('scope', { url: '[invalid destination]', method: 'OUTBOX' });
  if (/[?#]/.test(parsed.href))
    throw new StorageError('bad-request', {
      url: parsed.href,
      method: 'OUTBOX',
      message: '[solid-offline] mutation URLs cannot have a query or fragment',
    });
  return storage && `${parsed.href}/` === storage.root ? storage.root : parsed.href;
}

function describeRequest(
  operation: OutboxOperation,
  storage?: StorageClient,
  mode: StoredItem['createMode'] = 'solid',
): RequestDescription {
  if (operation.op !== 'create') {
    if (operation.op !== 'write' && operation.op !== 'delete')
      throw new TypeError('[solid-offline] invalid operation');
    return { op: operation.op, url: canonicalTarget(operation.url, storage) };
  }
  const container = canonicalTarget(operation.container as string, storage);
  const { name, kind = 'resource' } = operation.createOptions ?? {};
  if (kind !== 'resource' && kind !== 'container')
    throw new TypeError('[solid-offline] invalid create kind');
  let exactName = storage ? storage.protocol === 'solid' : mode === 'solid';
  // The optional TrashService also dispatches create as a command POST, on either backend.
  const trash = storage?.features.trash;
  if (storage && trash?.state === 'available' && trash.detail.endpoint) {
    try {
      if (canonicalTarget(trash.detail.endpoint, storage) === container) exactName = false;
    } catch {
      // storage-client ignores an unusable advertised endpoint when identifying commands.
    }
  }
  // LWS always POSTs to the container. Its name is a hint, not a child path;
  // leave hint validation to the backend, including names containing '/'.
  if (exactName && !container.endsWith('/'))
    throw new TypeError('[solid-offline] expected a container URL');
  const url =
    exactName && name !== undefined
      ? canonicalTarget(`${childUrl(container, name)}${kind === 'container' ? '/' : ''}`, storage)
      : container;
  return { op: 'create', url, container, name, kind };
}

function recordOperation(record: StoredItem): OutboxOperation {
  return {
    ...record.item,
    createOptions: record.createOptions,
  };
}

function storedRequest(record: StoredItem, storage?: StorageClient): RequestDescription {
  try {
    const request = describeRequest(
      recordOperation(record),
      storage,
      record.createMode ?? (record.request ? 'solid' : 'container'),
    );
    if (record.request !== undefined) {
      const keys = ['op', 'url', 'container', 'name', 'kind'] as const;
      if (
        !record.request ||
        keys.some((key) => request[key] !== record.request?.[key]) ||
        record.item.url !== request.url ||
        (request.op === 'create' && record.item.name !== request.name)
      )
        throw new TypeError('destination mismatch');
    }
    return request;
  } catch {
    throw new InvalidRequestError('[solid-offline] invalid stored request destination');
  }
}

function guardRequired(
  policies: Map<string, GuardPolicy> | undefined,
  operation: Pick<OutboxOperation, 'op' | 'url' | 'container'>,
  guard: OutboxGuard | undefined,
): boolean {
  if (!policies) return false;
  for (const [tag, matches] of policies) {
    if (guard?.tag === tag) continue;
    try {
      // Matchers receive only a disposable description, never queue records or assertions.
      if (!matches({ op: operation.op, url: operation.url, container: operation.container }))
        continue;
    } catch {
      // A policy whose scope cannot be established still requires its guard.
    }
    return true;
  }
  return false;
}

function assertGuardPolicy(
  outbox: Outbox,
  operation: Pick<OutboxOperation, 'op' | 'url' | 'container'>,
  guard?: OutboxGuard,
): void {
  if (guardRequired(sessions.get(outbox)?.policies, operation, guard))
    throw new GuardRequiredError('[solid-offline] guard required by registered policy');
}

function errorMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return 'Unknown delivery error';
  }
}

function validateTag(tag: unknown): asserts tag is string {
  // Length first, so a corrupted stored tag is rejected before the pattern sees it.
  if (typeof tag !== 'string' || tag.length > 64 || !/^[a-z][a-z0-9.-]{0,63}$/.test(tag)) {
    throw new TypeError('[solid-offline] invalid guard tag');
  }
}

/**
 * Enforce depth, value-count and byte budgets while copying; caller object key
 * enumeration is not bounded. Stored envelopes are read by fixed field, and stored
 * assertions must pass the byte cap before parsing.
 */
function snapshotGuard(
  value: unknown,
  source: 'caller' | 'stored' = 'caller',
): OutboxGuard | undefined {
  if (value === undefined) return undefined;
  const invalid = () =>
    new TypeError('[solid-offline] invalid guard: assertions must be plain JSON');
  if (
    value === null ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw invalid();
  // Read only the two fixed fields by descriptor. Stored envelopes (IndexedDB
  // structured clones) are never enumerated before the assertion byte cap, and
  // any other stored key is never read. Caller guards must have no other keys.
  const fields = new Map<string, unknown>();
  for (const key of ['tag', 'assertions'] as const) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property) continue;
    if (!property.enumerable || !Object.hasOwn(property, 'value')) throw invalid();
    fields.set(key, property.value);
  }
  if (source === 'caller' && Reflect.ownKeys(value).length !== fields.size) throw invalid();
  const tag = fields.get('tag');
  validateTag(tag);
  let nodes = 0;
  let size = 0;
  const count = (bytes: number) => {
    size += bytes;
    if (size > maxAssertionBytes)
      throw new TypeError('[solid-offline] guard assertions exceed 16 KiB');
  };
  // Count JSON escaping and UTF-8 incrementally, without allocating an encoded large string.
  const stringSize = (text: string) => {
    count(2);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) count(2);
      else if (code < 32) count(6);
      else if (code < 128) count(1);
      else if (code < 2048) count(2);
      else if (code >= 0xd800 && code <= 0xdfff) {
        const next = text.charCodeAt(i + 1);
        if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
          count(4);
          i++;
        } else count(6);
      } else count(3);
    }
  };
  const ancestors = new Set<object>();
  const copy = (input: unknown, depth = 0): JsonValue => {
    if (depth > 32) throw new TypeError('[solid-offline] guard assertions exceed depth 32');
    nodes++;
    if (typeof input === 'string') {
      stringSize(input);
      return input;
    }
    if (
      input === null ||
      typeof input === 'boolean' ||
      (typeof input === 'number' && Number.isFinite(input))
    ) {
      count(JSON.stringify(input).length);
      return input;
    }
    if (typeof input !== 'object' || input === null || ancestors.has(input)) throw invalid();
    const array = Array.isArray(input);
    if (array && Object.getPrototypeOf(input) !== Array.prototype) throw invalid();
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw invalid();
    // Reject oversized (including sparse) arrays before enumerating a single index.
    if (array && input.length > 2000 - nodes)
      throw new TypeError('[solid-offline] guard assertions exceed 2,000 nodes');
    ancestors.add(input);
    count(2); // Brackets/braces.
    const entries: [string, JsonValue][] = [];
    for (const key in input) {
      if (!Object.hasOwn(input, key)) continue;
      if (nodes >= 2000) throw new TypeError('[solid-offline] guard assertions exceed 2,000 nodes');
      const property = Object.getOwnPropertyDescriptor(input, key);
      if (
        !property?.enumerable ||
        !Object.hasOwn(property, 'value') ||
        (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= input.length))
      )
        throw invalid();
      if (entries.length) count(1); // Comma.
      if (!array) {
        stringSize(key);
        count(1); // Colon.
      }
      entries.push([key, copy(property.value, depth + 1)]);
    }
    // Reject symbols and hidden properties that for-in does not visit. Both for-in
    // and ownKeys may collect every key of a same-origin caller's object.
    if (Reflect.ownKeys(input).length !== entries.length + (array ? 1 : 0)) throw invalid();
    ancestors.delete(input);
    if (array) {
      if (entries.length !== input.length) throw invalid();
      return entries.map(([, entry]) => entry);
    }
    return Object.fromEntries(entries);
  };
  if (!fields.has('assertions')) return { tag };
  let assertions = fields.get('assertions');
  if (source === 'stored') {
    // Fail closed on legacy structured-cloned assertions. Check code-unit length
    // first so even UTF-8 encoding cannot allocate beyond the cap's small multiple.
    if (typeof assertions !== 'string') throw invalid();
    if (
      assertions.length > maxAssertionBytes ||
      encoder.encode(assertions).byteLength > maxAssertionBytes
    )
      throw new TypeError('[solid-offline] guard assertions exceed 16 KiB');
    try {
      assertions = JSON.parse(assertions);
    } catch {
      // SyntaxError messages can include private assertion bytes.
      throw invalid();
    }
  }
  return { tag, assertions: copy(assertions) };
}

function storedGuard(record: StoredItem): OutboxGuard | undefined {
  const guard = snapshotGuard(record.guard, 'stored');
  const metadata = snapshotGuard(record.item.guard, 'stored');
  if (metadata?.tag !== guard?.tag || (metadata && Object.hasOwn(metadata, 'assertions'))) {
    throw new TypeError('[solid-offline] invalid stored guard metadata');
  }
  return guard;
}

function delegateFor(outbox: Outbox, tag: string): ReplayDelegate {
  const session = sessions.get(outbox);
  if (!session) throw new Error('[solid-offline] outbox is closed');
  const delegate = session.delegates.get(tag);
  if (!delegate)
    throw new MissingDelegateError(
      `[solid-offline] no replay delegate registered for guard "${tag}"`,
    );
  return delegate;
}

async function deliverGuarded(
  outbox: Outbox,
  guard: OutboxGuard,
  delivery: Omit<GuardedDelivery, 'assertions'>,
  storage: StorageClient,
  signal?: AbortSignal,
): ReturnType<ReplayDelegate> {
  const request = describeRequest(delivery, storage);
  assertGuardPolicy(outbox, request, guard);
  const delegate = delegateFor(outbox, guard.tag);
  const session = sessions.get(outbox) as NonNullable<ReturnType<typeof sessions.get>>;
  const activeSignal = signal ? AbortSignal.any([session.signal, signal]) : session.signal;
  activeSignal.throwIfAborted();
  return delegate(
    structuredClone({ ...delivery, url: request.url, assertions: guard.assertions }),
    { storage, signal: activeSignal },
  );
}

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
    typeof name !== 'string' ||
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
  return new URL(encodeURIComponent(name), container).href;
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
  const controller = new AbortController();
  const delegates = new Map<string, ReplayDelegate>();
  const policies = new Map<string, GuardPolicy>();
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
    const loaded = await transaction<StoredItem[]>('readwrite', (store) => {
      const request = store.getAll();
      request.onsuccess = () => {
        for (const record of request.result as StoredItem[]) {
          try {
            const storage = clients.get(outbox);
            const description = storedRequest(record, storage);
            const guard = storedGuard(record);
            // Legacy records acquire a destination binding once a client is available.
            if (record.request === undefined && storage) {
              record.request = description;
              record.createMode = description.url === description.container ? 'container' : 'solid';
              record.item.url = description.url;
              if (description.op === 'create') record.item.name = description.name;
              store.put(record);
            }
            const required = guardRequired(policies, description, guard);
            if (record.item.status === 'replaying' && required) {
              record.item.status = 'waiting';
              store.put(record);
            }
          } catch (error) {
            const message =
              error instanceof InvalidRequestError
                ? error.message
                : `[solid-offline] invalid stored guard: ${errorMessage(error)}`;
            if (record.item.status !== 'failed' || record.item.error !== message) {
              record.item.status = 'failed';
              record.item.error = message;
              store.put(record);
            }
          }
        }
      };
      return request;
    });
    loaded.sort((a, b) => a.item.createdAt - b.item.createdAt || (a.order ?? 0) - (b.order ?? 0));
    records = loaded;
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
    const request = storedRequest(record, storage);
    const guard = storedGuard(record);
    const keepalive = record.keepalive ?? record.createOptions?.keepalive;
    assertGuardPolicy(outbox, request, guard);
    if (guard) {
      await deliverGuarded(
        outbox,
        guard,
        {
          ...request,
          container: request.container ?? item.container,
          name: request.op === 'create' ? request.name : item.name,
          contentType: item.contentType,
          body: record.body,
          ifMatch: record.ifMatch,
          keepalive,
          createOptions: record.createOptions,
          deleteOptions: record.deleteOptions,
          purpose: 'replay',
        },
        storage,
        signal,
      );
      return;
    }
    if (item.op === 'delete') {
      await storage.delete(request.url, {
        ...record.deleteOptions,
        ifMatch: record.ifMatch,
        signal,
      });
    } else if (item.op === 'create') {
      await storage.create(request.container as string, record.body, {
        ...record.createOptions,
        keepalive,
        signal,
      });
    } else {
      await storage.write(request.url, record.body ?? new Uint8Array(), {
        contentType: item.contentType as string,
        ifMatch: record.ifMatch as string,
        keepalive,
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
      if (
        guardRequired(policies, storedRequest(record, storage), record.guard) ||
        (record.guard && !delegates.has(record.guard.tag))
      ) {
        if (record.item.status !== 'waiting') {
          record.item.status = 'waiting';
          await save(record);
        }
        blocked.add(record.item.url);
        continue;
      }
      record.item.status = 'replaying';
      await save(record);
      // Registration can disappear while persistence yields to a component cleanup.
      if (
        guardRequired(policies, storedRequest(record, storage), record.guard) ||
        (record.guard && !delegates.has(record.guard.tag))
      ) {
        record.item.status = 'waiting';
        await save(record);
        blocked.add(record.item.url);
        continue;
      }
      progress(0, record.item.size);
      try {
        await send(record, storage, opts.signal);
      } catch (error) {
        if (error instanceof MissingDelegateError || error instanceof GuardRequiredError) {
          record.item.status = 'waiting';
          blocked.add(record.item.url);
          await save(record);
          continue;
        }
        if (
          networkFailure(error) ||
          opts.signal?.aborted ||
          (record.guard && controller.signal.aborted)
        ) {
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
          record.item.error = errorMessage(error);
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
    pending: () =>
      records.map((r) => {
        const { guard: _guard, blocked: _blocked, ...item } = r.item;
        return {
          ...item,
          ...(r.guard && typeof r.guard.tag === 'string' ? { guard: { tag: r.guard.tag } } : {}),
          ...(r.item.status === 'waiting'
            ? guardRequired(policies, storedRequest(r), r.guard)
              ? { blocked: 'guard-required' as const }
              : r.guard && !delegates.has(r.guard.tag)
                ? { blocked: 'no-delegate' as const }
                : {}
            : {}),
        };
      }),
    conflicts: () => records.flatMap((r) => (r.conflict ? [{ ...r.conflict }] : [])),
    async enqueue(operation) {
      const guard = snapshotGuard(operation.guard);
      const persistedGuard = guard && {
        tag: guard.tag,
        ...(guard.assertions !== undefined ? { assertions: JSON.stringify(guard.assertions) } : {}),
      };
      operation = {
        ...operation,
        createOptions:
          operation.op === 'create'
            ? structuredClone({
                ...(operation.createOptions ?? { contentType: operation.contentType }),
                name: operation.createOptions?.name ?? operation.name,
              })
            : structuredClone(operation.createOptions),
        deleteOptions: structuredClone(operation.deleteOptions),
      };
      const storage = clients.get(outbox);
      const request = describeRequest(operation, storage);
      // Snapshot mutable/stream bodies before waiting for the database lock.
      const body = await bytes(operation.body);
      return exclusive(async () => {
        const item: OutboxItem = {
          id: crypto.randomUUID(),
          op: operation.op,
          url: request.url,
          container: request.container ?? operation.container,
          name: request.name ?? operation.name,
          contentType: operation.contentType,
          label: operation.label,
          size: body?.byteLength ?? 0,
          createdAt: now(),
          status: 'waiting',
          ...(guard ? { guard: { tag: guard.tag } } : {}),
        };
        await save({
          item,
          body,
          ifMatch: operation.ifMatch,
          keepalive: operation.keepalive ?? operation.createOptions?.keepalive,
          createOptions: operation.createOptions,
          deleteOptions: operation.deleteOptions,
          guard: persistedGuard,
          request,
          createMode: request.url === request.container ? 'container' : 'solid',
        });
        return outbox.pending().find((entry) => entry.id === item.id) as OutboxItem;
      });
    },
    registerDelegate(tag, delegate) {
      if (closed) throw new Error('[solid-offline] outbox is closed');
      validateTag(tag);
      if (delegates.has(tag))
        throw new Error(`[solid-offline] duplicate replay delegate for "${tag}"`);
      delegates.set(tag, delegate);
      emit('change');
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        delegates.delete(tag);
        emit('change');
      };
    },
    registerGuardPolicy(tag, matches) {
      if (closed) throw new Error('[solid-offline] outbox is closed');
      validateTag(tag);
      if (policies.has(tag)) throw new Error(`[solid-offline] duplicate guard policy for "${tag}"`);
      policies.set(tag, matches);
      emit('change');
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        policies.delete(tag);
        emit('change');
      };
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
        const request = storedRequest(record, storage);
        const guard = storedGuard(record);
        const keepalive = record.keepalive ?? record.createOptions?.keepalive;
        assertGuardPolicy(outbox, request, guard);
        if (guard) delegateFor(outbox, guard.tag);
        if (strategy === 'mine') {
          const head = await storage.head(request.url, { revalidate: true });
          if (!head.etag)
            throw new Error('[solid-offline] cannot overwrite without a current ETag');
          const delivery = describeRequest(
            {
              op: item.op === 'delete' ? ('delete' as const) : ('write' as const),
              url: request.url,
            },
            storage,
          );
          assertGuardPolicy(outbox, storedRequest(record, storage), guard);
          assertGuardPolicy(outbox, delivery, guard);
          if (guard) {
            await deliverGuarded(
              outbox,
              guard,
              {
                op: item.op === 'delete' ? 'delete' : 'write',
                url: delivery.url,
                container: item.container,
                name: item.name,
                contentType: item.contentType ?? 'application/octet-stream',
                body: record.body,
                ifMatch: head.etag,
                keepalive,
                deleteOptions: record.deleteOptions,
                purpose: 'resolve-mine',
              },
              storage,
            );
          } else if (item.op === 'delete') {
            await storage.delete(delivery.url, { ...record.deleteOptions, ifMatch: head.etag });
          } else {
            await storage.write(delivery.url, record.body ?? new Uint8Array(), {
              contentType: item.contentType ?? 'application/octet-stream',
              ifMatch: head.etag,
              keepalive,
            });
          }
        } else if (strategy === 'both') {
          if (item.op === 'delete')
            throw new Error('[solid-offline] keep both is unavailable for deletes');
          const container = request.container ?? (await storage.parentOf(request.url));
          if (!container) throw new Error('[solid-offline] conflict has no parent container');
          const original =
            item.name ??
            decodeURIComponent(new URL(item.url).pathname.split('/').pop() ?? 'resource');
          const dot = original.lastIndexOf('.');
          const stem = dot > 0 ? original.slice(0, dot) : original;
          const ext = dot > 0 ? original.slice(dot) : '';
          const name = `${stem}${record.conflict?.kind === 'rdf' ? ' (copy)' : `-conflict-${now()}`}${ext}`;
          // StorageClient.create's named Solid PUT uses If-None-Match: *.
          const createOptions = {
            ...record.createOptions,
            keepalive,
            name,
            contentType: item.contentType,
          };
          const delivery = describeRequest(
            {
              op: 'create' as const,
              url: container,
              container,
              createOptions,
            },
            storage,
          );
          assertGuardPolicy(outbox, storedRequest(record, storage), guard);
          assertGuardPolicy(outbox, delivery, guard);
          if (guard) {
            await deliverGuarded(
              outbox,
              guard,
              {
                ...delivery,
                contentType: item.contentType,
                body: record.body,
                createOptions,
                keepalive,
                purpose: 'resolve-both',
              },
              storage,
            );
          } else await storage.create(delivery.container as string, record.body, createOptions);
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
      controller.abort();
      delegates.clear();
      policies.clear();
      sessions.delete(outbox);
      clients.delete(outbox);
      channel?.close();
      listeners.change.clear();
      listeners.conflict.clear();
    },
  };
  sessions.set(outbox, { delegates, policies, signal: controller.signal });
  return outbox;
}

/** Opt-in only. Patch/move and every read keep the wrapped client's behavior. */
export function withOutbox(client: StorageClient, outbox: Outbox): QueueingStorageClient {
  const raw = underlying.get(client) ?? client;
  clients.set(outbox, raw);

  function checkPolicy(operation: OutboxOperation): RequestDescription | undefined {
    if (!sessions.get(outbox)?.policies.size) return undefined;
    const request = describeRequest(operation, raw);
    assertGuardPolicy(outbox, request);
    return request;
  }

  async function attempt(
    operation: OutboxOperation,
    send: (
      body: Uint8Array | null,
      request: OutboxOperation,
    ) => Promise<WriteResult> | Promise<void>,
    signal?: AbortSignal,
    queue = true,
  ): Promise<QueueingWriteResult> {
    signal?.throwIfAborted();
    const guard = snapshotGuard(operation.guard);
    operation = {
      ...operation,
      createOptions: structuredClone(operation.createOptions),
      deleteOptions: structuredClone(operation.deleteOptions),
    };
    const request = describeRequest(operation, raw);
    operation.url = request.url;
    operation.container = request.container;
    operation.name = request.name;
    assertGuardPolicy(outbox, request, guard);
    const body = await bytes(operation.body);
    assertGuardPolicy(outbox, describeRequest(operation, raw), guard);
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!offline || !queue) {
      try {
        const result = guard
          ? await deliverGuarded(
              outbox,
              guard,
              {
                op: operation.op,
                url: operation.url,
                container: operation.container,
                name: operation.name,
                contentType: operation.contentType,
                body,
                ifMatch: operation.ifMatch,
                keepalive: operation.keepalive,
                createOptions: operation.createOptions,
                deleteOptions: operation.deleteOptions,
                purpose: 'replay',
              },
              raw,
              signal,
            )
          : await send(body, operation);
        return result ?? { url: operation.url, etag: null, created: false };
      } catch (error) {
        if (!queue || signal?.aborted || !networkFailure(error)) throw error;
      }
    }
    signal?.throwIfAborted();
    await outbox.enqueue({ ...operation, body, guard });
    return { url: operation.url, etag: null, created: false, queued: true };
  }

  const overrides: Pick<QueueingStorageClient, 'write' | 'writeRdf' | 'create' | 'delete'> = {
    async write(url, body, opts) {
      if (opts.offline !== 'queue' && opts.guard === undefined) {
        const request = checkPolicy({ op: 'write', url });
        return client.write(request?.url ?? url, body, opts);
      }
      const { offline: _offline, guard, ...writeOpts } = opts;
      return attempt(
        {
          op: 'write',
          url,
          body,
          contentType: opts.contentType,
          ifMatch: opts.ifMatch,
          keepalive: opts.keepalive,
          guard,
        },
        (copy, request) => raw.write(request.url, copy ?? new Uint8Array(), writeOpts),
        opts.signal,
        opts.offline === 'queue',
      );
    },
    async writeRdf(url, dataset, opts) {
      if (opts.offline !== 'queue' && opts.guard === undefined) {
        const request = checkPolicy({ op: 'write', url });
        return client.writeRdf(request?.url ?? url, dataset, opts);
      }
      const guard = snapshotGuard(opts.guard);
      const quads = [...dataset];
      const contentType = opts.contentType ?? 'text/turtle';
      const body = await serializeRdf(quads, contentType);
      const { offline: _offline, guard: _guard, ...rdfOpts } = opts;
      return attempt(
        {
          op: 'write',
          url,
          body,
          contentType,
          ifMatch: opts.ifMatch,
          keepalive: opts.keepalive,
          guard,
        },
        (_copy, request) => raw.writeRdf(request.url, quads, rdfOpts),
        opts.signal,
        opts.offline === 'queue',
      );
    },
    async create(container, body, opts) {
      if (opts?.offline !== 'queue' && opts?.guard === undefined) {
        if (sessions.get(outbox)?.policies.size) {
          const { signal, ...input } = opts ?? {};
          const createOptions = structuredClone(input);
          const request = checkPolicy({ op: 'create', url: container, container, createOptions });
          return client.create(request?.container as string, body, { ...createOptions, signal });
        }
        return client.create(container, body, opts);
      }
      const { offline: _offline, signal, guard, ...createOpts } = opts;
      const name = opts.name ?? `offline-${crypto.randomUUID()}`;
      const request = describeRequest(
        {
          op: 'create',
          url: container,
          container,
          createOptions: { ...createOpts, name },
        },
        raw,
      );
      return attempt(
        {
          op: 'create',
          url: request.url,
          container: request.container,
          name,
          body,
          contentType: opts.contentType,
          createOptions: { ...createOpts, name },
          keepalive: opts.keepalive,
          guard,
        },
        (copy, request) =>
          raw.create(request.container as string, copy, { ...request.createOptions, signal }),
        signal,
        opts.offline === 'queue',
      );
    },
    async delete(url, opts) {
      if (opts?.offline !== 'queue' && opts?.guard === undefined) {
        const request = checkPolicy({ op: 'delete', url });
        return client.delete(request?.url ?? url, opts);
      }
      const { offline: _offline, guard, ...deleteOpts } = opts;
      await attempt(
        {
          op: 'delete',
          url,
          ifMatch: opts.ifMatch,
          deleteOptions: { recursive: opts.recursive },
          keepalive: opts.keepalive,
          guard,
        },
        (_copy, request) => raw.delete(request.url, deleteOpts),
        opts.signal,
        opts.offline === 'queue',
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
