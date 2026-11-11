// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  CachingAuthorizationServerProvider,
  CachingClientProvider,
  CachingIssuerProvider,
  type Identity as Claims,
  ClientCredentialsTokenProvider,
  ClientIdClientProvider,
  type CodeProvider,
  type ContextKey,
  CredentialBoundary,
  type CredentialRequest,
  type CredentialSource,
  createBrowserCaches,
  type DPoPTokenCacheEntry,
  DPoPTokenProvider,
  DynamicRegistrationClientProvider,
  type HttpOptions,
  nonReactiveFetch,
  OidcIdTokenSource,
  ReactiveFetchManager,
  type RefreshSessionRecord,
  SelfIssuedJwtSource,
  SessionFence,
  SolidUmaTokenProvider,
  sameIssuer,
  type TokenProvider,
  WebIdIssuerProvider,
  XASProvider,
} from "@jeswr/reactive-authentication";
import { createBoundary } from "./boundary.js";
import { protectStore, scopedStore } from "./kv.js";
import { createLwsProvider } from "./lws-provider.js";
import { secureUrl } from "./options.js";
import { memoryStore, sessionStorage } from "./sessions.js";
import type { CidSubject, Identity, KvStore, LoginHint, PodAuthOptions } from "./types.js";

export type AgentPolicy = Pick<
  PodAuthOptions,
  "boundary" | "allowInsecureLoopback" | "clock" | "maxReplayBodyBytes"
> & {
  fetch?: typeof fetch;
};
export type AgentConfiguration =
  | { kind: "cid"; cid: CidSubject }
  | { kind: "client-credentials"; issuer: string; clientId: string; clientSecret: string };

