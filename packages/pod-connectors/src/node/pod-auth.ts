// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope, refuseRedirects } from "@jeswr/guarded-fetch";
import { createSession, discoveryUrl, type FetchLike, rdfFetchFor } from "@jeswr/solid-dpop";
import { freshRdf } from "../pod/rdf-read.js";
import { validatedTypeIndexTarget } from "../pod/type-index-write.js";
import type { NodeConfig } from "./config.js";
import { httpsUrl, NodeRuntimeError, object, textValue } from "./errors.js";

/** Buffer a replayable body for nonce retries, observing the effective caller signal. */
async function readRequestBody(request: Request): Promise<Uint8Array | undefined> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const signal = request.signal;
  let abort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => {
      reject(signal.reason);
      // Cancellation may itself stall or fail; neither may delay the caller's rejection.
      void reader.cancel(signal.reason).catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await Promise.race([reader.read(), aborted]);
      signal.throwIfAborted();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

/** Create an in-memory DPoP client-credentials session on a dedicated Pod transport. */
export async function createClientCredentialsFetch(
  config: NodeConfig,
  transport: typeof fetch,
): Promise<typeof fetch> {
  const fetchSafe = refuseRedirects(transport);
  // Public callers may construct NodeConfig without going through the file loader.
  try {
    httpsUrl(config.oidcIssuer);
    httpsUrl(config.profileDocumentUrl);
    httpsUrl(config.podRoot);
    if (config.tokenUrl !== undefined) httpsUrl(config.tokenUrl);
  } catch {
    throw new NodeRuntimeError("auth", "Pod client-credentials login failed.");
  }
  const discovery = discoveryUrl(config.oidcIssuer);
  let tokenEndpoint = config.tokenUrl;
  const credentials = {
    issuer: config.oidcIssuer,
    id: config.clientId,
    secret: config.clientSecret,
  };
  const authTransport: FetchLike = async (url, init) => {
    if (url === discovery) {
      if (!tokenEndpoint) {
        const response = await fetchSafe(url, init as RequestInit);
        if (!response.ok) throw new Error("Discovery failed");
        const metadata = object(await response.json());
        if (metadata.issuer !== config.oidcIssuer) throw new Error("Issuer mismatch");
        tokenEndpoint = httpsUrl(metadata.token_endpoint);
      }
      return Response.json({ token_endpoint: tokenEndpoint });
    }
    if (url !== tokenEndpoint) throw new Error("Unexpected authorization endpoint");
    const response = await fetchSafe(url, init as RequestInit);
    if (response.ok) {
      const token = object(await response.clone().json());
      textValue(token.access_token);
      if (
        typeof token.token_type !== "string" ||
        token.token_type.toLowerCase() !== "dpop" ||
        (token.expires_in !== undefined &&
          (typeof token.expires_in !== "number" ||
            !Number.isFinite(token.expires_in) ||
            token.expires_in <= 0))
      )
        throw new Error("Invalid DPoP token");
    }
    return response;
  };
  try {
    const session = await createSession(credentials, authTransport);
    let selectedIndex: string | undefined;
    const assertDestination = (url: string) => {
      if (url !== config.profileDocumentUrl && url !== selectedIndex)
        assertWithinPodScope(config.podRoot, url);
    };
    const podTransport: FetchLike = async (url, init) => {
      assertDestination(url);
      return fetchSafe(url, init as RequestInit);
    };
    // Token refresh uses the same guarded discovery/exchange path, while resource I/O
    // stays inside the explicit Pod scope, canonical profile and validated index document.
    const combined: FetchLike = (url, init) =>
      url === discovery || url === tokenEndpoint
        ? authTransport(url, init)
        : podTransport(url, init);
    return async (input, init) => {
      const request = new Request(input, init);
      request.signal.throwIfAborted();
      assertDestination(request.url);
      const profileRead = request.url === config.profileDocumentUrl && request.method === "GET";
      if (profileRead) selectedIndex = undefined;
      const body = await readRequestBody(request);
      // solid-dpop's fetch adapter does not forward RequestInit.signal. Capture it in
      // this request's transport so refresh and nonce retries share its cancellation,
      // without letting concurrent requests overwrite one another's signal.
      const requestTransport: FetchLike = (url, init) => {
        const internalSignal = (init as RequestInit | undefined)?.signal;
        const requestInit = {
          ...init,
          signal: internalSignal
            ? AbortSignal.any([request.signal, internalSignal])
            : request.signal,
        };
        requestInit.signal.throwIfAborted();
        return combined(url, requestInit);
      };
      const authenticated = rdfFetchFor(session, credentials, requestTransport);
      const response = await authenticated(request.url, {
        method: request.method,
        headers: request.headers,
        body: body as BodyInit | undefined,
      });
      if (profileRead && response.ok) {
        // Parse the authenticated response without another network request. Share the
        // writer's selection and storage validation, granting only this one document.
        const { dataset } = await freshRdf(request.url, async () => response.clone());
        // Node configuration requires HTTPS, including for cross-storage exceptions.
        selectedIndex = httpsUrl(
          validatedTypeIndexTarget(config.webId, dataset, config.podRoot).indexUrl,
        );
      }
      return response;
    };
  } catch {
    throw new NodeRuntimeError("auth", "Pod client-credentials login failed.");
  }
}
