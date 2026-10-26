// AUTHORED-BY Codex GPT-6.1-Sol
import type { CodeProvider } from "../CodeProvider.js";
import type { IssuerProvider } from "../IssuerProvider.js";
import {
  ReactiveAuthenticationClient,
  type ReactiveAuthenticationOptions,
} from "../ReactiveAuthenticationClient.js";
import { ReactiveAuthenticationError } from "../ReactiveAuthenticationError.js";
import type { TokenProvider } from "../TokenProvider.js";
import {
  CANCEL,
  type InteractionKind,
  type InteractionRequest,
  isInteractionReply,
  REQUEST_TYPE,
} from "./messages.js";

export interface WindowBridgeOptions {
  /** How long to wait for a page to answer an interaction request. @defaultValue 5 minutes */
  readonly timeoutMs?: number;
}

/**
 * Lets service-worker providers ask a window for user interaction (authorization popup, issuer choice).
 *
 * {@link forClient} routes to one window client, normally the one whose fetch is being authenticated (see
 * {@link installReactiveAuthentication}); without a client ID, a focused window (else a visible one, else
 * any) is used. Requests use a dedicated MessageChannel, are bounded by a timeout, are cancelled when the
 * signal aborts (also while the client is being looked up), and replies are validated before use.
 */
export class WindowBridge {
  readonly #scope: ServiceWorkerGlobalScope;
  readonly #timeoutMs: number;
  readonly #clientId: string | undefined;

  constructor(
    scope: ServiceWorkerGlobalScope,
    options: WindowBridgeOptions = {},
    clientId?: string,
  ) {
    this.#scope = scope;
    this.#timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
    this.#clientId = clientId;
  }

  /** A bridge that only ever asks the given window client. */
  forClient(clientId: string): WindowBridge {
    return new WindowBridge(this.#scope, { timeoutMs: this.#timeoutMs }, clientId);
  }

  async request(kind: InteractionKind, url: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const client = await this.#pickClient();
    // The lookup is asynchronous: cancellation may have happened meanwhile.
    signal.throwIfAborted();

    const channel = new MessageChannel();
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    let settled = false;
    const finish = (error?: unknown, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      if (error !== undefined) channel.port1.postMessage(CANCEL);
      channel.port1.close();
      error === undefined ? resolve(value!) : reject(error);
    };
    const onAbort = () => finish(signal.reason);
    const timeout = setTimeout(
      () =>
        finish(
          new ReactiveAuthenticationError(
            `No answer from page for ${kind} within ${this.#timeoutMs} ms`,
          ),
        ),
      this.#timeoutMs,
    );

    signal.addEventListener("abort", onAbort, { once: true });
    channel.port1.onmessage = (event) => {
      const reply = event.data;
      if (!isInteractionReply(reply))
        return finish(new ReactiveAuthenticationError("Malformed interaction reply from page"));
      if (reply.ok) return finish(undefined, reply.value);
      const error = new ReactiveAuthenticationError(reply.message);
      error.name = reply.name;
      finish(error);
    };

    try {
      const message: InteractionRequest = { type: REQUEST_TYPE, kind, url };
      client.postMessage(message, [channel.port2]);
    } catch (e) {
      finish(e);
    }
    return await promise;
  }

  async #pickClient(): Promise<Client> {
    if (this.#clientId !== undefined) {
      const client = await this.#scope.clients.get(this.#clientId);
      if (client === undefined)
        throw new ReactiveAuthenticationError("The requesting window is gone");
      return client;
    }
    const windows = (await this.#scope.clients.matchAll({
      type: "window",
    })) as readonly WindowClient[];
    const client =
      windows.find((w) => w.focused) ??
      windows.find((w) => w.visibilityState === "visible") ??
      windows[0];
    if (client === undefined)
      throw new ReactiveAuthenticationError("No window available for user interaction");
    return client;
  }
}

/** A {@link CodeProvider} for service workers: the page's code provider runs the authorization UI. */
export class BridgedCodeProvider implements CodeProvider {
  constructor(private readonly bridge: WindowBridge) {}

  async getCode(
    authorizationUri: URL,
    signal: AbortSignal,
  ): Promise<Disposable & { readonly value: string }> {
    const value = await this.bridge.request("code", authorizationUri.href, signal);
    // The page closes its popup when it answers; nothing to dispose here.
    return { value, [Symbol.dispose]() {} };
  }
}