/** Node agent composition uses the same transport, boundary and generation fences as browser auth. */
export function createAgentProviders(
  policy: AgentPolicy,
  config: AgentConfiguration,
  hooks: { challenge(url: string): void; session(signal: AbortSignal): void },
) {
  const transport = policy.fetch ?? nonReactiveFetch();
  const http: HttpOptions = {
    allowInsecureRequests: policy.allowInsecureLoopback === true,
    fetch: (input, init) => {
      const request = new Request(input, init);
      secureUrl(request.url, policy.allowInsecureLoopback === true, "protocol endpoint");
      return transport(request);
    },
  };
  const boundary = createBoundary(policy, http);
  const fence = new SessionFence(`pod-auth-agent:${crypto.randomUUID()}`, { broadcast: false });
  let provider: TokenProvider;
  let prepare: (signal: AbortSignal) => Promise<void>;
  let identity: Omit<Identity, "storages">;
  if (config.kind === "cid") {
    const cid = { ...config.cid };
    const source = new SelfIssuedJwtSource({
      subject: cid.documentUrl,
      keyId: cid.keyId,
      privateKey: cid.privateKey!,
      algorithm: "ES256",
    });
    // Validate the published authentication method and prove possession before publishing an identity
    // or releasing a subject credential. Never fetch a remote JSON-LD context or follow redirects.
    let resolved: Promise<void> | undefined;
    prepare = async (signal) => {
      signal.throwIfAborted();
      // Resolution belongs to the session; individual callers only cancel their own wait.
      const resolutionSignal = fence.signal;
      resolved ??= (async () => {
        const response = await http.fetch!(cid.documentUrl, {
          headers: { accept: "application/cid, application/ld+json" },
          credentials: "omit",
          redirect: "error",
          signal: resolutionSignal,
        });
        if (!response.ok || response.redirected) throw new Error("CID document resolution failed");
        const document = await response.json();
        resolutionSignal.throwIfAborted();
        const authentication: unknown[] = Array.isArray(document?.authentication)
          ? document.authentication
          : [];
        const methods: Record<string, unknown>[] = [
          ...(Array.isArray(document?.verificationMethod) ? document.verificationMethod : []),
          ...authentication,
        ].filter((method: Record<string, unknown> | null) => method?.id === cid.keyId);
        const method = methods[0];
        if (
          document?.id !== cid.documentUrl ||
          methods.length !== 1 ||
          method?.type !== "JsonWebKey" ||
          method.controller !== cid.documentUrl ||
          !(authentication.includes(cid.keyId) || authentication.includes(method)) ||
          !method.publicKeyJwk ||
          typeof method.publicKeyJwk !== "object" ||
          "d" in method.publicKeyJwk
        )
          throw new Error("CID authentication method could not be resolved");
        const publicKey = await crypto.subtle.importKey(
          "jwk",
          method.publicKeyJwk,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"],
        );
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const signature = await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          cid.privateKey!,
          challenge,
        );
        if (
          !(await crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            publicKey,
            signature,
            challenge,
          ))
        )
          throw new Error("CID signing key does not match the published authentication method");
        resolutionSignal.throwIfAborted();
      })();
      // Handle failures even when all waiters leave; a late failure must not evict a newer session.
      const pending = resolved;
      pending.catch(() => {
        if (resolved === pending) resolved = undefined;
      });
      signal.throwIfAborted();
      let onAbort!: () => void;
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
      });
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        await Promise.race([pending, aborted]);
        signal.throwIfAborted();
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    };
    provider = createLwsProvider(
      {
        id: source.id,
        fence,
        getCredential: async (request) => {
          await prepare(request.signal);
          const credential = await source.getCredential(request);
          request.signal.throwIfAborted();
          return credential;
        },
        forget: async () => {
          resolved = undefined;
        },
      },
      boundary,
      fence,
    );
    identity = {
      webId: null,
      issuer: cid.documentUrl,
      subject: cid.documentUrl,
      clientId: cid.documentUrl,
      protocol: "lws",
    };
  } else {
    const discovered = new CachingAuthorizationServerProvider(
      new XASProvider({ getIssuer: async () => new URL(config.issuer) }, http),
    );
    const as = {
      getAuthorizationServer: async (request: Request) => {
        const metadata = await discovered.getAuthorizationServer(request);
        if (
          metadata.dpop_signing_alg_values_supported !== undefined &&
          !metadata.dpop_signing_alg_values_supported.includes("ES256")
        )
          throw new Error("The issuer must support ES256 DPoP");
        return { ...metadata, dpop_signing_alg_values_supported: ["ES256"] };
      },
    };
    provider = new ClientCredentialsTokenProvider(as, config.clientId, config.clientSecret, {
      http,
      fence,
    });
    prepare = async (signal) => {
      const root = boundary.roots()[0]!;
      await provider.upgrade(new Request(root, { signal }));
    };
    identity = {
      webId: null,
      issuer: config.issuer,
      subject: config.clientId,
      clientId: config.clientId,
      protocol: "solid-oidc",
    };
  }
  const observed: TokenProvider = {
    fence,
    matches: async (request, challenge) => {
      if (
        config.kind === "client-credentials" &&
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
      hooks.session(upgraded.signal);
      return upgraded;
    },
    invalidate: async (request, challenge) => await provider.invalidate!(request, challenge),
    forget: async () => await provider.forget!(),
  };
  return {
    boundary,
    identity,
    manager: new ReactiveFetchManager({
      ...(policy.maxReplayBodyBytes === undefined
        ? {}
        : { maxReplayBodyBytes: policy.maxReplayBodyBytes }),
      providers: [observed],
      boundary,
      fetch: transport,
      fence,
    }),
    login: async () => {
      const initial = fence.signal;
      const generation = await fence.generation();
      const signal = AbortSignal.any([initial, fence.signalFor(generation)]);
      await prepare(signal);
      hooks.session(signal);
    },
  };
}

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
    session(
      request: Request,
      claims: Claims,
      protocol: "solid-oidc" | "lws",
      selected: LoginHint,
    ): Promise<void>;
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
  const native = options.nativeRedirect === true;
  const redirectUri = options.redirectUri;
  // Login only selects an account/context and upgrades in memory; this URL is never fetched.
  // A private-use callback has no resource origin. Use a dedicated HTTPS URL on the validated
  // Client ID Document's origin for native bootstrap contexts and DPoP proofs instead. This
  // synthetic URL grants no boundary root; the first verified storage inherits its session.
  const bootstrapUri = native
    ? new URL("/.well-known/pod-auth/native-bootstrap", options.clientId as string).href
    : redirectUri;
  // The redirect remains a configuration discriminator, never a native resource context.
  const namespace = JSON.stringify(["pod-auth", options.clientId, redirectUri]);
  const browser =
    options.storage === undefined && typeof indexedDB !== "undefined"
      ? createBrowserCaches(namespace, { persistSessions: true, wrapFenceStore: protectStore })
      : undefined;
  const persistence = sessionStorage(
    options.storage?.sessions ?? browser?.sessions ?? memoryStore(),
    namespace,
    options,
  );
  const fence =
    options.storage === undefined
      ? (browser?.fence ?? new SessionFence(namespace, { broadcast: false }))
      : new SessionFence(namespace, {
          store: protectStore(
            scopedStore<number>(options.storage.sessions, "pod-auth:fence:" + namespace),
          ),
        });
  const metadata = <T extends {}>(name: string, fallback?: KvStore<T>) => {
    const store =
      options.storage === undefined
        ? fallback
        : scopedStore<T>(options.storage.caches, namespace + ":" + name);
    return store === undefined ? undefined : protectStore(store);
  };
  let hint: LoginHint = {};
  let restoredContext: { selected: LoginHint; context: string } | undefined;
  // Login before storage discovery keys its grant to the bootstrap URL; that grant belongs to the
  // first verified storage root, the context login would have used had the roots been known.
  let loginContext: { selected: LoginHint; context: string; root: string } | undefined;
  let sessionRequest: Request | undefined;
  const selections = new Map<string, Promise<LoginHint>>();
  const requestSelections = new WeakMap<Request, Promise<LoginHint>>();
  const selectionFor = (request: Request, selected = hint) => {
    let selection = requestSelections.get(request);
    if (selection === undefined) {
      selection = (async () => {
        const key = JSON.stringify([await boundary.contextKey(request), selected]);
        let pending = selections.get(key);
        if (pending === undefined) {
          pending = (async () =>
            selected.webId !== undefined || selected.issuer !== undefined
              ? selected
              : {
                  webId: secureUrl(await untilAborted(options.ui.getWebId()), insecure, "WebID")
                    .href,
                })();
          selections.set(key, pending);
          pending.catch(() => selections.delete(key));
        }
        return await pending;
      })();
      // Issuer discovery and the session lookup must retain one selection across later login hints.
      requestSelections.set(request, selection);
      // LWS bindings retain the original request; allow its picker to reopen after a failure.
      selection.catch(() => requestSelections.delete(request));
    }
    return selection;
  };
  const contextFor = async (request: Request, selected: LoginHint) => {
    const selection = JSON.stringify(selected);
    if (restoredContext !== undefined && selection === JSON.stringify(restoredContext.selected))
      return restoredContext.context;
    const key = await boundary.contextKey(request);
    if (
      loginContext !== undefined &&
      selection === JSON.stringify(loginContext.selected) &&
      key === loginContext.root
    )
      return loginContext.context;
    return JSON.stringify([key, selected.webId ?? null, selected.issuer ?? null]);
  };
  const sessionContext: ContextKey = async (request) =>
    await contextFor(request, await selectionFor(request));
  const authorizationServers = new Map<string, CachingAuthorizationServerProvider>();
  const asFor = (selected: LoginHint) => {
    const key = JSON.stringify(selected);
    let provider = authorizationServers.get(key);
    if (provider === undefined) {
      const webIdProvider = new WebIdIssuerProvider(
        async () => secureUrl(selected.webId!, insecure, "WebID"),
        http,
        async (issuers) => {
          let issuer: string;
          if (selected.issuer !== undefined) issuer = selected.issuer;
          else if (issuers.length === 1) issuer = issuers[0]!.href;
          else if (options.ui.chooseIssuer)
            issuer = await untilAborted(options.ui.chooseIssuer(issuers.map((i) => i.href)));
          else throw new AmbiguousIssuerError();
          const result = secureUrl(issuer, insecure, "issuer");
          if (!issuers.some((i) => i.href === result.href))
            throw new Error("Selected issuer is not listed by the WebID");
          return result;
        },
      );
      const context: ContextKey = async (request) => await contextFor(request, selected);
      const issuerProvider = new CachingIssuerProvider(
        // Explicit issuer selections must remain reusable when another storage context misses cache.
        selected.webId === undefined && selected.issuer !== undefined
          ? { getIssuer: async () => new URL(selected.issuer!) }
          : webIdProvider,
        metadata("issuer", browser?.issuer),
        context,
      );
      provider = new CachingAuthorizationServerProvider(
        new XASProvider(issuerProvider, http),
        metadata("as", browser?.authorizationServer),
        context,
      );
      authorizationServers.set(key, provider);
    }
    return provider;
  };
  const es256 = (as: RefreshSessionRecord["authorizationServer"]) => {
    if (
      as.dpop_signing_alg_values_supported !== undefined &&
      !as.dpop_signing_alg_values_supported.includes("ES256")
    )
      throw new Error("The issuer must support ES256 DPoP");
    return { ...as, dpop_signing_alg_values_supported: ["ES256"] };
  };
  const asProvider = {
    getAuthorizationServer: async (
      request: Request,
    ): Promise<RefreshSessionRecord["authorizationServer"]> =>
      es256(await asFor(await selectionFor(request)).getAuthorizationServer(request)),
  };
  // Client registrations can contain secrets and always stay in memory.
  const clientProvider = new CachingClientProvider(
    typeof options.clientId === "string"
      ? new ClientIdClientProvider(new URL(options.clientId), http)
      : new DynamicRegistrationClientProvider(http),
  );
  /** Told when a running login hands an authorization code on to the token exchange. */
  let codeRedeemed: (() => void) | undefined;
  /** The running login's cancellation; UI hooks without a signal of their own are raced against it. */
  let loginSignal: AbortSignal | undefined;
  const untilAborted = <T>(work: Promise<T>): Promise<T> => {
    const signal = loginSignal;
    if (signal === undefined) return work;
    work.catch(() => undefined); // an abort wins; the hook's late outcome is dropped
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  };
  const codeProvider: CodeProvider = {
    getCode: async (url, signal) => {
      secureUrl(url.href, insecure, "authorization endpoint");
      const value = await options.ui.getCode(url, signal);
      signal.throwIfAborted();
      // Private-use schemes all have origin "null". Supplement the engine's origin/path check
      // with an exact callback base, including scheme and absence of authority. State, issuer,
      // fragment and code validation remain with the protocol engine.
      if (native && value.split("?", 1)[0] !== redirectUri)
        throw new Error("Authorization response did not arrive at the native redirect URI");
      // From here a grant may be stored even if the exchange then observes an abort.
      codeRedeemed?.();
      return {
        value,
        [Symbol.dispose]() {
          /* UI hook owns its popup/redirect cleanup. */
        },
      };
    },
  };
  // Auxiliary resource servers share this exact in-memory grant, never a new authorization.
  const credentialCache = memoryStore<DPoPTokenCacheEntry>();
  const sessionOptions = {
    namespace,
    fence,
    http,
    context: sessionContext,
    scopes: ["openid", "webid"],
    serverQuirks: true,
    verifyWebId: true,
    sessionStore: persistence.sessions,
    preserveRefreshOnFailure: true,
    silentAfterRefreshFailure: true,
    silentFirst: false,
    sessionLock: persistence.lock,
    cache: credentialCache,
  };
  const solidProvider = new DPoPTokenProvider(
    redirectUri,
    codeProvider,
    asProvider,
    clientProvider,
    undefined,
    sessionOptions,
  );
  // Interpose on the shared session read, so the exact ID token selected by UMA is checked before exchange.
  const umaSession = new Proxy(solidProvider.session, {
    get(target, property) {
      if (property === "get")
        return async (...args: Parameters<typeof target.get>) => {
          const entry = await target.get(...args);
          if (entry?.identity === undefined)
            throw new Error("Authentication did not establish an identity");
          const [url, webId, issuer] = JSON.parse(args[1]) as [
            string,
            string | null,
            string | null,
          ];
          await hooks.session(
            new Request(url, { signal: fence.signalFor(entry.generation!) }),
            entry.identity,
            "solid-oidc",
            {
              ...(webId === null ? {} : { webId }),
              ...(issuer === null ? {} : { issuer }),
            },
          );
          return entry;
        };
      // OidcSession's accessors and methods need the original receiver for their private fields.
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const umaProvider = new SolidUmaTokenProvider(
    redirectUri,
    codeProvider,
    asProvider,
    clientProvider,
    {
      ...sessionOptions,
      http: boundary.exchangeHttp,
      session: umaSession,
      trustAuthorizationServer: boundary.trustAuthorizationServer,
    },
  );
  const lwsContexts = new Map<
    string,
    { provider: TokenProvider; validate(signal: AbortSignal): Promise<void> }
  >();
  const lwsRequests = new WeakMap<Request, TokenProvider>();
  const lwsFor = async (request: Request) => {
    // Capture the selected Solid session before any awaits; another upgrade may select a new one.
    const target = sessionRequest ?? request;
    const selectedHint = hint;
    const key = JSON.stringify([namespace, await boundary.contextKey(target), selectedHint]);
    let binding = lwsContexts.get(key);
    if (binding === undefined) {
      let credentialContext: { oidc: OidcIdTokenSource; selected: LoginHint } | undefined;
      const getOidc = async (signal: AbortSignal) => {
        if (credentialContext === undefined) {
          // Defer the picker until LWS has verified its challenge and authorization server.
          const selected = await selectionFor(target, selectedHint);
          const context = await contextFor(target, selected);
          const as = es256(
            await asFor(selected).getAuthorizationServer(new Request(target.url, { signal })),
          );
          const oidc = new OidcIdTokenSource(as, redirectUri, codeProvider, clientProvider, {
            ...sessionOptions,
            session: solidProvider.session,
            context,
          });
          credentialContext = { oidc, selected };
        }
        return credentialContext;
      };
      const validate = async (signal: AbortSignal) => {
        const { oidc, selected } = await getOidc(signal);
        const claims = await oidc.identity();
        if (claims === undefined) throw new Error("Authentication did not establish an identity");
        await hooks.session(new Request(target.url, { signal }), claims, "lws", selected);
        sessionRequest = target;
      };
      const source: CredentialSource = {
        id: key,
        fence,
        getCredential: async (request: CredentialRequest) => {
          const { oidc } = await getOidc(request.signal);
          const credential = await oidc.getCredential(request);
          // Validate the identity of this exact credential context before it leaves the source.
          await validate(request.signal);
          return credential;
        },
      };
      binding = {
        provider: createLwsProvider(source, boundary, fence),
        validate,
      };
      lwsContexts.set(key, binding);
    }
    return binding;
  };
  const lwsProvider: TokenProvider = {
    fence,
    matches: async (request, challenge) =>
      await (await lwsFor(request)).provider.matches(request, challenge),
    upgrade: async (request, challenge) => {
      const { provider, validate } = await lwsFor(request);
      const upgraded = await provider.upgrade(request, challenge);
      // Cached tokens also use their original credential context, never the latest sessionRequest.
      await validate(request.signal);
      lwsRequests.set(upgraded, provider);
      return upgraded;
    },
    invalidate: async (request, challenge) =>
      await lwsRequests.get(request)!.invalidate!(request, challenge),
    forget: async () => {
      await Promise.all([...lwsContexts.values()].map(({ provider }) => provider.forget!()));
      lwsContexts.clear();
    },
  };
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
      // UMA performs its trust check before resolving the selected account or requesting credentials.
      const attemptHint = hint;
      const selected = solid ? await selectionFor(request) : undefined;
      const upgraded = await provider.upgrade(request, challenge);
      if (solid && hint !== attemptHint)
        throw new Error("Login selection changed during authentication");
      const claims = await solidProvider.identity(request);
      if (claims === undefined) throw new Error("Authentication did not establish an identity");
      await hooks.session(request, claims, protocol, selected ?? (await selectionFor(request)));
      sessionRequest = request;
      return upgraded;
    },
    invalidate: async (request, challenge) => await provider.invalidate!(request, challenge),
    forget: async () => await provider.forget!(),
  });
  const manager = new ReactiveFetchManager({
    ...(options.maxReplayBodyBytes === undefined
      ? {}
      : { maxReplayBodyBytes: options.maxReplayBodyBytes }),
    providers: [
      observe(solidProvider, "solid-oidc", true),
      observe(umaProvider, "solid-oidc"),
      {
        ...lwsProvider,
        matches: async (request, challenge) => {
          if (!(await lwsProvider.matches(request, challenge))) return false;
          hooks.challenge(request.url);
          return true;
        },
      },
    ],
    boundary,
    fetch: transport,
    fence,
  });
  return {
    manager,
    boundary,
    solidProvider,
    persistence,
    contextFor,
    fence,
    fetchFor: (origins: readonly string[], account: Identity, assertSession: () => void) => {
      if (
        account.protocol !== "solid-oidc" ||
        account.webId === null ||
        sessionRequest === undefined
      )
        throw new Error("Extra resource origins require a Solid-OIDC account");
      const target = sessionRequest;
      const selected = { ...hint };
      const context = contextFor(target, selected);
      const resources = new CredentialBoundary(origins.map((origin) => `${origin}/`));
      const provider = new DPoPTokenProvider(
        redirectUri,
        {
          getCode: async () => {
            throw new Error("Account session is unavailable");
          },
        },
        {
          getAuthorizationServer: async (request) =>
            es256(
              await asFor(selected).getAuthorizationServer(
                new Request(target.url, { signal: request.signal }),
              ),
            ),
        },
        clientProvider,
        undefined,
        { ...sessionOptions, context: async () => await context, silentAfterRefreshFailure: false },
      );
      const assertIdentity = async (request: Request) => {
        const identity = await provider.identity(request);
        assertSession();
        if (
          identity?.webId !== account.webId ||
          identity.issuer !== account.issuer ||
          identity.subject !== account.subject ||
          (identity.clientId ?? null) !== account.clientId
        )
          throw new Error("Account session is unavailable");
      };
      const scoped = new ReactiveFetchManager({
        ...(options.maxReplayBodyBytes === undefined
          ? {}
          : { maxReplayBodyBytes: options.maxReplayBodyBytes }),
        boundary: resources,
        fetch: transport,
        fence,
        providers: [
          {
            fence,
            // Reuse the normal Solid-only matcher (including exchange rejection and observation).
            matches: observe(provider, "solid-oidc", true).matches,
            upgrade: async (request, challenge) => {
              assertSession();
              // Inspect claims without starting a flow, then recheck after any refresh.
              await assertIdentity(request);
              const upgraded = await provider.upgrade(request, challenge);
              await assertIdentity(request);
              return upgraded;
            },
            invalidate: async (request) => await provider.invalidate(request),
            assertAllowed: assertSession,
          },
        ],
      });
      return async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body;
        const request = new Request(input, init);
        const replay = body instanceof Blob ? { body } : undefined;
        // Keep normal pod routing. Auxiliary servers refuse every redirect, including before a 401,
        // so application-supplied headers such as Installation-Proof cannot cross origins either.
        if (!resources.allows(request.url)) return await manager.fetch(request, replay);
        const metadata = await asFor(selected).getAuthorizationServer(
          new Request(target.url, { signal: request.signal }),
        );
        assertSession();
        const destination = new URL(request.url);
        // Credential endpoints are protocol-only, even when explicitly admitting their origin.
        // Ignore query/fragment so an endpoint cannot be reclassified by adding a parameter.
        if (
          [metadata.token_endpoint, metadata.registration_endpoint].some((endpoint) => {
            if (typeof endpoint !== "string") return false;
            const url = new URL(endpoint);
            return url.origin === destination.origin && url.pathname === destination.pathname;
          })
        )
          throw new Error("OIDC credential endpoints cannot be extra resources");
        return await scoped.fetch(
          new Request(request, { redirect: "error", credentials: "omit" }),
          replay,
        );
      };
    },
    restore: async (account: import("./sessions.js").ActiveAccount) => {
      const selected = { ...account.selected, issuer: account.issuer };
      // Pin discovery to the remembered issuer while retaining the original credential key.
      restoredContext = { selected, context: account.context };
      loginContext = undefined;
      hint = selected;
      selections.clear();
      const generation = await fence.generation();
      const request = new Request(account.requestUrl, { signal: fence.signalFor(generation) });
      const claims = await solidProvider.restore(request);
      if (claims === undefined) return undefined;
      if (claims.webId !== account.webId || !sameIssuer(claims.issuer, account.issuer)) {
        await solidProvider.forget();
        throw new Error("Restored identity does not match the remembered account");
      }
      await hooks.session(request, claims, "solid-oidc", selected);
      sessionRequest = request;
      return claims;
    },
    logout: async () => {
      boundary.clear();
      const failures: unknown[] = [];
      // Load the catalog without redeeming a token, so a fresh instance can revoke and purge too.
      try {
        await solidProvider.session.forget(persistence.keys);
      } catch (error) {
        failures.push(error);
      }
      try {
        await manager.logout();
      } catch (error) {
        failures.push(error);
      }
      try {
        await fence.supersede(persistence.clear);
      } catch (error) {
        failures.push(error);
      }
      hint = {};
      restoredContext = undefined;
      loginContext = undefined;
      sessionRequest = undefined;
      selections.clear();
      authorizationServers.clear();
      if (failures.length > 0) throw new AggregateError(failures, "Logout cleanup failed");
    },
    /**
     * `granted` runs once a grant may exist (an authorization code went to the token exchange, or the
     * upgrade completed), so an abandoned login knows it must discard one.
     */
    login: async (value: LoginHint, signal: AbortSignal, granted: () => void = () => {}) => {
      let obtained = false;
      const grant = () => {
        obtained = true;
        granted();
      };
      codeRedeemed = grant;
      loginSignal = signal;
      try {
        await loginAttempt(value, signal, grant);
      } catch (error) {
        // Nothing was granted: forget the abandoned attempt's account choice (memory only).
        if (signal.aborted && !obtained) {
          hint = {};
          selections.clear();
        }
        throw error;
      } finally {
        // Logins are serialized by the caller, so this attempt owns both hooks until it ends.
        codeRedeemed = undefined;
        loginSignal = undefined;
      }
    },
  };
  async function loginAttempt(value: LoginHint, signal: AbortSignal, granted: () => void) {
    restoredContext = undefined;
    loginContext = undefined;
    hint = value;
    selections.clear();
    // A synthetic upgrade obtains a session without sending credentials to a login hint's URL.
    const generation = await fence.generation();
    // Only a login made before any root was known is keyed to the bootstrap URL.
    const bootstrap = boundary.roots().length === 0;
    const request = new Request(boundary.roots()[0] ?? bootstrapUri, {
      signal: AbortSignal.any([signal, fence.signalFor(generation)]),
    });
    request.signal.throwIfAborted();
    const selected = await selectionFor(request);
    const context = await contextFor(request, selected);
    await solidProvider.upgrade(request);
    granted();
    const claims = await solidProvider.identity(request);
    if (claims === undefined) throw new Error("Login did not establish an identity");
    await hooks.session(request, claims, "solid-oidc", selected);
    // hooks.session loaded the verified roots; only the first inherits the login grant.
    const root = boundary.roots()[0];
    if (bootstrap && root !== undefined)
      loginContext = { selected, context, root: await boundary.contextKey(new Request(root)) };
    // Later requests keep the account login selected instead of asking for a WebID again.
    hint = selected;
    sessionRequest = request;
  }
}
