// AUTHORED-BY Codex GPT-6.1-Sol
import { isWithinPodScope } from "@jeswr/guarded-fetch";
import { createNodeGuardedFetch, refuseRedirects } from "@jeswr/guarded-fetch/node";
import {
  authedFetch,
  type ClientCredentials,
  createSession,
  type FetchLike,
} from "@jeswr/solid-dpop";
import { createSolidMcpServer, normalizePodRoot } from "@jeswr/solid-mcp";
import { createMcpHttpHandler } from "@jeswr/solid-mcp/http";
import { equalSecret, publicOrigin, secureResponse } from "./security.js";

export interface SingleUserOptions {
  publicOrigin: string;
  accessToken: string;
  credentials: ClientCredentials;
  podRoot: string;
  webId: string;
  readOnly?: boolean;
  allowedOrigins?: readonly string[];
  upstreamFetch?: typeof fetch;
}

/** Explicit service-account mode; a separate operator bearer protects the MCP endpoint. */
export async function createSingleUserApp(options: SingleUserOptions) {
  const origin = publicOrigin(options.publicOrigin);
  if (!/^[A-Za-z0-9_-]{43,}$/.test(options.accessToken))
    throw new Error("MCP_ACCESS_TOKEN must be a random base64url secret of at least 32 bytes");
  const podRoot = normalizePodRoot(options.podRoot);
  const credentials = { ...options.credentials };
  const transport = refuseRedirects(
    options.upstreamFetch ??
      createNodeGuardedFetch({ maxBytes: 1024 * 1024, timeoutMs: 8_000, maxRedirects: 0 }),
  );
  const issuer = new URL(credentials.issuer);
  publicOrigin(issuer.origin);
  const exchange: FetchLike = async (url, init) => {
    const response = await transport(url, init as RequestInit);
    if (!init?.method && response.ok) {
      const body = (await response.json()) as { issuer?: string; token_endpoint?: string };
      if (body?.issuer !== credentials.issuer || typeof body.token_endpoint !== "string")
        throw new Error("Issuer mismatch");
      const endpoint = new URL(body.token_endpoint);
      publicOrigin(endpoint.origin);
      if (endpoint.username || endpoint.password || endpoint.hash)
        throw new Error("Invalid token endpoint");
      return Response.json(body);
    }
    return response;
  };
  const session = await createSession(credentials, exchange);
  // Serialize token renewal; all requests keep the same in-memory DPoP key.
  let tail: Promise<unknown> = Promise.resolve();
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const profile = new URL(options.webId);
    profile.hash = "";
    if (
      !isWithinPodScope(podRoot, request.url) &&
      (request.url !== profile.href || request.method !== "GET")
    )
      throw new Error("Outside pod scope");
    for (const name of ["authorization", "dpop", "cookie"])
      if (request.headers.has(name)) throw new Error("Caller credentials refused");
    const body = request.body ? new Uint8Array(await request.arrayBuffer()) : undefined;
    const run = tail.then(() =>
      authedFetch(
        session,
        credentials,
        request.method,
        request.url,
        { headers: Object.fromEntries(request.headers), body },
        exchange,
      ),
    );
    tail = run.catch(() => {});
    return run;
  };
  const http = createMcpHttpHandler({
    resourceUrl: `${origin.origin}/mcp`,
    allowedOrigins: options.allowedOrigins ?? [],
    authenticate: (request) =>
      equalSecret(request.headers.get("authorization") ?? "", `Bearer ${options.accessToken}`),
    server: () =>
      createSolidMcpServer({
        fetch: fetcher,
        podRoot,
        webId: options.webId,
        readOnly: options.readOnly !== false,
        clientInfo: { clientId: `${origin.origin}/clients/single-user` },
      }),
  });
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (
        url.host !== origin.host ||
        (request.headers.has("host") && request.headers.get("host") !== origin.host)
      )
        return secureResponse(new Response(null, { status: 403 }));
      if (url.pathname === "/healthz" && request.method === "GET")
        return secureResponse(Response.json({ status: "ok" }));
      return secureResponse(
        url.pathname === "/mcp" ? await http(request) : new Response(null, { status: 404 }),
      );
    } catch {
      return secureResponse(Response.json({ error: "server_error" }, { status: 500 }));
    }
  };
}
