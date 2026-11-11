// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { fetchRdf } from "@jeswr/fetch-rdf";
import {
  AmbiguousIssuerError,
  createPodAuth,
  type GrantOwner,
  type GrantRetirementResult,
  type Identity,
  IssuerNotAuthorizedError,
  type PodAuth,
  type PodAuthOptions,
} from "@jeswr/pod-auth";
import { classifyLoginInput, resolveLoginTarget } from "@jeswr/pod-auth/directory";
import {
  type AuthSessionPlugin,
  createNativeCodeDriver,
  isNativeApp,
  MOBILE_REDIRECT_URI,
} from "@jeswr/suite-native";
import { Agent } from "@solid/object";
import { DataFactory } from "n3";
import { CLIENT_ID_URL } from "@/lib/urls";
import { openSolidLoginPopup, type SolidLoginPopup } from "./solid-popup";
import {
  type SessionBackend,
  SignInError,
  type SignInHint,
  type SignInOptions,
  type SignOutResult,
  type SuiteAccount,
} from "./types";

// Capture before authentication starts. Discovery and display reads never attach credentials.
const pristineFetch = globalThis.fetch.bind(globalThis);
export interface SolidBackendOptions {
  createAuth?: (options: PodAuthOptions) => PodAuth;
  resolveTarget?: typeof resolveLoginTarget;
  publicFetch?: typeof fetch;
  openPopup?: (redirectUri: string) => SolidLoginPopup;
  isNativeApp?: () => boolean;
  loadAuthSessionPlugin?: () => Promise<AuthSessionPlugin>;
  createNativeCodeDriver?: typeof createNativeCodeDriver;
}

