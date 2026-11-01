// AUTHORED-BY Codex GPT-6.1-Sol
import { resolveLoginInput, type LoginTarget } from "./login-input";
import { loginProfile, restoredIdentity } from "./session-identity";
import type { PodProfile } from "./profile";
import { AmbiguousIssuerError, type WebIdDPoPTokenProvider } from "./webid-token-provider";

/** The provider signed in without stating a WebID. */
export class NoWebIdFromProviderError extends Error {
  constructor(issuer: string) {
    super(`Signed in, but the provider did not state a WebID in the ID token (${issuer}).`);
    this.name = "NoWebIdFromProviderError";
  }
}

type Provider = Pick<WebIdDPoPTokenProvider, "login" | "restoreIssuer" | "forgetIssuer" | "forgetIssuerIfOwned">;
interface SessionEffects {
  provider(): Promise<Provider | null>;
  currentProvider?(): Provider | null;
  openPopup(issuer?: string, expectedWebId?: string): void;
  closePopup(): void;
  authenticating(): void;
  seedIdentity(webId: string): void;
  publish(webId: string, profile: PodProfile, issuer: string, remember: boolean): void;
  failed(): void;
  loggedOut(): void;
  resolveInput?: (input: string) => Promise<LoginTarget>;
  loadProfile?: typeof loginProfile;
}

interface Operation {
  isCurrent(): boolean;
  check(): void;
}

class SupersededOperation extends Error {}

/** Shared sequencing for login, reload and logout, with injectable UI effects. */
export class SessionOperations {
  #generation = 0;
  #activeIssuer?: string;
  readonly #pendingIssuers = new Set<string>();
  readonly #effects: SessionEffects;

  constructor(effects: SessionEffects) { this.#effects = effects; }

  #start(): Operation {
    const generation = ++this.#generation;
    const isCurrent = () => this.#generation === generation;
    return {
      isCurrent,
      check() { if (!isCurrent()) throw new SupersededOperation(); },
    };
  }

  async #run(work: (operation: Operation) => Promise<void>) {
    const operation = this.#start();
    try {
      await work(operation);
      operation.check();
    } catch (error) {
      if (!operation.isCurrent() || error instanceof SupersededOperation) return;
      this.#effects.failed();
      throw error;
    }
  }

  /** Resolve smart input and complete only the latest login attempt. */
  login(input: string, options?: { issuer?: string; silentFirst?: boolean }): Promise<void> {
    return this.#run(async (operation) => {
      if (options?.issuer) this.#pendingIssuers.add(options.issuer);
      this.#effects.openPopup(options?.issuer, options?.issuer === undefined ? undefined : input);
      this.#effects.authenticating();
      const target = await (this.#effects.resolveInput ?? resolveLoginInput)(input);
      operation.check();
      const knownWebId = target.kind === "webid" ? target.webId : undefined;
      let issuer = options?.issuer;
      if (!issuer) {
        if (target.kind === "issuer") issuer = target.issuer;
        else {
          if (target.issuers.length !== 1) throw new AmbiguousIssuerError(target.webId, target.issuers);
          issuer = target.issuers[0];
        }
      }
      await this.#completeLogin(operation, issuer, knownWebId, options?.silentFirst ?? false);
      operation.check();
    });
  }

  /** Start issuer-first login while the caller still has user activation. */
  loginWithIssuer(issuer: string): Promise<void> {
    return this.#run(async (operation) => {
      this.#effects.openPopup(issuer);
      this.#effects.authenticating();
      await this.#completeLogin(operation, issuer);
      operation.check();
    });
  }

  async #completeLogin(
    operation: Operation,
    issuer: string,
    knownWebId?: string,
    silentFirst = false,
  ) {
    this.#pendingIssuers.add(issuer);
    const provider = await this.#effects.provider();
    operation.check();
    if (!provider) throw new Error("Auth is not initialised yet");
    const authenticated = await provider.login(new URL(issuer), { silentFirst, expectedWebId: knownWebId });
    operation.check();
    this.#effects.closePopup();
    const id = authenticated.webId ?? knownWebId;
    if (!id) throw new NoWebIdFromProviderError(issuer);
    const profile = await (this.#effects.loadProfile ?? loginProfile)(
      id, issuer, authenticated.ownership, provider, undefined, operation.isCurrent,
    );
    operation.check();
    this.#activeIssuer = issuer;
    this.#pendingIssuers.delete(issuer);
    this.#effects.seedIdentity(id);
    this.#effects.publish(id, profile, issuer, true);
  }

  /** Validate the identity actually restored before publishing it. */
  restore(remembered: string, rememberedIssuer?: string): Promise<void> {
    return this.#run(async (operation) => {
      if (rememberedIssuer) this.#pendingIssuers.add(rememberedIssuer);
      const provider = await this.#effects.provider();
      operation.check();
      if (!provider) throw new Error("Auth is not initialised yet");
      let issuer = rememberedIssuer;
      if (!issuer) {
        const target = await (this.#effects.resolveInput ?? resolveLoginInput)(remembered);
        operation.check();
        if (target.kind !== "webid" || target.issuers.length !== 1) throw new Error("No unambiguous issuer to restore");
        issuer = target.issuers[0];
      }
      this.#pendingIssuers.add(issuer);
      const restored = await provider.restoreIssuer(new URL(issuer));
      operation.check();
      const id = restoredIdentity(remembered, restored);
      this.#effects.seedIdentity(id);
      const profile = await (this.#effects.loadProfile ?? loginProfile)(
        id, issuer, restored?.ownership, provider, undefined, operation.isCurrent,
      );
      operation.check();
      this.#activeIssuer = issuer;
      this.#pendingIssuers.delete(issuer);
      this.#effects.publish(id, profile, issuer, false);
    });
  }

  /** Forget active and validating issuers immediately; fence deferred cleanup too. */
  logout(): Promise<void> {
    return this.#run(async (operation) => {
      const issuers = new Set(this.#pendingIssuers);
      if (this.#activeIssuer) issuers.add(this.#activeIssuer);
      this.#activeIssuer = undefined;
      this.#pendingIssuers.clear();
      this.#effects.loggedOut();
      let provider = this.#effects.currentProvider?.();
      if (!provider) {
        provider = await this.#effects.provider();
        operation.check();
      }
      if (!provider) return;
      await Promise.all([...issuers].map((issuer) => provider.forgetIssuer(new URL(issuer))));
      operation.check();
    });
  }

  /** Invalidate UI work on unmount without publishing a logout. */
  invalidate(): void { this.#generation++; }
}
