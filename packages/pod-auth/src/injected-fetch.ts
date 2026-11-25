// AUTHORED-BY Claude Sonnet 5.5
/** Largest document read through `PodAuthOptions.fetch` (discovery, Client ID Document, profiles). */
export const MAX_SUPPLIED_BYTES = 1024 * 1024;

/**
 * Thrown (in place of whatever the engine would have wrapped it in) when the `PodAuthOptions.fetch`
 * transport rejects one of pod-auth's own unauthenticated requests. The supplied function's own error
 * is the unchanged `cause`; the message carries no URL.
 */
export class InjectedFetchError extends Error {
  constructor(cause: unknown) {
    super("The supplied fetch transport refused or failed a pod-auth request", { cause });
    this.name = "InjectedFetchError";
  }
}

/**
 * The supplied transport returned something pod-auth will not accept: not a `Response`, a response that
 * followed a redirect pod-auth did not allow, or an oversized document. A defect of the supplied
 * function rather than a refusal, so it is not an {@link InjectedFetchError}.
 */
export class InvalidInjectedResponseError extends Error {
  constructor(reason: "not-a-response" | "redirected" | "oversized") {
    super(
      {
        "not-a-response": "The supplied fetch did not return a Response",
        redirected: "The supplied fetch followed a redirect that pod-auth did not allow",
        oversized: "The supplied fetch returned a document over the size limit",
      }[reason],
    );
    this.name = "InvalidInjectedResponseError";
  }
}

/** The injected transport's refusal anywhere in an error's cause chain or aggregate, if there is one. */
export function injectedFetchFailure(error: unknown, depth = 0): InjectedFetchError | undefined {
  if (error instanceof InjectedFetchError) return error;
  if (depth >= 16 || !(error instanceof Error)) return undefined;
  if (error instanceof AggregateError)
    for (const inner of error.errors) {
      const found = injectedFetchFailure(inner, depth + 1);
      if (found !== undefined) return found;
    }
  return injectedFetchFailure(error.cause, depth + 1);
}

/**
 * Only GET/HEAD requests with no authorization, DPoP, proxy-authorization or cookie header may reach
 * `PodAuthOptions.fetch`. A GET/HEAD cannot carry a body (constructing one throws), so `Request.body`,
 * which some engines lack, is never consulted: anything that is not a GET/HEAD takes the default
 * transport, which is the safe direction. Token, registration and revocation requests are POSTs.
 */
export function isPublicRequest(request: Request) {
  return (
    (request.method === "GET" || request.method === "HEAD") &&
    !["authorization", "dpop", "proxy-authorization", "cookie"].some((name) =>
      request.headers.has(name),
    )
  );
}

const sameDocument = (a: string, b: string) => {
  try {
    const left = new URL(a);
    const right = new URL(b);
    left.hash = right.hash = "";
    return left.href === right.href;
  } catch {
    return false;
  }
};

async function bounded(response: Response, signal: AbortSignal): Promise<Response> {
  if (Number(response.headers.get("content-length")) > MAX_SUPPLIED_BYTES)
    throw new InvalidInjectedResponseError("oversized");
  if (response.body == null) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SUPPLIED_BYTES) throw new InvalidInjectedResponseError("oversized");
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    throw error;
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const copy = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  // The engine reads the final URL and redirect flag from the response it is given.
  Object.defineProperties(copy, {
    url: { value: response.url },
    redirected: { value: response.redirected },
  });
  return copy;
}

/**
 * Sends one credential-free request through the supplied function and enforces, on whatever it returns,
 * the guards the platform transport provides itself: the result must be a `Response`, must not be the
 * product of a redirect when the request did not ask to follow, and is read under a byte cap.
 */
export async function viaSupplied(supplied: typeof fetch, request: Request): Promise<Response> {
  // Ambient credentials (cookies, HTTP auth) are never part of these requests.
  const handed = new Request(request, { credentials: "omit" });
  let response: unknown;
  try {
    response = await supplied(handed);
  } catch (error) {
    // A cancelled or timed-out attempt keeps its own reason; any other rejection is the host's refusal.
    if (handed.signal.aborted && error === handed.signal.reason) throw error;
    throw new InjectedFetchError(error);
  }
  if (!(response instanceof Response)) throw new InvalidInjectedResponseError("not-a-response");
  if (
    request.redirect !== "follow" &&
    (response.redirected || (response.url !== "" && !sameDocument(response.url, request.url)))
  )
    throw new InvalidInjectedResponseError("redirected");
  return await bounded(response, request.signal);
}