/** An {@link IssuerProvider} for service workers: the page's issuer provider (e.g. `<idp-picker>`) chooses. */
export class BridgedIssuerProvider implements IssuerProvider {
  constructor(private readonly bridge: WindowBridge) {}

  async getIssuer(request: Request): Promise<URL> {
    return new URL(await this.bridge.request("issuer", request.url, request.signal));
  }
}

export interface ServiceWorkerOptions extends Omit<ReactiveAuthenticationOptions, "providers"> {
  /**
   * Providers, or a factory called once per window client so interactions (popups, issuer pickers) are
   * routed to the tab whose request needs them — e.g. `clientId => [new DPoPTokenProvider(…,
   * new BridgedCodeProvider(bridge.forClient(clientId)), …, {namespace, cache: sharedCache})]`.
   * Per-client providers that share stores and a namespace share sessions (the same account in every
   * tab); give each account its own namespace.
   */
  readonly providers: Iterable<TokenProvider> | ((clientId: string) => Iterable<TokenProvider>);

  /** Also intercept navigations. @defaultValue false */
  readonly navigations?: boolean;
}

/**
 * Intercepts fetches of the worker's clients and answers them with the reactive algorithm.
 *
 * Only requests whose URL is inside the credential boundary are intercepted; everything else (and, by
 * default, navigations) goes to the network untouched. The worker's own `fetch` is not intercepted by
 * itself, so it is the non-reactive transport. Call during the worker's initial script evaluation.
 * With redirect mode `follow`, a browser-hidden redirect becomes a non-cacheable synthetic 300 response
 * with no Location: its target and outcome are unknown, and the request is never repeated. Mode `manual`
 * preserves the opaque response; mode `error` rejects as usual.
 */
export function installReactiveAuthentication(
  scope: ServiceWorkerGlobalScope,
  options: ServiceWorkerOptions,
): (clientId: string) => ReactiveAuthenticationClient {
  const fetch = options.fetch ?? scope.fetch.bind(scope);
  const { providers } = options;
  const shared =
    typeof providers === "function"
      ? undefined
      : new ReactiveAuthenticationClient({ ...options, providers, fetch });
  const perClient = new Map<string, ReactiveAuthenticationClient>();

  const clientFor = (clientId: string): ReactiveAuthenticationClient => {
    if (shared !== undefined) return shared;
    let client = perClient.get(clientId);
    if (client === undefined) {
      client = new ReactiveAuthenticationClient({
        ...options,
        providers: (providers as (id: string) => Iterable<TokenProvider>)(clientId),
        fetch,
      });
      perClient.set(clientId, client);
      void prune(scope, perClient);
    }
    return client;
  };

  scope.addEventListener("fetch", (event) => {
    if (!shouldIntercept(event.request, options)) return;
    event.respondWith(
      clientFor(event.clientId)
        .fetch(event.request)
        .then((response) => {
          // respondWith cannot return an opaqueredirect to a follow-mode request. The hidden target
          // cannot be followed safely; report the redirect without guessing success or replaying it.
          if (response.type === "opaqueredirect" && event.request.redirect === "follow") {
            return new Response(
              "The authenticated request returned a redirect whose target is hidden by the browser. " +
                "The request was not repeated and may have succeeded; check its outcome before retrying.",
              {
                status: 300,
                headers: {
                  "Content-Type": "text/plain; charset=utf-8",
                  "Cache-Control": "no-store",
                },
              },
            );
          }
          return response;
        }),
    );
  });

  return clientFor;
}

/** Drops per-client state of windows that no longer exist. */
async function prune(
  scope: ServiceWorkerGlobalScope,
  perClient: Map<string, unknown>,
): Promise<void> {
  const alive = new Set(
    (await scope.clients.matchAll({ includeUncontrolled: true })).map((c) => c.id),
  );
  for (const id of perClient.keys()) if (!alive.has(id)) perClient.delete(id);
}

export function shouldIntercept(
  request: Request,
  options: Pick<ServiceWorkerOptions, "boundary" | "navigations">,
): boolean {
  if (request.mode === "navigate" && options.navigations !== true) return false;
  // Unknown URLs a discovering boundary may still authorize must reach the reactive algorithm.
  return (
    options.boundary.allows(request.url) || options.boundary.isCandidate?.(request.url) === true
  );
}
