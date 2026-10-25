import type { Boundary } from "./CredentialBoundary.js";
import { type ChallengeContext, challengeContext } from "./challenge.js";
import { ReactiveAuthenticationError } from "./ReactiveAuthenticationError.js";
import type { SessionFence } from "./SessionFence.js";
import { SessionSupersededError } from "./SessionSupersededError.js";
import type { TokenProvider } from "./TokenProvider.js";
import { type FetchFunction, nonReactiveFetch } from "./transport.js";

export interface ReactiveAuthenticationOptions {
  /** Providers consulted in order for each challenge. */
  readonly providers: Iterable<TokenProvider>;

  /**
   * URLs that may receive credentials: a static `CredentialBoundary`, or a boundary that discovers
   * roots from 401 responses (e.g. `AutomaticCredentialBoundary`). Requests outside it are never upgraded.
   */
  readonly boundary: Boundary;

  /** Transport for all attempts. Defaults to {@link nonReactiveFetch}. */
  readonly fetch?: FetchFunction;

  /** Orders upgrades against logout. */
  readonly fence?: SessionFence;

  /** @defaultValue 20, as in the Fetch standard */
  readonly maxRedirects?: number;

  /**
   * Largest request body buffered for replay. Larger bodies reject with {@link ReactiveAuthenticationError}.
   * Bodies are buffered for URLs the boundary allows and for discovery candidates it may still authorize;
   * excluded URLs (neither) are never buffered.
   * @defaultValue 16 MiB
   */
  readonly maxReplayBodyBytes?: number;
}

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

/** Request headers that carry caller credentials and must not cross origins on redirect (Fetch §4.4). */
const credentialHeaders = ["authorization", "proxy-authorization", "cookie", "dpop"];

/** Request-body headers removed when a redirect rewrites the method to GET (Fetch §4.4). */
const bodyHeaders = [
  "content-type",
  "content-length",
  "content-encoding",
  "content-language",
  "content-location",
];

/** Session state captured once when a fetch starts and used for all of its attempts. */
interface Session {
  readonly generation: number | undefined;
  readonly signal: AbortSignal;
}

/**
 * The reactive algorithm shared by {@link ReactiveFetchManager} (pages) and the service worker:
 *
 * 1. Send the request unauthenticated.
 * 2. On 401 from a URL inside the credential boundary, let the first matching provider upgrade it.
 * 3. On a further 401, retry once for a DPoP nonce challenge and once after {@link TokenProvider.invalidate};
 *    otherwise return that 401.
 *
 * Request bodies are buffered once (bounded) so every attempt can replay them. Credentialed attempts do not
 * follow redirects automatically: each hop restarts the algorithm for the new URL, so credentials are only
 * attached to URLs inside the boundary. Browsers hide the target of such redirects (`opaqueredirect`); a
 * credentialed request is never repeated to discover it.
 *
 * The session generation and fence signal are captured when {@link fetch} is called, so logout during any
 * later wait (network, provider selection, user interaction) prevents credentials from being attached.
 */
export class ReactiveAuthenticationClient {
  readonly #providers: TokenProvider[];
  readonly #boundary: Boundary;
  readonly #fetch: FetchFunction;
  readonly #fence: SessionFence | undefined;
  readonly #maxRedirects: number;
  readonly #maxReplayBodyBytes: number;

  constructor(options: ReactiveAuthenticationOptions) {
    this.#providers = [...options.providers];
    this.#boundary = options.boundary;
    this.#fetch = options.fetch ?? ((input, init) => nonReactiveFetch()(input, init));
    this.#fence = options.fence;
    this.#maxRedirects = options.maxRedirects ?? 20;
    this.#maxReplayBodyBytes = options.maxReplayBodyBytes ?? 16 * 1024 * 1024;
  }

  get boundary(): Boundary {
    return this.#boundary;
  }

  get providers(): readonly TokenProvider[] {
    return this.#providers;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);

    // Excluded URLs (neither allowed nor discovery candidates) can never be upgraded, so they and their
    // streams pass through natively; candidates are buffered in case discovery authorizes them.
    if (!this.#eligible(request.url)) return await this.#fetch(request);

    const session = this.#session(request.signal);
    const generation = await this.#fence?.generation();
    const body = await bufferBody(request, session.signal, this.#maxReplayBodyBytes);
    return await this.#run(new Attempt(request, body), { generation, signal: session.signal }, 0);
  }

  #session(signal: AbortSignal): { signal: AbortSignal } {
    return {
      signal: this.#fence === undefined ? signal : AbortSignal.any([signal, this.#fence.signal]),
    };
  }

  async #run(attempt: Attempt, session: Session, hops: number): Promise<Response> {
    const response = await this.#send(attempt.request(session.signal), session);
    if (response.status !== 401) return response;

    if (response.redirected) {
      // The 401 came from the end of a redirect chain followed natively (without credentials).
      // Only safe methods can be re-targeted without guessing how the method was rewritten.
      if (!attempt.isSafeMethod) return response;
      if (++hops > this.#maxRedirects) throw new TypeError("Too many redirects");
      return await this.#authenticate(attempt.retarget(response.url), response, session, hops);
    }

    return await this.#authenticate(attempt, response, session, hops);
  }

  #eligible(url: string): boolean {
    return this.#boundary.allows(url) || this.#boundary.isCandidate?.(url) === true;
  }

