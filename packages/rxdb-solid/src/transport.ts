// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope, snapshotFetchInput } from "@jeswr/guarded-fetch";

/**
 * Fail-closed refusal of a REDIRECTED response on a credentialed request.
 *
 * Every request the store issues carries the caller's authenticated `fetch`
 * (DPoP-bound or Bearer credentials). If that request were transparently
 * followed to a `Location:` on ANOTHER origin, the credential (and the request
 * body) could be replayed to an attacker-controlled server — a
 * credential-exfiltration / SSRF vector. So every request is issued with
 * `redirect: "manual"` and this guard REFUSES any redirect rather than
 * following it: undici surfaces the raw 3xx (`status` 300–399), browsers
 * surface an `opaqueredirect` filtered response (`type === "opaqueredirect"`,
 * `status === 0`), and a `redirected` flag is checked defensively.
 */
function assertNotRedirected(res: Response, url: string): void {
  if (
    res.type === "opaqueredirect" ||
    res.redirected === true ||
    (res.status >= 300 && res.status < 400)
  ) {
    throw new Error(
      `[rxdb-solid] refusing to follow a redirect from ${url} (status ${res.status}, type ${res.type}) — a credentialed request must not be redirected to another location`,
    );
  }
}

/** The over-cap error, one message for every path. */
function overCapError(url: string, maxBytes: number, detail?: string): Error {
  return new Error(
    `[rxdb-solid] response body from ${url} exceeds the ${maxBytes}-byte limit${
      detail ? ` (${detail})` : ""
    }`,
  );
}

/**
 * Best-effort cancellation of a response body, tolerant of the concrete body
 * shape. A WHATWG {@link ReadableStream} exposes `cancel()`; a Node-style
 * `Readable`/async-iterable body may expose `destroy()`; anything else is left
 * to GC. Never throws (a cancel failure must not mask the real error).
 */
async function cancelBody(body: unknown): Promise<void> {
  if (body == null || typeof body !== "object") return;
  const b = body as { cancel?: () => Promise<void> | void; destroy?: () => void };
  try {
    if (typeof b.cancel === "function") {
      await b.cancel();
    } else if (typeof b.destroy === "function") {
      b.destroy();
    }
  } catch {
    // ignore
  }
}

/** Accumulate chunks (Uint8Array or Buffer) into a single UTF-8 string. */
function decodeChunks(chunks: Uint8Array[], total: number): string {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

/** Coerce a stream/iterable chunk to a `Uint8Array` (handles string chunks). */
function chunkToBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk; // Buffer is a Uint8Array subclass
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  if (typeof chunk === "string") return new TextEncoder().encode(chunk);
  // Unknown chunk shape — treat as empty rather than crash; the caller still
  // enforces the cap on the bytes we DID account for.
  return new Uint8Array();
}

/**
 * Read a response body to text with a HARD byte cap. Reads the body
 * chunk-by-chunk, aborting (and cancelling the body) the instant the running
 * total exceeds `maxBytes`, so an oversized / endless body from a hostile
 * server can never be buffered into memory. An advertised `Content-Length`
 * over the cap is refused up front (cancelling the body before throwing).
 *
 * **Body-shape tolerance.** A conforming `fetch` returns a WHATWG
 * {@link ReadableStream} body (`getReader()`); some auth-fetch shims return a
 * Node `Readable` / async-iterable body while still supporting `res.text()`.
 * We use the web-stream path only when `res.body.getReader` is a function,
 * else fall back to iterating an async-iterable body under the SAME cap. Only
 * when the body is neither shape do we read via a bounded `res.text()`; if even
 * `res.text()` is unavailable we FAIL CLOSED with a clear compatibility error
 * (never an unbounded read).
 */
export async function readTextBounded(
  res: Response,
  maxBytes: number,
  url: string,
): Promise<string> {
  const body: unknown = res.body;
  const advertised = res.headers.get("content-length");
  if (advertised !== null) {
    const n = Number(advertised);
    if (Number.isFinite(n) && n > maxBytes) {
      // Cancel the body we are about to abandon before throwing.
      await cancelBody(body);
      throw overCapError(url, maxBytes, `content-length ${n}`);
    }
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  // 1) WHATWG ReadableStream body (the conforming fetch shape).
  if (body != null && typeof (body as { getReader?: unknown }).getReader === "function") {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) throw overCapError(url, maxBytes);
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return decodeChunks(chunks, total);
  }

  // 2) Node Readable / async-iterable body (still bounded).
  if (
    body != null &&
    typeof (body as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
  ) {
    try {
      for await (const raw of body as AsyncIterable<unknown>) {
        const value = chunkToBytes(raw);
        total += value.byteLength;
        if (total > maxBytes) throw overCapError(url, maxBytes);
        chunks.push(value);
      }
    } catch (err) {
      await cancelBody(body);
      throw err;
    }
    return decodeChunks(chunks, total);
  }

  // 3) No iterable body — fall back to a bounded res.text() (still capped).
  if (typeof res.text === "function") {
    const text = await res.text();
    if (new TextEncoder().encode(text).length > maxBytes) {
      throw overCapError(url, maxBytes);
    }
    return text;
  }

  // 4) Neither a stream, an async-iterable, nor res.text() — fail closed
  // rather than read an unbounded / unknown body.
  throw new Error(
    `[rxdb-solid] cannot read the response body from ${url}: the injected fetch returned a body that is neither a ReadableStream, an async-iterable, nor text-readable`,
  );
}

/** Guard the factory's transport and bound bodies before the SDK parses listings. */
export function storageTransport(
  base: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
  discovering: () => boolean = () => false,
): typeof fetch {
  return async (input, init) => {
    const snapshot = snapshotFetchInput(input, init, { metadataOnly: true, discardBody: true });
    // Discovery may visit ancestors and description documents, but never another origin.
    assertWithinPodScope(discovering() ? `${new URL(base).origin}/` : base, snapshot.url);
    const response = await fetchImpl(snapshot.url, { ...snapshot.init, redirect: "manual" });
    assertNotRedirected(response, snapshot.url);
    if ((init?.method ?? "GET").toUpperCase() !== "GET" || !response.ok) return response;
    const text = await readTextBounded(response, maxBytes, snapshot.url);
    return new Response(text, { status: response.status, headers: response.headers });
  };
}
