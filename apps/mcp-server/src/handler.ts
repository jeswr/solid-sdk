// AUTHORED-BY Codex GPT-6.1-Sol
import { randomBytes } from "node:crypto";
import {
  type ConsentContext,
  createAuthorizationServer,
  createPodSessionProvider,
  type PodSession,
  type PodSessionProvider,
  type SessionVault,
  type SigningKey,
} from "@jeswr/mcp-oauth";
import { createSolidMcpServer } from "@jeswr/solid-mcp";
import { createMcpHttpHandler } from "@jeswr/solid-mcp/http";
import { createVaultOAuthStores, decode, digest, encode, vaultSigningKey } from "./persistence.js";
import { podLoginFor, podRootFor, withCssCompatibility } from "./pod.js";
import { equalSecret, escapeHtml, form, page, publicOrigin, secureResponse } from "./security.js";

export interface AppOptions {
  publicOrigin: string;
  vault: SessionVault;
  allowedOrigins?: readonly string[];
  readOnly?: boolean;
  podSessions?: PodSessionProvider;
  signingKey?: SigningKey;
  /** Trusted bounded DNS-pinning transport; CSS tests inject loopback-only fetch. */
  upstreamFetch?: typeof fetch;
  metadataFetch?: typeof fetch;
  now?: () => number;
}

interface BrowserFlow {
  phase: "login" | "starting" | "pending" | "completing" | "consent" | "consumed";
  expiresAt: number;
  csrf: string;
  authorizationUrl: string;
  state?: string;
  expectedWebId?: string;
  session?: PodSession;
  clientId?: string;
  clientName?: string;
  scope?: string;
}
const opaque = () => randomBytes(32).toString("base64url");
const failure = (status = 400) => Response.json({ error: "invalid_request" }, { status });