  /**
   * Whether the challenged URL may receive credentials, letting a discovering boundary learn from this 401
   * first (no provider has run yet). Discovery is bound to the captured session: after logout it fails.
   */
  async #authorized(attempt: Attempt, response: Response, session: Session): Promise<boolean> {
    if (this.#boundary.allows(attempt.url)) return true;
    const boundary = this.#boundary;
    if (boundary.discover === undefined || boundary.isCandidate?.(attempt.url) !== true)
      return false;
    const allowed = await boundary.discover(attempt.url, response, {
      method: attempt.method,
      signal: session.signal,
    });
    await this.#assertCurrent(session);
    return allowed && boundary.allows(attempt.url);
  }

  async #authenticate(
    attempt: Attempt,
    response: Response,
    session: Session,
    hops: number,
  ): Promise<Response> {
    if (!(await this.#authorized(attempt, response, session))) return response;

    let challenge = challengeContext(response);
    const provider = await this.#findProvider(attempt.request(session.signal), challenge);
    if (provider === undefined) return response;

    let nonceRetries = 0;
    let renewals = 0;
    while (true) {
      await this.#assertCurrent(session);
      const upgraded = await provider.upgrade(attempt.request(session.signal), challenge);
      await discard(challenge.response);

      const result = await this.#send(withRedirect(upgraded, "manual"), session);
      if (redirectStatuses.has(result.status) || result.type === "opaqueredirect") {
        return await this.#followRedirect(attempt, result, session, hops);
      }
      if (result.status !== 401) return result;

      challenge = challengeContext(result);
      if (isNonceChallenge(challenge) && nonceRetries++ < 1) continue;
      if (provider.invalidate !== undefined && renewals++ < 1) {
        await provider.invalidate(upgraded, challenge);
        continue;
      }
      return result;
    }
  }

  /**
   * Handles a redirect answering a credentialed attempt.
   *
   * A readable `Location` restarts the algorithm for the next hop (credentials are re-evaluated there).
   * An `opaqueredirect` (browsers, service workers) hides the target; repeating the credentialed request
   * to learn it could duplicate side effects, so it is returned as-is and the caller sees the opaque response.
   */
  async #followRedirect(
    attempt: Attempt,
    response: Response,
    session: Session,
    hops: number,
  ): Promise<Response> {
    if (attempt.redirect === "error") {
      await discard(response);
      throw new TypeError("Redirect encountered with redirect mode 'error'");
    }
    if (attempt.redirect === "manual" || response.type === "opaqueredirect") return response;

    await discard(response);
    if (++hops > this.#maxRedirects) throw new TypeError("Too many redirects");

    const location = response.headers.get("Location");
    if (location === null) throw new TypeError("Redirect without Location");

    return await this.#run(
      attempt.redirected(new URL(location, attempt.url), response.status),
      session,
      hops,
    );
  }

  async #send(request: Request, session: Session): Promise<Response> {
    await this.#assertCurrent(session);
    return await this.#fetch(request);
  }

  async #assertCurrent(session: Session): Promise<void> {
    if (session.signal.aborted) {
      const reason = session.signal.reason;
      throw reason instanceof SessionSupersededError
        ? reason
        : (reason ?? new DOMException("Aborted", "AbortError"));
    }
    if (session.generation !== undefined) await this.#fence!.assertCurrent(session.generation);
  }

  async #findProvider(
    request: Request,
    challenge: ChallengeContext,
  ): Promise<TokenProvider | undefined> {
    for (const provider of this.#providers) {
      if (await provider.matches(request, challenge)) return provider;
    }
    return undefined;
  }
}

/** Immutable description of a request that can be materialized any number of times. */
class Attempt {
  constructor(
    private readonly template: Request,
    private readonly body: Blob | null,
    private readonly target: string = template.url,
    readonly method: string = template.method,
    private readonly headers: Headers = new Headers(template.headers),
  ) {}

  get url() {
    return this.target;
  }

  get redirect() {
    return this.template.redirect;
  }

