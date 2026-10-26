// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope, refuseRedirects } from "@jeswr/guarded-fetch";
import { createSession, discoveryUrl, type FetchLike, rdfFetchFor } from "@jeswr/solid-dpop";
import type { NodeConfig } from "./config.js";
import { httpsUrl, NodeRuntimeError, object, textValue } from "./errors.js";

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
        const response = await fetchSafe(url);
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
    const podTransport: FetchLike = async (url, init) => {
      if (url !== config.profileDocumentUrl) assertWithinPodScope(config.podRoot, url);
      return fetchSafe(url, init as RequestInit);
    };
    // Token refresh uses the same guarded discovery/exchange path, while resource I/O
    // stays inside the explicit Pod scope (plus the canonical profile document).
    const combined: FetchLike = (url, init) =>
      url === discovery || url === tokenEndpoint
        ? authTransport(url, init)
        : podTransport(url, init);
    const authenticated = rdfFetchFor(session, credentials, combined);
    return async (input, init) => {
      const request = new Request(input, init);
      if (request.url !== config.profileDocumentUrl)
        assertWithinPodScope(config.podRoot, request.url);
      const body = request.body ? new Uint8Array(await request.arrayBuffer()) : undefined;
      return authenticated(request.url, {
        method: request.method,
        headers: request.headers,
        body: body as BodyInit | undefined,
      });
    };
  } catch {
    throw new NodeRuntimeError("auth", "Pod client-credentials login failed.");
  }
}
