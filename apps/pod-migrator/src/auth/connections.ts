// AUTHORED-BY Codex GPT-6
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { normalizePodBase } from "@jeswr/guarded-fetch";
import { createSolidAuth, type SolidAuth, type SolidAuthConfig } from "@jeswr/solid-auth-core";
import { Agent } from "@solid/object";
import { DataFactory } from "n3";

export type ConnectionId = "source" | "target";
export interface ConnectionState {
  status: "restoring" | "signed-out" | "loading" | "choose-storage" | "connected" | "error";
  webId: string | null;
  roots: string[];
  root: string | null;
  error: string | null;
}

export function authConfig(id: ConnectionId, origin: string, base = "/"): SolidAuthConfig {
  const prefix = `pod-migrator:${id}`;
  const redirectUri = new URL(`${base}callback/${id}`, origin).href;
  return {
    callbackUri: redirectUri,
    redirectUri,
    clientId: new URL(`${base}clientid.jsonld`, origin).href,
    dbName: `${prefix}:sessions`,
    rememberedAccountsKey: `${prefix}:remembered`,
    recentAccountsKey: `${prefix}:recent`,
    redirectFlowKey: `${prefix}:redirect-flow`,
    redirectSentinelKey: `${prefix}:redirect-sentinel`,
    patchGlobalFetch: false,
    includeIssuerOrigin: false,
    // Only the authenticated WebID's own origin can serve a private profile.
    includeWebIdOrigin: true,
    allowedOrigins: [],
  };
}

const emptyState = (): ConnectionState => ({
  status: "restoring",
  webId: null,
  roots: [],
  root: null,
  error: null,
});

/** One physical session; swapping UI roles never swaps its storage namespace. */
export class PodConnection {
  readonly id: ConnectionId;
  readonly auth: SolidAuth;
  private state = emptyState();
  private listeners = new Set<() => void>();
  private generation = 0;
  private initialization: Promise<void> | undefined;

  constructor(
    id: ConnectionId,
    auth: SolidAuth,
    private readonly base = "/",
  ) {
    this.id = id;
    this.auth = auth;
  }

