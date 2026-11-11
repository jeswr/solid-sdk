// AUTHORED-BY Codex GPT-6.1-Sol
import {
  assertWithinPodScope,
  isWithinPodScope,
  refuseRedirects,
  snapshotFetchInput,
} from "@jeswr/guarded-fetch";
import { forClientCredentials, type PodAuth } from "@jeswr/pod-auth/node";
import { abortableFetch } from "../core/abort.js";
import { freshRdf } from "../pod/rdf-read.js";
import { validatedTypeIndexTarget } from "../pod/type-index-write.js";
import type { NodeConfig } from "./config.js";
import { httpsUrl, NodeRuntimeError, object, textValue } from "./errors.js";

/** Buffer a replayable body for nonce retries, observing the effective caller signal. */
async function readRequestBody(
  request: Request,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<Uint8Array | undefined> {
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
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new Error("Body exceeds its byte limit");
      }
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

/**
 * Adapt the CLI's explicit token endpoint and profile-selected cross-storage index policy.
 * pod-auth owns credentials, DPoP, refresh, nonce handling and request replay.
 */
export async function createClientCredentialsFetch(
  config: NodeConfig,
  transport: typeof fetch,
): Promise<typeof fetch> {
  try {
    httpsUrl(config.oidcIssuer);
    httpsUrl(config.profileDocumentUrl);
    httpsUrl(config.podRoot);
    if (config.tokenUrl !== undefined) httpsUrl(config.tokenUrl);
    const discovery = new URL(config.oidcIssuer);
    discovery.pathname = `${discovery.pathname.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const discoveryUrl = discovery.href;
    let tokenEndpoint = config.tokenUrl;
    let metadata: Record<string, unknown> | undefined = config.tokenUrl
      ? { issuer: config.oidcIssuer, token_endpoint: config.tokenUrl }
      : undefined;
    let selectedIndex: string | undefined;
    let indexAuth: Promise<PodAuth> | undefined;
    let profileEpoch = 0;
    const fetchSafe = refuseRedirects(transport);
    const assertDestination = (url: string) => {
      if (url !== config.profileDocumentUrl && url !== selectedIndex)
        assertWithinPodScope(config.podRoot, url);
    };
    const boundedJson = async (url: string, response: Response, signal: AbortSignal) => {
      if (Number(response.headers.get("content-length")) > 1024 * 1024) {
        void response.body?.cancel().catch(() => {});
        throw new Error("Protocol response exceeds its byte limit");
      }
      const request = new Request(url, {
        method: "POST",
        body: response.body,
        signal,
        ...(response.body ? { duplex: "half" } : {}),
      });
      return object(
        JSON.parse(new TextDecoder().decode(await readRequestBody(request, 1024 * 1024))),
      );
    };
    const guarded: typeof fetch = async (input, init) => {
      const snapshot = snapshotFetchInput(input, init);
      const request =
        typeof snapshot.input === "string"
          ? new Request(snapshot.input, snapshot.init)
          : snapshot.input;
      const url = request.url;
      request.signal.throwIfAborted();
      if (url === discoveryUrl && metadata) return Response.json(metadata);
      const protocol = url === discoveryUrl || url === tokenEndpoint;
      if (!protocol) {
        assertDestination(url);
        // The CLI has explicitly established this service identity. Let pod-auth upgrade
        // its request before dispatch instead of sending unauthenticated write probes.
        if (!request.headers.has("authorization"))
          return new Response(null, { status: 401, headers: { "www-authenticate": "DPoP" } });
      }
      const bytes = await readRequestBody(request);
      const response = await fetchSafe(url, {
        method: request.method,
        headers: request.headers,
        body:
          bytes === undefined
            ? undefined
            : protocol
              ? new TextDecoder().decode(bytes)
              : (bytes as Uint8Array<ArrayBuffer>),
        signal: request.signal,
        redirect: "manual",
        cache: "no-cache",
      });
      request.signal.throwIfAborted();
      if (!protocol) {
        if (
          response.status === 401 &&
          response.headers.has("dpop-nonce") &&
          !response.headers.has("www-authenticate")
        ) {
          const headers = new Headers(response.headers);
          headers.set("www-authenticate", 'DPoP error="use_dpop_nonce"');
          return new Response(response.body, { status: response.status, headers });
        }
        return response;
      }
      if (url === discoveryUrl && !response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new Error("Discovery failed");
      }
      const json = await boundedJson(url, response, request.signal);
      if (url === discoveryUrl) {
        if (json.issuer !== config.oidcIssuer) throw new Error("Issuer mismatch");
        tokenEndpoint = httpsUrl(json.token_endpoint);
        metadata = json;
      } else if (response.ok) {
        textValue(json.access_token);
        if (
          typeof json.token_type !== "string" ||
          json.token_type.toLowerCase() !== "dpop" ||
          (json.expires_in !== undefined &&
            (typeof json.expires_in !== "number" ||
              !Number.isFinite(json.expires_in) ||
              json.expires_in <= 0))
        )
          throw new Error("Invalid DPoP token");
      }
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return Response.json(json, { status: response.status, headers });
    };
    const login = (boundary: string[], signal?: AbortSignal) =>
      forClientCredentials({
        issuer: config.oidcIssuer,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        boundary,
        fetch: signal ? abortableFetch(guarded, signal) : guarded,
      });
    const auth = await login([config.podRoot, config.profileDocumentUrl]);
    return async (input, init) => {
      const snapshot = snapshotFetchInput(input, init);
      const request =
        typeof snapshot.input === "string"
          ? new Request(snapshot.input, snapshot.init)
          : snapshot.input;
      request.signal.throwIfAborted();
      const url = request.url;
      assertDestination(url);
      const profileRead = url === config.profileDocumentUrl && request.method === "GET";
      if (profileRead) {
        selectedIndex = undefined;
        indexAuth = undefined;
        ++profileEpoch;
      }
      const epoch = profileEpoch;
      // pod-auth's static boundary is immutable. Grant only the validated document in a
      // separate memory-only agent, never the other storage's root or issuer origin.
      let selected = auth;
      if (url === selectedIndex && !isWithinPodScope(config.podRoot, url)) {
        indexAuth ??= login([url], request.signal);
        selected = await indexAuth;
      }
      request.signal.throwIfAborted();
      assertDestination(url);
      const headers = new Headers(request.headers);
      headers.delete("authorization");
      headers.delete("dpop");
      // Immutable binary bodies replay without pod-auth buffering them again.
      const suppliedBody = snapshot.init?.body;
      const response = await selected.fetch(request, {
        headers,
        ...(suppliedBody instanceof Blob ? { body: suppliedBody } : {}),
      });
      if (profileRead && response.ok) {
        const { dataset } = await freshRdf(url, async () => response.clone());
        request.signal.throwIfAborted();
        const index = httpsUrl(
          validatedTypeIndexTarget(config.webId, dataset, config.podRoot).indexUrl,
        );
        if (epoch === profileEpoch) selectedIndex = index;
      }
      return response;
    };
  } catch {
    throw new NodeRuntimeError("auth", "Pod client-credentials login failed.");
  }
}
