/**
 * Tiny deterministic mocks for the Cache API, fetch, BroadcastChannel and a
 * clock — enough to drive the SWR engine's full decision tree headlessly.
 */
import { vi } from 'vitest';
import type { Broadcaster, ByteCache } from '../src/swr.js';
import type { UpdatedEvent } from '../src/types.js';

/**
 * An in-memory Cache-API stand-in. Keys on the request URL + the canonical-ish
 * Accept so distinct variants don't collide — close enough for the engine,
 * which re-derives the real metadata key itself.
 */
export class MockByteCache implements ByteCache {
  private store = new Map<string, Response>();

  private keyOf(request: Request): string {
    return `${request.url}::${request.headers.get('accept') ?? ''}`;
  }

  async match(request: Request): Promise<Response | undefined> {
    const hit = this.store.get(this.keyOf(request));
    return hit ? hit.clone() : undefined;
  }

  async put(request: Request, response: Response): Promise<void> {
    this.store.set(this.keyOf(request), response.clone());
  }

  async delete(request: Request): Promise<boolean> {
    return this.store.delete(this.keyOf(request));
  }

  /** Test helper: seed a response directly. */
  seed(request: Request, response: Response): void {
    this.store.set(this.keyOf(request), response.clone());
  }

  get size(): number {
    return this.store.size;
  }
}

export class MockBroadcaster implements Broadcaster {
  messages: UpdatedEvent[] = [];
  postMessage(message: UpdatedEvent): void {
    this.messages.push(message);
  }
}

/**
 * A scripted fetch: each call shifts the next queued responder. Lets a test say
 * "first the initial GET returns 200, the background revalidation returns 304".
 */
export function scriptedFetch(
  responders: Array<(request: Request) => Response | Promise<Response>>,
): { fetch: typeof fetch; calls: Request[] } {
  const calls: Request[] = [];
  let i = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    calls.push(request);
    const responder = responders[Math.min(i, responders.length - 1)];
    i += 1;
    if (!responder) throw new Error('mock fetch: no responder');
    return responder(request);
  });
  return { fetch: fetchImpl as unknown as typeof fetch, calls };
}

export function turtleResponse(
  body: string,
  init: { status?: number; etag?: string; vary?: string; cacheControl?: string } = {},
): Response {
  const headers = new Headers();
  headers.set('content-type', 'text/turtle');
  if (init.etag) headers.set('etag', init.etag);
  headers.set('vary', init.vary ?? 'Accept, Origin');
  if (init.cacheControl) headers.set('cache-control', init.cacheControl);
  return new Response(body, { status: init.status ?? 200, headers });
}

export function notModifiedResponse(): Response {
  // A 304 has no body.
  return new Response(null, { status: 304 });
}

export function makeGet(url: string, accept = 'text/turtle'): Request {
  return new Request(url, { method: 'GET', headers: { accept } });
}