/** Node and Vercel share this Web handler. Mutable state is atomic and vault-backed. */
export async function createApp(
  options: AppOptions,
): Promise<(request: Request) => Promise<Response>> {
  const origin = publicOrigin(options.publicOrigin);
  if (origin.protocol !== "https:") throw new Error("OAuth mode requires an HTTPS public origin");
  const issuer = `${origin.origin}/auth`;
  const resource = `${origin.origin}/mcp`;
  const callback = `${issuer}/callback`;
  const clientId = `${origin.origin}/client-id.jsonld`;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const vault = options.vault;
  const stores = createVaultOAuthStores(vault, issuer);
  const signingKey = options.signingKey ?? (await vaultSigningKey(vault, issuer));
  const sessions =
    options.podSessions ??
    createPodSessionProvider({
      clientId,
      redirectUri: callback,
      vault,
      fetch: options.upstreamFetch,
      now,
    });
  const cookieName = origin.protocol === "https:" ? "__Host-mcp-flow" : "mcp-flow";
  const cookie = (id: string, age = 600) =>
    `${cookieName}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${origin.protocol === "https:" ? "; Secure" : ""}`;
  const flowKey = (id: string) => `browser:${digest(issuer)}:${digest(id)}`;
  const csrfInput = (flow: BrowserFlow) =>
    `<input type="hidden" name="csrf" value="${escapeHtml(flow.csrf)}">`;
  const as = (consent: (context: ConsentContext) => Promise<boolean>, provider = sessions) =>
    createAuthorizationServer({
      issuer,
      resource,
      podSessions: provider,
      stores,
      signingKey,
      scopes: ["mcp"],
      consent,
      metadataFetch: options.metadataFetch,
      now,
    });
  const oauth = as(async () => false);
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const publicOAuthMethods = new Map([
    ["/.well-known/oauth-authorization-server/auth", "GET"],
    ["/.well-known/oauth-protected-resource/mcp", "GET"],
    ["/auth/jwks", "GET"],
    ["/auth/register", "POST"],
    ["/auth/token", "POST"],
    ["/auth/revoke", "POST"],
  ]);
  const http = createMcpHttpHandler({
    resourceUrl: resource,
    resourceMetadataUrl: oauth.protectedResourceMetadataUrl(),
    allowedOrigins: options.allowedOrigins ?? [],
    authenticate: async (request) => {
      const token = request.headers
        .get("authorization")
        ?.match(/^Bearer ([A-Za-z0-9._~-]+)$/i)?.[1];
      return token ? oauth.verifyAccessToken(token, resource) : null;
    },
    server: async (principal) => {
      const fetcher = withCssCompatibility(await sessions.fetchFor(principal.sessionId));
      const podRoot = await podRootFor(principal.webId, options.upstreamFetch);
      // This constructor creates a scoped FetchPodPort and the chat tools.
      // No MCP headers or caller-selected identity enter the pod capability.
      return createSolidMcpServer({
        fetch: fetcher,
        podRoot,
        webId: principal.webId,
        readOnly: options.readOnly !== false,
        clientInfo: { clientId: provenanceId(principal.clientId, origin.origin) },
      });
    },
  });
  async function load(request: Request) {
    const cookies = (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${cookieName}=`));
    if (cookies.length !== 1) throw new Error("Missing browser binding");
    const id = cookies[0]?.slice(cookieName.length + 1) ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error("Invalid browser binding");
    const key = flowKey(id);
    const bytes = await vault.get(key);
    if (!bytes) throw new Error("Unknown browser flow");
    const flow = decode<BrowserFlow>(bytes);
    if (flow.expiresAt <= now()) {
      await vault.delete(key);
      if (flow.session) await sessions.revoke(flow.session.id);
      throw new Error("Expired browser flow");
    }
    return { key, bytes, flow };
  }
  async function transition(
    key: string,
    bytes: Uint8Array | undefined,
    flow: BrowserFlow,
  ): Promise<void> {
    if (!(await vault.compareAndSwap(key, bytes, encode(flow))))
      throw new Error("Browser flow already used");
  }
  async function dispatch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // TLS proxies may use an http URL internally; the public authority stays fixed.
    if (
      url.host !== origin.host ||
      (request.headers.has("host") && request.headers.get("host") !== origin.host)
    )
      return failure(403);
    if (url.pathname === "/healthz")
      return request.method === "GET" ? Response.json({ status: "ok" }) : failure(405);
    if (url.pathname === "/client-id.jsonld")
      return request.method === "GET"
        ? Response.json(
            {
              "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
              client_id: clientId,
              client_name: "Solid MCP",
              client_uri: `${origin.origin}/`,
              redirect_uris: [callback],
              scope: "openid webid offline_access",
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              token_endpoint_auth_method: "none",
            },
            { headers: { "content-type": "application/ld+json" } },
          )
        : failure(405);
    if (url.pathname === "/mcp") return http(request);
    const oauthMethod = publicOAuthMethods.get(url.pathname);
    if (oauthMethod) {
      const requestOrigin = request.headers.get("origin");
      if (
        requestOrigin !== null &&
        requestOrigin !== origin.origin &&
        !allowedOrigins.has(requestOrigin)
      )
        return failure(403);
      let response: Response;
      if (request.method === "OPTIONS") {
        if (
          requestOrigin === null ||
          request.headers.get("access-control-request-method") !== oauthMethod
        )
          return failure(405);
        response = new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Methods": `${oauthMethod}, OPTIONS`,
            "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version",
          },
        });
      } else {
        response = await oauth.handle(
          new Request(`${origin.origin}${url.pathname}${url.search}`, request),
        );
      }
      response.headers.set("Vary", "Origin");
      if (requestOrigin !== null && allowedOrigins.has(requestOrigin))
        response.headers.set("Access-Control-Allow-Origin", requestOrigin);
      return response;
    }
    if (url.pathname === "/auth/authorize" && request.method === "GET") {
      if (url.search.length > 16_384) return failure(414);
      const authorizationUrl = new URL(`${issuer}/authorize`);
      authorizationUrl.search = url.search;
      authorizationUrl.searchParams.delete("webid");
      const flow: BrowserFlow = {
        phase: "login",
        csrf: opaque(),
        expiresAt: now() + 600,
        authorizationUrl: authorizationUrl.href,
      };
      const id = opaque();
      await transition(flowKey(id), undefined, flow);
      const response = page(
        "Connect your Solid pod",
        `<form method="post" action="/auth/login">${csrfInput(flow)}<label>WebID or issuer <input name="webid" type="url" required autocomplete="url"></label><button type="submit">Log in</button></form>`,
      );
      response.headers.set("set-cookie", cookie(id));
      return response;
    }
    if (
      (url.pathname === "/auth/login" || url.pathname === "/auth/consent") &&
      request.method === "POST"
    ) {
      if (request.headers.get("origin") !== origin.origin) return failure(403);
      const fields = await form(request);
      const { key, bytes, flow } = await load(request);
      if (!equalSecret(fields.get("csrf") ?? "", flow.csrf)) return failure(403);
      if (url.pathname === "/auth/login") {
        if (flow.phase !== "login" || !fields.get("webid")) return failure();
        const starting = { ...flow, phase: "starting" as const };
        await transition(key, bytes, starting);
        let state: string | undefined;
        let expectedWebId: string | undefined;
        const provider: PodSessionProvider = {
          ...sessions,
          async begin(webid, redirect) {
            const login = await podLoginFor(webid, options.upstreamFetch);
            expectedWebId = login.expectedWebId;
            const result = await sessions.begin(login.issuer, redirect);
            state = result.state;
            return result;
          },
        };
        const login = new URL(flow.authorizationUrl);
        login.searchParams.set("webid", fields.get("webid") as string);
        const response = await as(async () => false, provider).handle(new Request(login));
        if (!state || response.status !== 302) {
          await vault.delete(key);
          return response;
        }
        await transition(key, encode(starting), {
          ...flow,
          phase: "pending",
          state,
          expectedWebId,
        });
        return response;
      }
      if (
        flow.phase !== "consent" ||
        !flow.session ||
        !["allow", "deny"].includes(fields.get("decision") ?? "")
      )
        return failure();
      await transition(key, bytes, { ...flow, phase: "consumed", session: undefined });
      const allowed = fields.get("decision") === "allow";
      try {
        const response = await as(async () => allowed).authorize(
          new Request(flow.authorizationUrl),
          flow.session,
        );
        if (
          !allowed ||
          !new URL(response.headers.get("location") as string).searchParams.has("code")
        )
          await sessions.revoke(flow.session.id);
        response.headers.set("set-cookie", cookie("", 0));
        return response;
      } catch {
        await sessions.revoke(flow.session.id);
        throw new Error("Consent completion failed");
      } finally {
        await vault.delete(key);
      }
    }
    if (url.pathname === "/auth/callback" && request.method === "GET") {
      const { key, bytes, flow } = await load(request);
      if (
        flow.phase !== "pending" ||
        !flow.state ||
        url.searchParams.getAll("state").length !== 1 ||
        !equalSecret(url.searchParams.get("state") ?? "", flow.state)
      )
        return failure();
      const completing = { ...flow, phase: "completing" as const };
      await transition(key, bytes, completing);
      let context: ConsentContext | undefined;
      // A false decision creates no grant. Only the later browser approval POST
      // may call the trusted authorize seam with the verified server-side session.
      const response = await as(async (validated) => {
        if (flow.expectedWebId && validated.session.webId !== flow.expectedWebId) {
          await sessions.revoke(validated.session.id);
          return false;
        }
        context = validated;
        return false;
      }).handle(new Request(`${callback}${url.search}`));
      if (!context) {
        await vault.delete(key);
        return response;
      }
      const validated = context as ConsentContext;
      const consent: BrowserFlow = {
        ...flow,
        phase: "consent",
        session: validated.session,
        clientId: validated.client.client_id,
        clientName: validated.client.client_name,
        scope: validated.authorization.scope,
        csrf: opaque(),
      };
      try {
        await transition(key, encode(completing), consent);
      } catch {
        await sessions.revoke(validated.session.id);
        throw new Error("Consent persistence failed");
      }
      return page(
        "Allow pod access?",
        `<p>Client: ${escapeHtml(consent.clientName ?? consent.clientId ?? "")}</p><p>Client ID: ${escapeHtml(consent.clientId ?? "")}</p><p>Pod owner: ${escapeHtml(validated.session.webId)}</p><p>Access: ${options.readOnly !== false ? "read only" : "read and write"}. Scope: ${escapeHtml(consent.scope ?? "")}. Personal data remains subject to your pod policy.</p><form method="post" action="/auth/consent">${csrfInput(consent)}<button name="decision" value="allow">Allow</button><button name="decision" value="deny">Deny</button></form>`,
      );
    }
    if (
      ["/auth/authorize", "/auth/login", "/auth/callback", "/auth/consent"].includes(url.pathname)
    )
      return failure(405);
    return oauth.handle(new Request(`${origin.origin}${url.pathname}${url.search}`, request));
  }
  return async (request) => {
    try {
      const response = await dispatch(request);
      // form-action 'self' can constrain cross-origin redirects after form POSTs.
      // Native navigation preserves the strict CSP without any inline script.
      if (
        request.method === "POST" &&
        ["/auth/login", "/auth/consent"].includes(new URL(request.url).pathname) &&
        response.status === 302
      ) {
        const destination = response.headers.get("location");
        if (!destination) throw new Error("Missing trusted redirect");
        const label =
          new URL(request.url).pathname === "/auth/login"
            ? "Continue to your Solid identity provider"
            : "Return to the MCP client";
        const navigation = page(
          label,
          `<p><a href="${escapeHtml(destination)}" rel="noopener noreferrer">${label}</a></p>`,
        );
        for (const cookie of response.headers.getSetCookie())
          navigation.headers.append("set-cookie", cookie);
        return secureResponse(navigation);
      }
      return secureResponse(response);
    } catch {
      return secureResponse(failure());
    }
  };
}

function provenanceId(clientId: string, origin: string): string {
  try {
    return new URL(clientId).href;
  } catch {
    return `${origin}/clients/${encodeURIComponent(clientId)}`;
  }
}

let configured: Promise<(request: Request) => Promise<Response>> | undefined;
/** Lazy environment composition for the Node entry and Vercel Node Web handler. */
export async function handler(request: Request): Promise<Response> {
  try {
    configured ??= import("./config.js").then(({ appFromEnvironment }) => appFromEnvironment());
    return await (await configured)(request);
  } catch {
    configured = undefined;
    return secureResponse(Response.json({ error: "service_unavailable" }, { status: 503 }));
  }
}
export default handler;
