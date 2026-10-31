// AUTHORED-BY Codex GPT-6.1-Sol
import {
  CachingAuthorizationServerProvider,
  CachingClientProvider,
  CachingIssuerProvider,
  type Identity as Claims,
  ClientIdClientProvider,
  type CodeProvider,
  type ContextKey,
  type CredentialRequest,
  type CredentialSource,
  createBrowserCaches,
  DPoPTokenProvider,
  DynamicRegistrationClientProvider,
  HintIssuerProvider,
  type HttpOptions,
  LwsTokenProvider,
  nonReactiveFetch,
  OidcIdTokenSource,
  ReactiveFetchManager,
  SessionFence,
  SolidUmaTokenProvider,
  type TokenProvider,
  WebIdIssuerProvider,
  XASProvider,
} from "@jeswr/reactive-authentication";
import { createBoundary } from "./boundary.js";
import { scopedStore } from "./kv.js";
import { secureUrl } from "./options.js";
import type { LoginHint, PodAuthOptions } from "./types.js";

export class AmbiguousIssuerError extends Error {
  constructor() {
    super("WebID lists several issuers; supply ui.chooseIssuer");
    this.name = "AmbiguousIssuerError";
  }
}

export function createProviders(
  options: PodAuthOptions,
  hooks: {
    challenge(url: string): void;
    session(request: Request, claims: Claims, protocol: "solid-oidc" | "lws"): Promise<void>;
  },
) {
  const transport = nonReactiveFetch();
  const insecure = options.allowInsecureLoopback === true;
  // Enforce loopback on EVERY protocol hop, even after discovery. Never broaden the engine's HTTP flag.
  const http: HttpOptions = {
    allowInsecureRequests: insecure,
    fetch: (input, init) => {
      const request = new Request(input, init);
      secureUrl(request.url, insecure, "protocol endpoint");
      return transport(request);
    },
  };
  const boundary = createBoundary(options, http);
  const namespace = JSON.stringify(["pod-auth", options.clientId, options.redirectUri]);
  const browser =
    options.storage === undefined && typeof indexedDB !== "undefined"
      ? createBrowserCaches(namespace, { persistSessions: true })
      : undefined;
  const fence =
    options.storage === undefined
      ? (browser?.fence ?? new SessionFence(namespace, { broadcast: false }))
      : new SessionFence(namespace, {
          store: scopedStore<number>(options.storage.sessions, "pod-auth:fence:" + namespace),
        });
  const metadata = <T extends {}>(name: string) =>
    options.storage === undefined
      ? undefined
      : scopedStore<T>(options.storage.caches, namespace + ":" + name);
  let hint: LoginHint = {};
  let sessionRequest: Request | undefined;
  const getWebId = async () =>
    secureUrl(hint.webId ?? (await options.ui.getWebId()), insecure, "WebID");
  const webIdProvider = new WebIdIssuerProvider(getWebId, http, async (issuers) => {
    let selected: string;
    if (hint.issuer !== undefined) selected = hint.issuer;
    else if (issuers.length === 1) selected = issuers[0]!.href;
    else if (options.ui.chooseIssuer)
      selected = await options.ui.chooseIssuer(issuers.map((i) => i.href));
    else throw new AmbiguousIssuerError();
    const result = secureUrl(selected, insecure, "issuer");
    if (!issuers.some((i) => i.href === result.href))
      throw new Error("Selected issuer is not listed by the WebID");
    return result;
  });
  // An unsuccessful attempt must not pin later login hints to its cached issuer.
  const issuerContext: ContextKey = async (request, challenge) =>
    JSON.stringify([
      await boundary.contextKey(request, challenge),
      hint.webId ?? null,
      hint.issuer ?? null,
    ]);
  const issuerProvider = new CachingIssuerProvider(
    {
      getIssuer: async (request, challenge) => {
        const hinted = new HintIssuerProvider(
          hint.webId === undefined && hint.issuer !== undefined
            ? { issuer: new URL(hint.issuer) }
            : {},
          webIdProvider,
          async () => true,
        );
        return hinted.getIssuer(request, challenge);
      },
    },
    metadata("issuer") ?? browser?.issuer,
    issuerContext,
  );
  const asProvider = new CachingAuthorizationServerProvider(
    new XASProvider(issuerProvider, http),
    metadata("as") ?? browser?.authorizationServer,
    issuerContext,
  );
  // Client registrations can contain secrets and always stay in memory.
  const clientProvider = new CachingClientProvider(
    typeof options.clientId === "string"
      ? new ClientIdClientProvider(new URL(options.clientId), http)
      : new DynamicRegistrationClientProvider(http),
  );
  const codeProvider: CodeProvider = {
    getCode: async (url, signal) => {
      secureUrl(url.href, insecure, "authorization endpoint");
      const value = await options.ui.getCode(url, signal);
      signal.throwIfAborted();
      return {
        value,
        [Symbol.dispose]() {
          /* UI hook owns its popup/redirect cleanup. */
        },
      };
    },
  };
  const sessionOptions = {
    namespace,
    fence,
    http,
    context: boundary.contextKey,
    scopes: ["openid", "webid"],
    serverQuirks: true,
    verifyWebId: true,
    ...(options.storage === undefined
      ? browser?.sessions === undefined
        ? {}
        : { sessionStore: browser.sessions }
      : {
          sessionStore: scopedStore<import("@jeswr/reactive-authentication").RefreshSessionRecord>(
            options.storage.sessions,
            namespace + ":sessions",
          ),
        }),
  };
  const solidProvider = new DPoPTokenProvider(
    options.redirectUri,
    codeProvider,
    asProvider,
    clientProvider,
    undefined,
    sessionOptions,
  );
  const umaProvider = new SolidUmaTokenProvider(
    options.redirectUri,
    codeProvider,
    asProvider,
    clientProvider,
    { ...sessionOptions, session: solidProvider.session },
  );
  const source: CredentialSource = {
    id: namespace,
    fence,
    getCredential: async (request: CredentialRequest) => {
      const target = sessionRequest ?? new Request(request.resource, { signal: request.signal });
      const as = await asProvider.getAuthorizationServer(target);
      const context = await boundary.contextKey(target);
      const oidc = new OidcIdTokenSource(as, options.redirectUri, codeProvider, clientProvider, {
        ...sessionOptions,
        session: solidProvider.session,
        context,
      });
      const credential = await oidc.getCredential(request);
      sessionRequest = target;
      return credential;
    },
  };
  const lwsProvider = new LwsTokenProvider(source, { http, fence });
  const observe = (
    provider: TokenProvider,
    protocol: "solid-oidc" | "lws",
    solid = false,
  ): TokenProvider => ({
    fence,
    matches: async (request, challenge) => {
      // The imported DPoP matcher is broad; LWS/UMA challenges belong to their own providers.
      if (
        solid &&
        challenge?.challenges.some(
          (c) =>
            c.scheme === "uma" ||
            (c.scheme === "bearer" && ("resource_metadata" in c.params || "as_uri" in c.params)),
        )
      )
        return false;
      if (!(await provider.matches(request, challenge))) return false;
      hooks.challenge(request.url);
      return true;
    },
    upgrade: async (request, challenge) => {
      const upgraded = await provider.upgrade(request, challenge);
      const target = protocol === "lws" ? sessionRequest! : request;
      const claims = await solidProvider.identity(target);
      if (claims === undefined) throw new Error("Authentication did not establish an identity");
      await hooks.session(request, claims, protocol);
      sessionRequest = target;
      return upgraded;
    },
    invalidate: async (request, challenge) => await provider.invalidate!(request, challenge),
    forget: async () => await provider.forget!(),
  });
  const manager = new ReactiveFetchManager({
    providers: [
      observe(solidProvider, "solid-oidc", true),
      observe(umaProvider, "solid-oidc"),
      observe(lwsProvider, "lws"),
    ],
    boundary,
    fetch: transport,
    fence,
  });
  return {
    manager,
    boundary,
    solidProvider,
    login: async (value: LoginHint) => {
      hint = value;
      // A synthetic upgrade obtains a session without sending credentials to a login hint's URL.
      const request = new Request(boundary.roots()[0] ?? options.redirectUri);
      await solidProvider.upgrade(request);
      const claims = await solidProvider.identity(request);
      if (claims === undefined) throw new Error("Login did not establish an identity");
      await hooks.session(request, claims, "solid-oidc");
      sessionRequest = request;
    },
  };
}
