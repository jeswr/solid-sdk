// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Worker-owned, document-confined reads. No replica, page gate, or persistent cache. */
import type { PinnedTarget } from './class-grant';
import { safePathUrl } from './class-path';
import { RESOLUTION_LIMITS, type ResolutionBudget } from './class-resolution-budget';
import type { ResolveFetch } from './class-resolve';

export interface InternalRead {
  readonly fetch: ResolveFetch;
  readonly budget: ResolutionBudget;
  /** Only the resolver may add documents discovered through the prescribed RDF links. */
  allowDocument(url: string, authenticated: boolean): void;
  /** For the sampling rung: one candidate and its explicitly listed direct members. */
  allowTarget(target: PinnedTarget): void;
  allowMember(target: PinnedTarget, url: string): void;
}

function documentUrl(value: string): string | null {
  const url = safePathUrl(value);
  if (!url || url.username || url.password) return null;
  url.hash = '';
  return url.href;
}

export function createInternalRead(options: {
  webId: string;
  authenticatedOrigins: ReadonlySet<string>;
  allowedOrigins: ReadonlySet<string>;
  budget: ResolutionBudget;
  signal?: AbortSignal;
  /** Manual GET/HEAD, rechecking live authority and calling beforeSend before EVERY network read. */
  send: (
    url: string,
    authenticated: boolean,
    method: string,
    signal: AbortSignal,
    beforeSend: () => void,
  ) => Promise<Response>;
}): InternalRead {
  const { budget } = options;
  const documents = new Map<string, Set<boolean>>();
  const cache = new Map<string, ReturnType<ResolveFetch>>();
  const targets = new Set<string>();
  const allowDocument = (url: string, authenticated: boolean) => {
    const key = documentUrl(url);
    if (!key || (authenticated && !options.authenticatedOrigins.has(new URL(key).origin))) return;
    const modes = documents.get(key) ?? new Set<boolean>();
    modes.add(authenticated);
    documents.set(key, modes);
  };
  allowDocument(options.webId, false);
  const confined = (url: string, authenticated: boolean): boolean => {
    const key = documentUrl(url);
    return key !== null && documents.get(key)?.has(authenticated) === true;
  };
  const read: ResolveFetch = async (url, authenticated, method = 'GET') => {
    const failed = { ok: false, text: '', url };
    if (method !== 'GET' && method !== 'HEAD') return failed;
    if (!confined(url, authenticated) || !budget.active() || options.signal?.aborted) return failed;
    const key = `${authenticated} ${method} ${documentUrl(url)}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const aliases = new Set([key]);
    const operation: ReturnType<ResolveFetch> = (async () => {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      budget.signal.addEventListener('abort', cancel, { once: true });
      options.signal?.addEventListener('abort', cancel, { once: true });
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let body: ReadableStream<Uint8Array> | null = null;
      const cancelBody = () => {
        if (reader) void reader.cancel().catch(() => {});
        else void body?.cancel().catch(() => {});
      };
      controller.signal.addEventListener('abort', cancelBody, { once: true });
      try {
        let current = url;
        for (let hops = 0; ; hops++) {
          if (!confined(current, authenticated)) return failed;
          const hopKey = `${authenticated} ${method} ${documentUrl(current)}`;
          const known = cache.get(hopKey);
          if (hops > 0 && known && !aliases.has(hopKey))
            return await budget.run(() => known, controller.signal);
          aliases.add(hopKey);
          // Reserve this uncached hop here, even for a simple one-shot transport.
          if (!budget.document()) return failed;
          let firstAttempt = true;
          const response = await budget.run(async () => {
            const response = await options.send(
              current,
              authenticated,
              method,
              controller.signal,
              () => {
                controller.signal.throwIfAborted();
                if (!budget.active()) budget.signal.throwIfAborted();
                // The first attempt is reserved above; nonce retries are fresh network reads.
                if (firstAttempt) firstAttempt = false;
                else if (!budget.document()) budget.signal.throwIfAborted();
              },
            );
            // Also dispose a late response from a transport that ignores abort.
            if (controller.signal.aborted) {
              void response.body?.cancel().catch(() => {});
              controller.signal.throwIfAborted();
            }
            return response;
          }, controller.signal);
          body = response.body;
          // Never probe an opaque redirect: a follow probe would visit unchecked intermediate hops.
          if (response.type === 'opaqueredirect' || response.status === 0) return failed;
          if (response.status >= 300 && response.status < 400) {
            void response.body?.cancel().catch(() => {});
            const location = response.headers.get('location');
            if (!location) return failed;
            if (hops >= RESOLUTION_LIMITS.redirects) {
              budget.exhaust();
              return failed;
            }
            // Check the raw Location before URL resolution can erase unsafe dot segments.
            if (
              !safePathUrl(
                new URL(current).origin + (location.startsWith('/') ? '' : '/') + location,
              )
            )
              return failed;
            current = new URL(location, current).href;
            continue;
          }
          if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            return failed;
          }
          if (response.url && documentUrl(response.url) !== documentUrl(current)) return failed;
          let text = '';
          if (method !== 'HEAD' && response.body) {
            reader = response.body.getReader();
            const decoder = new TextDecoder();
            let bytes = 0;
            for (;;) {
              const chunk = await budget.run(() => reader!.read(), controller.signal);
              if (chunk.done) break;
              bytes += chunk.value.byteLength;
              if (bytes > RESOLUTION_LIMITS.bytes) {
                budget.exhaust();
                return failed;
              }
              text += decoder.decode(chunk.value, { stream: true });
            }
            text += decoder.decode();
          }
          if (!budget.active() || controller.signal.aborted) return failed;
          const contentType = response.headers.get('content-type');
          return { ok: true, text, url: current, ...(contentType ? { contentType } : {}) };
        }
      } catch {
        return failed;
      } finally {
        controller.abort();
        controller.signal.removeEventListener('abort', cancelBody);
        budget.signal.removeEventListener('abort', cancel);
        options.signal?.removeEventListener('abort', cancel);
      }
    })();
    cache.set(key, operation);
    void operation.then((body) => {
      for (const alias of aliases) if (!cache.has(alias)) cache.set(alias, Promise.resolve(body));
    });
    return operation;
  };
  return {
    fetch: read,
    budget,
    allowDocument,
    allowTarget(target) {
      const url = safePathUrl(target.url);
      if (!url || !options.allowedOrigins.has(url.origin) || url.search || url.hash) return;
      if (target.kind === 'container' && !url.pathname.endsWith('/')) return;
      targets.add(`${target.kind} ${url.href}`);
      allowDocument(url.href, true);
    },
    allowMember(target, value) {
      const parent = safePathUrl(target.url);
      const member = safePathUrl(value);
      if (!parent || !member || target.kind !== 'container' || member.search || member.hash) return;
      if (!targets.has(`${target.kind} ${parent.href}`) || member.origin !== parent.origin) return;
      const suffix = member.pathname.slice(parent.pathname.length).replace(/\/$/, '');
      if (!member.pathname.startsWith(parent.pathname) || !suffix || suffix.includes('/')) return;
      allowDocument(value, true);
    },
  };
}
