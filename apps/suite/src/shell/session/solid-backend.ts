// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf } from "@jeswr/fetch-rdf";
import {
  AmbiguousIssuerError,
  createPodAuth,
  type Identity,
  IssuerNotAuthorizedError,
  type PodAuth,
  type PodAuthOptions,
} from "@jeswr/pod-auth";
import { classifyLoginInput, resolveLoginTarget } from "@jeswr/pod-auth/directory";
import { Agent } from "@solid/object";
import { DataFactory } from "n3";
import { openSolidLoginPopup, type SolidLoginPopup } from "./solid-popup";
import {
  type SessionBackend,
  SignInError,
  type SignInHint,
  type SignInOptions,
  type SuiteAccount,
} from "./types";

// Capture before authentication starts. Discovery and display reads never attach credentials.
const pristineFetch = globalThis.fetch.bind(globalThis);
interface SolidBackendOptions {
  createAuth?: (options: PodAuthOptions) => PodAuth;
  resolveTarget?: typeof resolveLoginTarget;
  publicFetch?: typeof fetch;
  openPopup?: (redirectUri: string) => SolidLoginPopup;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  );
}
function accountId(webId: string): string {
  return `solid:${webId}`;
}
function signInFailure(error: unknown): SignInError {
  if (error instanceof SignInError) return error;
  if (error instanceof IssuerNotAuthorizedError) return new SignInError("issuer-not-authorized");
  if (error instanceof AmbiguousIssuerError) return new SignInError("ambiguous-issuer");
  if (error instanceof Error && ["AbortError", "CodeRequestCancelledError"].includes(error.name))
    return new SignInError("cancelled");
  return new SignInError("failed");
}

/**
 * One active Solid account until pod-auth exposes isolated account namespaces. Its default
 * persistence and logout fence are shared by client ID/callback; a second core is not isolation.
 * No application code reads or persists credentials. The shell may still hold demo/extension accounts.
 */
export class SolidBackend implements SessionBackend {
  readonly kind = "solid";
  readonly #options: SolidBackendOptions;
  readonly #publicFetch: typeof fetch;
  readonly #listeners = new Set<() => void>();
  #auth: PodAuth | undefined;
  #restoring: Promise<SuiteAccount | null> | undefined;
  #account: SuiteAccount | null = null;
  #expired = false;
  #version = 0;
  #sessionVersion = 0;
  #attempt: AbortController | undefined;
  #authorizing = false;
  #popup: SolidLoginPopup | undefined;
  #redirectUri = "";
  #insecure = false;

  constructor(options: SolidBackendOptions = {}) {
    this.#options = options;
    const transport = options.publicFetch ?? pristineFetch;
    this.#publicFetch = (input, init) => transport(input, { ...init, credentials: "omit" });
  }