  snapshot = (): ConnectionState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(state: ConnectionState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  initialize(url: string): Promise<void> {
    this.initialization ??= this.initializeOnce(url);
    return this.initialization;
  }

  private async initializeOnce(url: string): Promise<void> {
    const generation = ++this.generation;
    try {
      if (
        [`${this.base}callback/${this.id}`, `${this.base}callback/${this.id}/`].includes(
          new URL(url).pathname,
        )
      ) {
        const redirect = await this.auth.handleRedirect(url);
        if (generation !== this.generation) return;
        if (redirect.outcome === "error") throw new Error("Sign-in was not completed. Try again.");
        if (redirect.outcome === "redirecting") return;
        if (redirect.outcome === "completed") {
          await this.readProfile();
          return;
        }
      }
      await this.auth.restore();
      if (generation !== this.generation) return;
      if (this.auth.webId) await this.readProfile();
      else this.publish({ ...emptyState(), status: "signed-out" });
    } catch {
      if (generation === this.generation) {
        this.publish({
          ...emptyState(),
          status: "error",
          error: "Could not restore this sign-in. Please sign in again.",
        });
      }
    }
  }

  async login(value: string, kind: "webid" | "issuer"): Promise<void> {
    const generation = ++this.generation;
    this.publish({ ...emptyState(), status: "loading" });
    try {
      const url = new URL(value.trim());
      if (url.protocol !== "https:" || url.username || url.password) {
        throw new Error(
          "Use an HTTPS WebID or identity provider URL without a username or password.",
        );
      }
      await this.auth.beginRedirectLogin({
        ...(kind === "webid" ? { webId: url.href } : { oidcIssuer: url.href }),
        prompt: "consent",
      });
    } catch {
      if (generation === this.generation) {
        this.publish({
          ...emptyState(),
          status: "error",
          error:
            "Could not start sign-in. Check the URL and try again. If your WebID has several providers, enter your chosen provider URL.",
        });
      }
    }
  }

  async readProfile(): Promise<void> {
    const generation = ++this.generation;
    const webId = this.auth.webId;
    if (!webId) return;
    this.publish({ ...emptyState(), status: "loading", webId });
    try {
      const documentUrl = new URL(webId);
      documentUrl.hash = "";
      if (documentUrl.protocol !== "https:" || documentUrl.username || documentUrl.password) {
        throw new Error("Unsafe WebID");
      }
      // Exact document, string input, no redirects. A public read cannot send cookies.
      const profileFetch =
        (authenticated: boolean): typeof fetch =>
        async (input, init) => {
          if (typeof input !== "string" || new URL(input).href !== documentUrl.href) {
            throw new Error("Profile request outside the authenticated WebID document");
          }
          return (authenticated ? this.auth.authenticatedFetch : this.auth.publicFetch)(input, {
            ...init,
            credentials: "omit",
            redirect: "manual",
          });
        };
      let profile: Awaited<ReturnType<typeof fetchRdf>>;
      try {
        profile = await fetchRdf(documentUrl.href, { fetch: profileFetch(false) });
      } catch (error) {
        if (generation !== this.generation || this.auth.webId !== webId) return;
        if (!(error instanceof RdfFetchError) || (error.status !== 401 && error.status !== 403))
          throw error;
        profile = await fetchRdf(documentUrl.href, { fetch: profileFetch(true) });
      }
      if (generation !== this.generation || this.auth.webId !== webId) return;
      // Bind to the signed-in subject, never an arbitrary profile mainSubject.
      const agent = new Agent(webId, profile.dataset, DataFactory);
      const roots = [...agent.pimStorage].map((root) => {
        const url = new URL(root);
        if (url.protocol !== "https:" || url.search || url.hash)
          throw new Error("Unsafe storage URL");
        return normalizePodBase(root);
      });
      const unique = [...new Set(roots)];
      if (unique.length === 0) throw new Error("No storage roots");
      this.publish({ status: "choose-storage", webId, roots: unique, root: null, error: null });
      if (unique.length === 1 && unique[0]) this.selectStorage(unique[0]);
    } catch {
      if (generation === this.generation && this.auth.webId === webId) {
        this.publish({
          ...emptyState(),
          status: "error",
          webId,
          error:
            "Could not read a safe storage location from your WebID profile. Check its storage links and access, then retry.",
        });
      }
    }
  }

  selectStorage(root: string): void {
    if (
      !this.state.webId ||
      this.auth.webId !== this.state.webId ||
      !this.state.roots.includes(root)
    )
      return;
    if (!this.auth.reArmAllowedOrigins([new URL(root).origin])) {
      this.publish({
        ...this.state,
        status: "error",
        root: null,
        error: "This sign-in cannot access that storage. Sign in again.",
      });
      return;
    }
    this.publish({ ...this.state, status: "connected", root, error: null });
  }

  async logout(): Promise<void> {
    const generation = ++this.generation;
    const previousWebId = this.state.webId;
    this.publish({ ...emptyState(), status: "loading" });
    try {
      await this.auth.logout();
      if (generation === this.generation) this.publish({ ...emptyState(), status: "signed-out" });
    } catch {
      if (generation === this.generation)
        this.publish({
          ...emptyState(),
          status: "error",
          webId: this.auth.webId ?? previousWebId,
          error: "Sign-out could not finish. Try signing out again before switching accounts.",
        });
    }
  }
}

export function createConnections(origin: string, base = "/"): [PodConnection, PodConnection] {
  return ["source", "target"].map((id) => {
    const side = id as ConnectionId;
    return new PodConnection(side, createSolidAuth(authConfig(side, origin, base)), base);
  }) as [PodConnection, PodConnection];
}