async function loadAuthSessionPlugin(): Promise<AuthSessionPlugin> {
  return (await import("@jeswr/suite-native/capacitor")).authSessionPlugin;
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
  if (
    error instanceof Error &&
    ["AbortError", "CodeRequestCancelledError", "UserCancelledError"].includes(error.name)
  )
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
  readonly #native: boolean;
  readonly #listeners = new Set<() => void>();
  #auth: PodAuth | undefined;
  #restoring: Promise<SuiteAccount | null> | undefined;
  #account: SuiteAccount | null = null;
  #identity: Identity | null = null;
  #expired = false;
  #signedOut = false;
  #version = 0;
  #sessionVersion = 0;
  #attempt: AbortController | undefined;
  #authorizing = false;
  #popup: SolidLoginPopup | undefined;
  #nativeDriver: PodAuthOptions["ui"]["getCode"] | undefined;
  #redirectUri = "";
  #insecure = false;

  constructor(options: SolidBackendOptions = {}) {
    this.#options = options;
    this.#native = (options.isNativeApp ?? isNativeApp)();
    const transport = options.publicFetch ?? pristineFetch;
    this.#publicFetch = (input, init) => transport(input, { ...init, credentials: "omit" });
  }

  #core(): PodAuth {
    if (this.#auth) return this.#auth;
    if (typeof location === "undefined") throw new SignInError("unavailable");
    this.#insecure =
      !this.#native && process.env.NODE_ENV !== "production" && isLoopback(location.hostname);
    this.#redirectUri = this.#native
      ? MOBILE_REDIRECT_URI
      : new URL("/auth/callback.html", location.origin).href;
    this.#auth = (this.#options.createAuth ?? createPodAuth)({
      // Native identity stays on the public deployment, independently of the local WebView origin.
      clientId: this.#native
        ? CLIENT_ID_URL
        : this.#insecure
          ? { dynamicRegistration: true }
          : new URL("/.well-known/solid-client-id.jsonld", location.origin).href,
      redirectUri: this.#redirectUri,
      allowInsecureLoopback: this.#insecure,
      // The scheme callback is accepted only with pod-auth's explicit native opt-in.
      ...(this.#native ? { nativeRedirect: true as const } : {}),
      ui: {
        getWebId: async () => {
          throw new SignInError("invalid-url");
        },
        getCode: async (url, signal) => {
          // Restore and background fetch must never open the browser. A refresh that needs
          // authorization ends the shell session; only explicit reauthentication owns the UI.
          if (
            !this.#authorizing ||
            (!this.#native && !this.#popup) ||
            url.searchParams.get("prompt")?.split(/\s+/u).includes("none")
          ) {
            if (this.#account && !this.#attempt) this.#expire();
            throw new SignInError("cancelled");
          }
          if (this.#native) {
            if (!this.#nativeDriver) {
              const plugin = await (this.#options.loadAuthSessionPlugin ?? loadAuthSessionPlugin)();
              this.#nativeDriver = (this.#options.createNativeCodeDriver ?? createNativeCodeDriver)(
                { plugin, redirectUri: this.#redirectUri, returns: "callback" },
              );
            }
            if (signal.aborted || !this.#authorizing) throw new SignInError("cancelled");
            return this.#nativeDriver(url, signal);
          }
          if (!this.#popup) throw new SignInError("cancelled");
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
    if (this.#expired || this.#signedOut) return;
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

  async #retire(
    identity: GrantOwner,
    operation: "sign-out" | "reauthenticate" | "reject-identity",
  ): Promise<GrantRetirementResult> {
    const result = await this.#core().retireIfOwnedBy(identity);
    if (!result.retired) {
      const diagnose =
        result.reason === "missing-grant" || result.reason === "no-grant"
          ? console.warn
          : console.info;
      diagnose("Solid session retirement skipped", { operation, reason: result.reason });
    }
    return result;
  }

  async #rejectIdentity(identity: Identity, started: number, session: number): Promise<never> {
    const currentAttempt = () => started === this.#version && session === this.#sessionVersion;
    if (currentAttempt()) {
      this.#restoring = undefined;
      try {
        // pod-auth compares the exact grant and cleans up under its namespace lock, including
        // across tabs. The rejected snapshot cannot retire a newer sign-in for the same WebID.
        const result = await this.#retire(identity, "reject-identity");
        if (result.retired && currentAttempt()) {
          this.#account = null;
          this.#identity = null;
          this.#expired = false;
          ++this.#sessionVersion;
        }
      } catch {
        // pod-auth attempts local cleanup even if revocation fails. Keep the actionable
        // identity error; failed ownership reads must never trigger unconditional logout.
      }
    }
    throw new SignInError("invalid-identity");
  }

  async #mapAccount(identity: Identity, started: number, session: number): Promise<SuiteAccount> {
    // Never invent a pod from the issuer or WebID path, or silently choose among multiple pods.
    const storageUrl = identity.storages[0];
    if (!identity.webId || !storageUrl || identity.storages.length !== 1)
      return this.#rejectIdentity(identity, started, session);
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
    if (this.#expired || this.#signedOut) return Promise.resolve(null);
    if (this.#restoring) return this.#restoring;
    const restoring = (async () => {
      const started = this.#version;
      const session = this.#sessionVersion;
      const identity = await this.#core().restore();
      if (!identity || started !== this.#version || session !== this.#sessionVersion) return null;
      const account = await this.#mapAccount(identity, started, session);
      if (started !== this.#version || session !== this.#sessionVersion) return null;
      this.#account = account;
      this.#identity = identity;
      this.#expired = false;
      return account;
    })();
    this.#restoring = restoring;
    void restoring.catch(() => {
      if (this.#restoring === restoring) this.#restoring = undefined;
    });
    return restoring;
  }

  /**
   * Returns null only when no session is remembered, so login cannot overwrite another owner.
   * A remembered session is restored and returned without login only when a WebID hint names
   * it exactly. A provider hint cannot identify the account, so it never lands in another
   * account's session, even on a shared issuer; it and any other mismatch are refused.
   */
  async #adoptLiveSession(
    core: PodAuth,
    target: Awaited<ReturnType<typeof resolveLoginTarget>>,
    signal: AbortSignal,
    started: number,
  ): Promise<SuiteAccount | null> {
    const current = (session?: number) => {
      signal.throwIfAborted();
      if (started !== this.#version || (session !== undefined && session !== this.#sessionVersion))
        throw new SignInError("cancelled");
    };
    const matches = (owner: { webId: string | null }) =>
      target.kind === "webid" && owner.webId === target.webId;
    const remembered = await core.remembered();
    current();
    if (remembered.length === 0) return null;
    if (!remembered.every(matches)) throw new SignInError("account-active");
    const session = this.#sessionVersion;
    const identity = await core.restore();
    current(session);
    if (!identity) {
      // The remembered session could not be restored. Login may proceed only once it is gone.
      const remaining = await core.remembered();
      current(session);
      if (remaining.length === 0) return null;
      throw new SignInError("account-active");
    }
    if (!matches(identity)) throw new SignInError("account-active");
    const account = await this.#mapAccount(identity, started, session);
    current(session);
    this.#account = account;
    this.#identity = identity;
    this.#expired = false;
    this.#signedOut = false;
    ++this.#sessionVersion;
    this.#restoring = Promise.resolve(account);
    return account;
  }

  async signIn(hint: SignInHint, options: SignInOptions = {}): Promise<SuiteAccount> {
    const input = "issuer" in hint ? hint.issuer : hint.webId;
    const insecure =
      !this.#native &&
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
      if (!this.#native)
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
        // Retain the accepted grant snapshot even after expiry. Reading current account metadata
        // cannot distinguish a fresh authorization for that same account in another tab.
        const identity = this.#identity ?? { webId: null, issuer: "" };
        const result = await this.#retire(identity, "reauthenticate");
        attempt.signal.throwIfAborted();
        if (started !== this.#version) throw new SignInError("cancelled");
        if (!result.retired) {
          if (result.reason === "owner-changed" || result.reason === "grant-changed")
            throw new SignInError("account-active");
          // No owned grant can be retired. A legacy pointer for another account still blocks
          // switching, but an empty pointer or the expired account itself permits login.
          const remembered = await core.remembered();
          attempt.signal.throwIfAborted();
          if (started !== this.#version) throw new SignInError("cancelled");
          if (
            remembered.some(
              (account) => account.webId !== identity.webId || account.issuer !== identity.issuer,
            )
          )
            throw new SignInError("account-active");
        }
        this.#account = null;
        this.#identity = null;
        this.#expired = false;
        this.#restoring = undefined;
      } else {
        // No account is held, for example after a skipped sign-out. A login would install a new
        // namespace owner and supersede another tab's live session, so adopt or refuse it first.
        const adopted = await this.#adoptLiveSession(core, target, attempt.signal, started);
        if (adopted) return adopted;
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
      const account = await this.#mapAccount(identity, started, session);
      if (started !== this.#version || session !== this.#sessionVersion)
        throw new SignInError("cancelled");
      this.#account = account;
      this.#identity = identity;
      this.#expired = false;
      this.#signedOut = false;
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

  async signOut(account: SuiteAccount): Promise<SignOutResult> {
    if (account.kind !== "solid" || account.id !== accountId(account.webId)) return;
    const identity = this.#identity;
    if (
      identity &&
      (identity.webId !== account.webId || (account.issuer && identity.issuer !== account.issuer))
    )
      return;
    try {
      const result = await this.#retire(
        identity ?? { webId: account.webId, issuer: account.issuer ?? "" },
        "sign-out",
      );
      // Only an ownership change means another tab holds a live session. Without an owned or
      // identified grant there is nothing to report.
      if (
        !result.retired &&
        (result.reason === "owner-changed" || result.reason === "grant-changed")
      )
        return { notice: "Signed out here. A session in another tab may still be active." };
    } finally {
      // The shell row is already removed. Detach this tab even when another tab owns the
      // credentials, and fence all pending work before it can restore the removed account.
      ++this.#version;
      ++this.#sessionVersion;
      this.#attempt?.abort();
      this.#account = null;
      this.#identity = null;
      this.#expired = false;
      this.#signedOut = true;
      this.#restoring = undefined;
    }
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
      if (!usable()) throw new Error("Sign in to continue");
      if (!identity || identity.webId !== account.webId || identity.issuer !== account.issuer) {
        this.#expire();
        throw new Error("Sign in to continue");
      }
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
