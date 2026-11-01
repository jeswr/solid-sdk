// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  createGuardedFetch,
  type GuardOptions,
  type guardedFetch,
  refuseRedirects,
} from "@jeswr/guarded-fetch";
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";

const MAX_BODY_BYTES = 1024 * 1024;

/** Buffer only under the guard's deadline, without waiting for source cancellation. */
async function bufferRequestBody(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) throw new TypeError("request body exceeds cap (1 MiB)");
      chunks.push(value.slice());
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    signal.removeEventListener("abort", onAbort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Trusted injection constructs a single-hop DNS-pinning transport (or a test fake). */
export interface OriginFetchOptions {
  /** Apply maxRedirects at construction; do not wrap an already-following transport. */
  readonly createTransport?: (options: {
    readonly maxRedirects: 0;
    readonly allowLoopback: boolean;
  }) => typeof guardedFetch;
  readonly allowLoopback?: boolean;
  readonly dnsLookup?: GuardOptions["dnsLookup"];
}
/** Snapshot ORIGINS; reject before DNS or connection and refuse every redirect. */
export function createOriginScopedFetch(
  origins: ReadonlySet<string>,
  options: OriginFetchOptions = {},
): ReturnType<typeof createGuardedFetch> {
  const allowed = new Set(origins);
  for (const origin of allowed) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new TypeError("invalid binding origin");
    }
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      !["https:", "http:"].includes(url.protocol)
    )
      throw new TypeError("invalid binding origin");
  }
  const transport = (options.createTransport ?? createNodeGuardedFetch)(
    Object.freeze({ allowLoopback: options.allowLoopback ?? false, maxRedirects: 0 }),
  );
  const singleHop = refuseRedirects(transport);
  const guarded = createGuardedFetch({
    pinningFetch: async (input, init) => {
      // The guard always supplies init and its combined caller/deadline signal.
      const effective = init as RequestInit & { signal: AbortSignal };
      const body = effective.body;
      // Explicit streams are incompatible with keepalive and no-cors.
      const transportInit = {
        ...effective,
        body:
          body instanceof ReadableStream && (effective.keepalive || effective.mode === "no-cors")
            ? await bufferRequestBody(body, effective.signal)
            : body,
      };
      try {
        return await singleHop(input, transportInit);
      } catch {
        // An inner guard may parse Location before refusal and retain it in its cause.
        // Replace the whole error rather than passing untrusted transport details outward.
        throw new TypeError("binding transport failed or refused redirect");
      }
    },
    allowLoopback: options.allowLoopback,
    dnsLookup: options.dnsLookup,
    maxBytes: MAX_BODY_BYTES,
    requireDnsPinning: true,
    maxRedirects: 0,
  });
  return async (input, init) => {
    // Snapshot mutable URL/Request inputs before any asynchronous work.
    // Request construction resets inherited referrer settings unless supplied explicitly.
    const inherited = input instanceof Request ? input : undefined;
    let target: URL;
    try {
      target = new URL(input instanceof Request ? input.url : input);
    } catch {
      throw new TypeError("invalid binding request URL");
    }
    if (target.username || target.password)
      throw new TypeError("request URL must not carry userinfo (credentials)");
    let request: Request;
    try {
      request = new Request(inherited ?? target.href, {
        ...init,
        referrer: init?.referrer ?? inherited?.referrer,
        referrerPolicy: init?.referrerPolicy ?? inherited?.referrerPolicy,
      });
    } catch {
      // Native errors can echo URLs, referrers or other credential-bearing init values.
      throw new TypeError("invalid binding request");
    }
    const url = new URL(request.url);
    if (!allowed.has(url.origin)) throw new TypeError("request origin is outside binding ORIGINS");
    // guarded-fetch normalizes only part of Request; retain the effective policies explicitly.
    return guarded(request, {
      body: request.body,
      redirect: "manual",
      integrity: request.integrity,
      cache: request.cache,
      mode: request.mode,
      keepalive: request.keepalive,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
    });
  };
}