  get isSafeMethod() {
    return this.method === "GET" || this.method === "HEAD";
  }

  request(signal: AbortSignal): Request {
    const t = this.template;
    return new Request(this.target, {
      method: this.method,
      headers: this.headers,
      body: this.isSafeMethod ? null : this.body,
      mode: t.mode === "navigate" ? "same-origin" : t.mode,
      credentials: t.credentials,
      cache: t.cache,
      redirect: t.redirect,
      referrer: t.referrer,
      referrerPolicy: t.referrerPolicy,
      integrity: t.integrity,
      keepalive: t.keepalive,
      signal,
    });
  }

  /** The same request for the URL a native redirect chain ended at. */
  retarget(url: string): Attempt {
    return new Attempt(
      this.template,
      this.body,
      url,
      this.method,
      stripOnUrlChange(this.headers, this.target, url),
    );
  }

  /** The next hop of a redirect, rewriting method, body and headers as the Fetch standard does. */
  redirected(location: URL, status: number): Attempt {
    const toGet =
      (status === 303 && this.method !== "HEAD") ||
      ((status === 301 || status === 302) && this.method === "POST");
    const headers = stripOnUrlChange(this.headers, this.target, location.href);
    if (toGet)
      bodyHeaders.forEach((h) => {
        headers.delete(h);
      });
    return new Attempt(
      this.template,
      toGet ? null : this.body,
      location.href,
      toGet ? "GET" : this.method,
      headers,
    );
  }
}

/**
 * Headers for a request moving from `from` to `to`: caller credentials are dropped across origins, and a
 * caller-supplied DPoP proof (bound to the old URL) is always dropped; providers create one per destination.
 */
function stripOnUrlChange(headers: Headers, from: string, to: string): Headers {
  const copy = new Headers(headers);
  if (new URL(from).origin !== new URL(to).origin) {
    credentialHeaders.forEach((h) => {
      copy.delete(h);
    });
  }
  if (from !== to) copy.delete("dpop");
  return copy;
}

/**
 * Reads the body so it can be replayed, honouring abort (including logout, through `signal`) and the size limit.
 *
 * Runtimes without request body streams — Firefox does not implement `Request.prototype.body`, so it reads
 * `undefined` there — are read with the standard `blob()` instead (see {@link bufferWithoutStreams}).
 */
async function bufferBody(
  request: Request,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Blob | null> {
  if (request.body === undefined) return await bufferWithoutStreams(request, signal, maxBytes);
  if (request.body === null) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  const onAbort = () => void reader.cancel(signal.reason).catch(() => undefined);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw bodyTooLarge(maxBytes);
      }
      chunks.push(value as Uint8Array<ArrayBuffer>);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }

  return withContentType(chunks, request);
}

/**
 * `blob()` for runtimes without request body streams. Their request bodies cannot be streams, so they are already
 * in memory: reading them whole costs a copy, and the size limit is enforced on the result. An abort settles at once
 * (the read itself cannot be cancelled; its late result is dropped). Without `body`, "no body" and an empty body are
 * indistinguishable; both replay as no body, which Fetch sends the same way for POST and PUT (`Content-Length: 0`).
 */
async function bufferWithoutStreams(
  request: Request,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Blob | null> {
  signal.throwIfAborted();
  if (request.method === "GET" || request.method === "HEAD") return null;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const reading = request.blob();
  reading.catch(() => undefined); // if the abort wins, the late read must not go unhandled
  let blob: Blob;
  try {
    blob = await Promise.race([reading, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort!);
  }
  signal.throwIfAborted();
  if (blob.size > maxBytes) throw bodyTooLarge(maxBytes);
  return blob.size === 0 ? null : withContentType([blob], request);
}

/** The buffered body typed as the request declared (replays rebuild requests from it). */
function withContentType(parts: BlobPart[], request: Request): Blob {
  const type = request.headers.get("content-type");
  return new Blob(parts, type === null ? {} : { type });
}

function bodyTooLarge(maxBytes: number): ReactiveAuthenticationError {
  return new ReactiveAuthenticationError(
    `Request body exceeds ${maxBytes} bytes and cannot be buffered for replay; authenticate first with a smaller request or raise maxReplayBodyBytes`,
  );
}

function withRedirect(request: Request, redirect: RequestRedirect): Request {
  return new Request(request, { redirect });
}

function isNonceChallenge(challenge: ChallengeContext): boolean {
  return (
    challenge.response.headers.has("DPoP-Nonce") &&
    challenge.challenges.some((c) => c.scheme === "dpop" && c.params["error"] === "use_dpop_nonce")
  );
}

async function discard(response: Response): Promise<void> {
  if (response.bodyUsed) return;
  await response.body?.cancel().catch(() => undefined);
}
