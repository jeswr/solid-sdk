// AUTHORED-BY Codex GPT-6.1-Sol
import { isWithinPodScope } from "@jeswr/guarded-fetch";
import { createNodeGuardedFetch, refuseRedirects } from "@jeswr/guarded-fetch/node";
import { forClientCredentials } from "@jeswr/pod-auth/node";
import { createSolidMcpServer, createStoragePodPort, normalizePodRoot } from "@jeswr/solid-mcp";
import { createMcpHttpHandler } from "@jeswr/solid-mcp/http";
import { withCssCompatibility } from "./pod.js";
import { equalSecret, publicOrigin, secureResponse } from "./security.js";

export interface SingleUserOptions {
  publicOrigin: string;
  accessToken: string;
  credentials: { issuer: string; id: string; secret: string };
  podRoot: string;
  webId: string;
  readOnly?: boolean;
  allowedOrigins?: readonly string[];
  upstreamFetch?: typeof fetch;
  allowInsecureLoopback?: boolean;
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
      createNodeGuardedFetch({
        allowLoopback: options.allowInsecureLoopback === true,
        maxBytes: 1024 * 1024,
        timeoutMs: 8_000,
        maxRedirects: 0,
      }),
  );
  const issuer = new URL(credentials.issuer);
  publicOrigin(issuer.origin);
  const auth = await forClientCredentials({
    issuer: credentials.issuer,
    clientId: credentials.id,
    clientSecret: credentials.secret,
    boundary: [podRoot],
    allowInsecureLoopback: options.allowInsecureLoopback,
    fetch: transport,
  });
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, { ...init, redirect: "manual", credentials: "omit" });
    const profile = new URL(options.webId);
    profile.hash = "";
    const outside = !isWithinPodScope(podRoot, request.url);
    if (outside && (request.url !== profile.href || request.method !== "GET"))
      throw new Error("Outside pod scope");
    for (const name of ["authorization", "dpop", "cookie"])
      if (request.headers.has(name)) throw new Error("Caller credentials refused");
    // Off-pod discovery never carries service credentials.
    return outside ? transport(request) : auth.fetch(request);
  };
  const compatible = withCssCompatibility(fetcher);
  const pod = createStoragePodPort(
    {
      fetch: compatible,
      podRoot,
      webId: options.webId,
      readOnly: options.readOnly !== false,
    },
    transport,
  );
  const http = createMcpHttpHandler({
    resourceUrl: `${origin.origin}/mcp`,
    allowedOrigins: options.allowedOrigins ?? [],
    authenticate: (request) =>
      equalSecret(request.headers.get("authorization") ?? "", `Bearer ${options.accessToken}`),
    server: () =>
      createSolidMcpServer({
        fetch: compatible,
        pod,
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
