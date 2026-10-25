// Shared in-page harness code (bundled into each SDK page). The library runs in the page exactly as an
// application wires it; the harness only records safe facts. Nothing returned to the test runner contains a
// token, an authorization response or an identity value: identities leave the page as SHA-256 digests,
// requests as origin/path/status/allowlisted scheme, errors as an allowlisted class name and code (errors.js).
import {
  CredentialBoundary,
  InteractionRequiredError,
  OAuthBearerTokenProvider,
  ReactiveFetchManager,
} from "../../dist/mod.js";
import { errorFacts, schemeFact } from "./errors.js";

export { errorFacts };

/** A non-reactive transport recording scheme names only; the last Bearer token stays in this closure. */
export function recordingFetch(base = globalThis.fetch.bind(globalThis)) {
  const log = [];
  const seen = new Set();
  let last;
  async function fetch(input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const authorization = request.headers.get("authorization") ?? undefined;
    const scheme = authorization?.split(" ", 1)[0];
    if (scheme === "Bearer") {
      last = authorization.slice("Bearer ".length);
      seen.add(last);
    }
    const entry = {
      method: request.method,
      origin: url.origin,
      path: url.pathname,
      scheme: schemeFact(scheme),
      dpop: request.headers.has("dpop"),
      status: undefined,
    };
    log.push(entry);
    const response = await base(request);
    entry.status = response.status;
    return response;
  }
  return {
    fetch,
    log,
    mark: () => log.length,
    /** Distinct Bearer tokens sent so far (a count, never the values). */
    distinctTokens: () => seen.size,
    /** In-page only (never returned to the runner): the token to report as rejected. */
    lastSent: () => last,
    /** Presents the last Bearer token sent, outside the library, to check revocation (the value stays here). */
    replayLast: (url, signal) =>
      last === undefined
        ? undefined
        : base(url, { headers: { authorization: `Bearer ${last}` }, signal }),
    /** Whether `token` was already sent: for renewal checks without handing tokens out. */
    wasSent: (token) => seen.has(token),
  };
}

export async function digest(value) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The resource prefix of an API URL: its origin and path up to the last `/`. */
export function prefixOf(api) {
  const url = new URL(api);
  return `${url.origin}${url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1)}`;
}

/**
 * Wires a source the way the examples do: a Bearer provider limited to the API, and a manager whose boundary
 * also admits the decoy (so only the provider's own resource check can keep credentials away from it).
 * `insecureApi` exists for the offline wiring check against a loopback API; live adapters require https.
 */
export function wire(source, { api, decoy, insecureApi = false }) {
  const recorder = recordingFetch();
  const resources = new CredentialBoundary([prefixOf(api)], { allowInsecureHttp: insecureApi });
  const boundary = new CredentialBoundary(
    [prefixOf(api), ...(decoy === undefined ? [] : [`${new URL(decoy).origin}/`])],
    { allowInsecureHttp: true },
  );
  const manager = new ReactiveFetchManager({
    providers: [new OAuthBearerTokenProvider(source, { resources })],
    boundary,
    fetch: recorder.fetch,
  });
  return { recorder, manager };
}

/** One reactive request to the API: status, the recorded attempts and a digest of the identity field. */
export async function probe({ manager, recorder }, { api, identityField }) {
  const mark = recorder.mark();
  try {
    const response = await manager.fetch(api);
    let identityDigest;
    if (response.headers.get("content-type")?.includes("json")) {
      const value = (await response.json())?.[identityField];
      if (typeof value === "string" && value !== "") identityDigest = await digest(value);
    } else {
      await response.body?.cancel();
    }
    return { status: response.status, identityDigest, attempts: recorder.log.slice(mark) };
  } catch (error) {
    return {
      error: errorFacts(error),
      interactionRequired: error instanceof InteractionRequiredError,
      attempts: recorder.log.slice(mark),
    };
  }
}

/** A request to the decoy through the manager: its status and what was attached. */
export async function probeDecoy({ manager, recorder }, decoy) {
  const mark = recorder.mark();
  try {
    const response = await manager.fetch(new URL("/steal", decoy).href);
    await response.body?.cancel();
    return { status: response.status, attempts: recorder.log.slice(mark) };
  } catch (error) {
    return { error: errorFacts(error), attempts: recorder.log.slice(mark) };
  }
}

/** Polls until the last Bearer token is refused by `api` (revocation can take a moment to propagate). */
export async function lastTokenRefused(recorder, api, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let status;
  while (Date.now() < deadline) {
    const response = await recorder.replayLast(api, AbortSignal.timeout(10_000));
    if (response === undefined) return { status: undefined };
    status = response.status;
    await response.body?.cancel();
    if (status === 401) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { status };
}

/** Binds the `#authorize` button: the click handler calls `start()` synchronously (inside user activation). */
export function bindAuthorizeButton(harness, start) {
  document.querySelector("#authorize").addEventListener("click", () => {
    const activation = navigator.userActivation?.isActive;
    harness.authorization = { done: false, activation };
    let pending;
    try {
      pending = start();
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      () => {
        harness.authorization = { done: true, ok: true, activation };
      },
      (error) => {
        harness.authorization = { done: true, ok: false, activation, error: errorFacts(error) };
      },
    );
  });
}