  #core(): PodAuth {
    if (this.#auth) return this.#auth;
    if (typeof location === "undefined") throw new SignInError("unavailable");
    this.#insecure = process.env.NODE_ENV !== "production" && isLoopback(location.hostname);
    this.#redirectUri = new URL("/auth/callback.html", location.origin).href;
    this.#auth = (this.#options.createAuth ?? createPodAuth)({
      // Same loopback-only dynamic registration as Drive; reuse the shell's deployed document.
      clientId: this.#insecure
        ? { dynamicRegistration: true }
        : new URL("/.well-known/solid-client-id.jsonld", location.origin).href,
      redirectUri: this.#redirectUri,
      allowInsecureLoopback: this.#insecure,
      ui: {
        getWebId: async () => {
          throw new SignInError("invalid-url");
        },
        getCode: async (url, signal) => {
          // Restore and background fetch must never open interactive windows. A refresh that
          // needs authorization ends the shell session; explicit reauthentication owns a popup.
          if (
            !this.#authorizing ||
            !this.#popup ||
            url.searchParams.get("prompt")?.split(/\s+/u).includes("none")
          ) {
            if (this.#account && !this.#attempt) this.#expire();
            throw new SignInError("cancelled");
          }
          return this.#popup.getCode(url, signal);
        },
      },
    });
    this.#auth.on("expired", () => this.#expire());
    this.#auth.on("logout", () => {
      if (this.#account) this.#expire();
    });
    return this.#auth;
  }

  #expire(): void {
    if (this.#expired) return;
    this.#expired = true;
    this.#restoring = undefined;
    ++this.#sessionVersion;
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        /* Observers cannot interrupt authentication. */
      }
    }
  }

  async #mapAccount(identity: Identity): Promise<SuiteAccount> {
    // Never invent a pod from the issuer or WebID path, or silently choose among multiple pods.
    const storageUrl = identity.storages[0];
    if (!identity.webId || !storageUrl || identity.storages.length !== 1)
      throw new SignInError("invalid-identity");
    const account: SuiteAccount = {
      id: accountId(identity.webId),
      kind: "solid",
      webId: identity.webId,
      issuer: identity.issuer,
      storageUrl,
      name: identity.webId,
    };
    try {
      const { dataset } = await fetchRdf(identity.webId, {
        fetch: this.#publicFetch,
        signal: AbortSignal.timeout(5_000),
        maxBytes: 1_048_576,
      });
      const agent = new Agent(identity.webId, dataset, DataFactory);
      try {
        account.name = agent.name?.trim() || account.name;
      } catch {
        /* Malformed display metadata cannot undo verified authentication. */
      }
      try {
        const photo = agent.photoUrl && new URL(agent.photoUrl);
        if (
          photo &&
          !photo.username &&
          !photo.password &&
          (photo.protocol === "https:" ||
            (this.#insecure && photo.protocol === "http:" && isLoopback(photo.hostname)))
        )
          account.photoUrl = photo.href;
      } catch {
        /* An invalid avatar is optional. */
      }
    } catch {
      /* Verified claims and storage roots remain usable when display metadata is unavailable. */
    }
    return account;
  }

  restore(): Promise<SuiteAccount | null> {
    if (!this.#options.createAuth && typeof window === "undefined") return Promise.resolve(null);
    if (this.#expired) return Promise.resolve(null);
    if (this.#restoring) return this.#restoring;
    const restoring = (async () => {
      const started = this.#version;
      const session = this.#sessionVersion;
      const identity = await this.#core().restore();
      if (!identity || started !== this.#version || session !== this.#sessionVersion) return null;
      const account = await this.#mapAccount(identity);
      if (started !== this.#version || session !== this.#sessionVersion) return null;
      this.#account = account;
      this.#expired = false;
      return account;
    })();
    this.#restoring = restoring;
    void restoring.catch(() => {
      if (this.#restoring === restoring) this.#restoring = undefined;
    });
    return restoring;
  }

  async signIn(hint: SignInHint, options: SignInOptions = {}): Promise<SuiteAccount> {
    const input = "issuer" in hint ? hint.issuer : hint.webId;
    const insecure =
      typeof location !== "undefined" &&
      process.env.NODE_ENV !== "production" &&
      isLoopback(location.hostname);
    if (classifyLoginInput(input, { allowInsecureLoopback: insecure }) === "invalid")
      throw new SignInError("invalid-url");
    if (options.signal?.aborted) throw new SignInError("cancelled");
    if (this.#attempt) throw new SignInError("in-progress");
    const attempt = new AbortController();
    const onAbort = () => {
      attempt.abort(options.signal?.reason);
      const popup = this.#popup;
      this.#popup = undefined;
      popup?.close();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    this.#attempt = attempt;
    const started = this.#version;
    try {
      const core = this.#core();
      this.#popup = (this.#options.openPopup ?? openSolidLoginPopup)(this.#redirectUri);
      // Cancelling this attempt must not cancel or log out the independently restoring session.
      let cancelRestore = () => {};
      const cancelled = new Promise<never>((_resolve, reject) => {
        cancelRestore = () => reject(new SignInError("cancelled"));
        attempt.signal.addEventListener("abort", cancelRestore, { once: true });
        if (attempt.signal.aborted) cancelRestore();
      });
      try {
        await Promise.race([this.restore(), cancelled]);
      } finally {
        attempt.signal.removeEventListener("abort", cancelRestore);
      }
      attempt.signal.throwIfAborted();
      if (started !== this.#version) throw new SignInError("cancelled");
      if (this.#account && !this.#expired) throw new SignInError("account-active");
      let target: Awaited<ReturnType<typeof resolveLoginTarget>>;
      try {
        target = await (this.#options.resolveTarget ?? resolveLoginTarget)(input, {
          fetch: this.#publicFetch,
          signal: AbortSignal.any([attempt.signal, AbortSignal.timeout(15_000)]),
          allowInsecureLoopback: this.#insecure,
        });
      } catch {
        throw new SignInError(attempt.signal.aborted ? "cancelled" : "invalid-url");
      }
      // Preserve the field's meaning: a provider address must resolve to an issuer, and vice versa.
      if ("issuer" in hint ? target.kind !== "issuer" : target.kind !== "webid")
        throw new SignInError("invalid-url");
      attempt.signal.throwIfAborted();
      if (this.#expired) {
        const identity = await core.identity();
        const remembered = await core.remembered();
        const owns = (value: { webId: string | null; issuer: string }) =>
          value.webId === this.#account?.webId && value.issuer === this.#account.issuer;
        // Another tab may already have signed into a newer account under the shared namespace.
        // Reauthentication must not purge that account's grant.
        if (identity ? !owns(identity) : remembered.some((value) => !owns(value)))
          throw new SignInError("account-active");
        attempt.signal.throwIfAborted();
        if (identity || remembered.length) await core.logout();
        this.#account = null;
      }
      attempt.signal.throwIfAborted();
      this.#authorizing = true;
      const identity = await core.login(
        target.kind === "webid" ? { webId: target.webId } : { issuer: target.issuer },
        { signal: attempt.signal },
      );
      // Once pod-auth has committed the grant, cancellation belongs to the completed attempt.
      // Display metadata is best effort and cannot abandon an already committed session.
      options.signal?.removeEventListener("abort", onAbort);
      this.#authorizing = false;
      const session = this.#sessionVersion;
      const account = await this.#mapAccount(identity);
      if (started !== this.#version || session !== this.#sessionVersion)
        throw new SignInError("cancelled");
      this.#account = account;
      this.#expired = false;
      ++this.#sessionVersion;
      this.#restoring = Promise.resolve(account);
      return account;
    } catch (error) {
      throw signInFailure(error);
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      this.#popup?.close();
      this.#popup = undefined;
      this.#attempt = undefined;
      this.#authorizing = false;
    }
  }

  async signOut(account: SuiteAccount): Promise<void> {
    if (account.kind !== "solid" || account.id !== accountId(account.webId)) return;
    const core = this.#core();
    const remembered = await core.remembered();
    const identity = await core.identity();
    const owns = (value: { webId: string | null; issuer: string }) =>
      value.webId === account.webId && (!account.issuer || value.issuer === account.issuer);
    // Signing out a stale remembered shell row cannot purge the active account.
    if (identity ? !owns(identity) : !remembered.some(owns)) return;
    ++this.#version;
    ++this.#sessionVersion;
    this.#attempt?.abort();
    this.#account = null;
    this.#expired = false;
    this.#restoring = undefined;
    await core.logout();
  }

  fetchFor(account: SuiteAccount): typeof fetch {
    const version = this.#sessionVersion;
    const usable = () =>
      !this.#expired &&
      this.#account?.id === account.id &&
      this.#account.webId === account.webId &&
      this.#account.issuer === account.issuer &&
      account.kind === "solid" &&
      version === this.#sessionVersion;
    return async (input, init) => {
      if (!usable()) throw new Error("Sign in to continue");
      const core = this.#core();
      const identity = await core.identity();
      if (!identity || identity.webId !== account.webId || identity.issuer !== account.issuer) {
        this.#expire();
        throw new Error("Sign in to continue");
      }
      if (!usable()) throw new Error("Sign in to continue");
      const response = await core.fetch(input, init);
      if (!usable()) throw new Error("Sign in to continue");
      return response;
    };
  }

  onExpired(cb: () => void): () => void {
    this.#listeners.add(cb);
    return () => {
      this.#listeners.delete(cb);
    };
  }
}
