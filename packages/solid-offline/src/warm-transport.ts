// AUTHORED-BY Codex GPT-6.1-Sol
/** Internal page/worker budget bridge: StorageClient does not expose HTTP sizes. */
import type { ReadResult, StorageClient } from '@jeswr/storage-client';
import type { ResolvedWarmBudget } from './warmer.js';

export const LARGE_RESOURCE_BYTES = 5_000_000;
export const WARM_REQUEST_HEADER = 'x-solid-offline-warm';
const lengths = new WeakMap<ReadResult, string>();
export const warmContentLength = (result: ReadResult): string | undefined => lengths.get(result);

type Skip = 'large-resource' | 'large-binary';
interface Observation {
  length?: string;
  skipped?: Skip;
  bytes: number;
  status: number;
}
interface Snapshot {
  bytes: number;
  budgetHit: boolean;
  observation?: Observation;
}
export interface WarmStartMessage {
  type: 'warm-start';
  root: string;
  maxBytes: number;
  token: string;
}
type Command = {
  type: 'inspect' | 'close';
  url?: string;
};

export class WarmLimitError extends Error {
  constructor(
    readonly observation: Observation,
    readonly budgetHit: boolean,
  ) {
    super('Offline warming limit exceeded');
  }
}

/** A guard belongs to one page and one crawl; ordinary reads use the normal SWR path. */
export class WorkerWarmSession {
  private observations = new Map<string, Observation>();
  private cancellations = new Set<() => void>();
  private bytes = 0;
  private budgetHit = false;
  private closed = false;

  constructor(
    readonly root: string,
    private maxBytes: number,
    private token: string,
  ) {}

  command(command: Command): Snapshot {
    if (command.type === 'close') this.close();
    return {
      bytes: this.bytes,
      budgetHit: this.budgetHit,
      observation: command.url ? this.observations.get(new URL(command.url).href) : undefined,
    };
  }

  matches(request: Request): boolean {
    return request.headers.get(WARM_REQUEST_HEADER) === this.token;
  }

  close(): void {
    this.closed = true;
    for (const cancel of this.cancellations) cancel();
  }

  /** Run before SWR can clone/consume/store the network response. */
  async fetch(request: Request, transport: typeof fetch): Promise<Response> {
    if (this.closed) throw new Error('Warming session closed');
    const response = await transport(request);
    if (this.closed) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error('Warming session closed');
    }
    const observation: Observation = { bytes: 0, status: response.status };
    const length = response.headers.get('content-length');
    if (length !== null) observation.length = length;
    this.observations.set(request.url, observation);
    if (request.method === 'HEAD' || !response.body) return response;
    const contentType = response.headers.get('content-type') ?? '';
    if (/^(image\/|video\/|audio\/|application\/(octet-stream|pdf|zip))/i.test(contentType))
      observation.skipped = 'large-binary';
    else if (Number(length) > LARGE_RESOURCE_BYTES) observation.skipped = 'large-resource';
    else if (Number(length) > this.maxBytes - this.bytes || this.budgetHit) {
      observation.skipped = 'large-resource';
      this.budgetHit = true;
    }
    // Validate a clone before returning the original to SWR. Its tee holds only
    // the bounded body, and the original retains native URL/type/redirect metadata.
    const reader = response.clone().body?.getReader();
    if (!reader) return response;
    const cancel = () => {
      void reader.cancel().catch(() => undefined);
      void response.body?.cancel().catch(() => undefined);
    };
    this.cancellations.add(cancel);
    let complete = false;
    try {
      while (!observation.skipped) {
        const chunk = await reader.read();
        if (this.closed) throw new Error('Warming session closed');
        if (chunk.done) break;
        const size = chunk.value.byteLength;
        if (this.bytes + size > this.maxBytes) {
          this.budgetHit = true;
          observation.skipped = 'large-resource';
        } else {
          this.bytes += size;
          observation.bytes += size;
          if (observation.bytes > LARGE_RESOURCE_BYTES) observation.skipped = 'large-resource';
        }
      }
      if (observation.skipped) throw new WarmLimitError(observation, this.budgetHit);
      complete = true;
      return response;
    } finally {
      this.cancellations.delete(cancel);
      if (!complete) cancel();
      reader.releaseLock();
    }
  }
}

/** Acknowledge registration before issuing any intercepted StorageClient reads. */
export async function warmStorage(
  storage: StorageClient,
  budget: ResolvedWarmBudget,
  signal?: AbortSignal,
): Promise<{ storage: StorageClient; close(): Promise<Snapshot | undefined> }> {
  const controller = typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : null;
  if (!controller) return { storage, close: async () => undefined };
  signal?.throwIfAborted();
  const { port1, port2 } = new MessageChannel();
  const token = crypto.randomUUID();
  let sequence = 0;
  const pending = new Map<number, { resolve(value: Snapshot): void; reject(error: Error): void }>();
  function reply(id: number): Promise<Snapshot> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Worker warming guard unavailable'));
      }, 2000);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }
  const ready = reply(0);
  port1.onmessage = (event: MessageEvent<{ id: number; snapshot: Snapshot; error?: string }>) => {
    if (event.data.error) pending.get(event.data.id)?.reject(new Error(event.data.error));
    else pending.get(event.data.id)?.resolve(event.data.snapshot);
    pending.delete(event.data.id);
  };
  function command(value: Command): Promise<Snapshot> {
    signal?.throwIfAborted();
    sequence += 1;
    const id = sequence;
    const response = reply(id);
    port1.postMessage({ id, ...value });
    return response;
  }
  const stop = () => {
    port1.postMessage({ type: 'close' });
    for (const waiter of pending.values()) waiter.reject(new Error('Warming session stopped'));
    pending.clear();
    port1.close();
  };
  signal?.addEventListener('abort', stop, { once: true });
  void ready.catch(() => undefined);
  try {
    controller.postMessage(
      {
        type: 'warm-start',
        root: storage.root,
        maxBytes: budget.maxBytes,
        token,
      } satisfies WarmStartMessage,
      [port2],
    );
    await ready;
  } catch (error) {
    stop();
    signal?.removeEventListener('abort', stop);
    throw error;
  }
  async function observe(
    method: 'head' | 'read',
    url: string,
    opts: Parameters<StorageClient['read']>[1],
  ) {
    let result: ReadResult | undefined;
    let failure: unknown;
    try {
      result = await storage[method](url, tagged(opts));
    } catch (error) {
      failure = error;
    }
    const snapshot = await command({ type: 'inspect', url });
    if (snapshot.observation?.skipped)
      throw new WarmLimitError(snapshot.observation, snapshot.budgetHit);
    if (!result) throw failure;
    if (snapshot.observation?.length !== undefined)
      lengths.set(result, snapshot.observation.length);
    return result;
  }

  function tagged<T extends { headers?: HeadersInit }>(opts?: T) {
    const headers = new Headers(opts?.headers);
    headers.set(WARM_REQUEST_HEADER, token);
    return { ...opts, headers };
  }

  return {
    storage: {
      ...storage,
      head: (url, opts) => observe('head', url, opts),
      read: (url, opts) => observe('read', url, opts),
      list: (url, opts) => storage.list(url, tagged(opts)),
      async *listAll(url, opts) {
        yield* storage.listAll(url, tagged(opts));
      },
    },
    async close() {
      try {
        return await command({ type: 'close' });
      } finally {
        signal?.removeEventListener('abort', stop);
        stop();
      }
    },
  };
}
