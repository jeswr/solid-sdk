// AUTHORED-BY GPT-6.1 Sol
import { publicFetch as pristinePublicFetch } from "@jeswr/app-session";
import type { SessionContextValue } from "@jeswr/app-session/react";
import type { PodAuth } from "@jeswr/pod-auth";
import { detectAccessSystem } from "../engine/access.js";
import { createPodHttp } from "../engine/pod-http.js";
import type { AccessSystem, PodSide } from "../engine/types.js";
import { connectionAuth } from "./pod-auth.js";
import { readStorageProfile } from "./profile.js";

export type ConnectionId = "source" | "target";
export interface ConnectionState {
  status: "restoring" | "signed-out" | "loading" | "choose-storage" | "connected" | "error";
  webId: string | null;
  roots: string[];
  root: string | null;
  implementation: PodSide["implementation"];
  accessSystem: AccessSystem;
  error: string | null;
  signingIn?: boolean;
}

/** Only call with the selected authenticated storage and its response header.
 * An issuer identifies the login provider, not the storage implementation.
 * Profile RDF and login/page input are not evidence.
 */
export function detectImplementation(
  root: string,
  poweredBy: string | null,
): PodSide["implementation"] {
  const storage = new URL(root);
  if (storage.protocol !== "https:" || storage.username || storage.password) return undefined;
  if (storage.hostname.endsWith(".inrupt.com") && storage.port === "") return "ess";
  if (/^Community Solid Server(?:\/[^\s,]+)?$/i.test(poweredBy?.trim() ?? "")) return "css";
  if (/^solid-server\/[^\s,]+$/i.test(poweredBy?.trim() ?? "")) return "nss";
  return undefined;
}

const emptyState = (): ConnectionState => ({
  status: "restoring",
  webId: null,
  roots: [],
  root: null,
  implementation: undefined,
  accessSystem: "unknown",
  error: null,
});

/** One physical session; swapping UI roles never swaps its storage namespace. */
export class PodConnection {
  readonly id: ConnectionId;
  private session: SessionContextValue | null = null;
  private state = emptyState();
  private listeners = new Set<() => void>();
  private generation = 0;

  constructor(
    id: ConnectionId,
    readonly getPodAuth: () => Promise<PodAuth>,
    readonly publicFetch: typeof fetch = pristinePublicFetch,
  ) {
    this.id = id;
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

  get fetch(): typeof fetch {
    return this.session?.fetch ?? this.publicFetch;
  }

  /** SessionProvider owns restore/login/events. This adapter owns only migration readiness. */
  async updateSession(session: SessionContextValue): Promise<void> {
    const changed = this.session?.webId !== session.webId || this.fetch !== session.fetch;
    this.session = session;
    if (changed) {
      ++this.generation;
      if (session.webId) {
        return this.readProfile();
      }
    }
    if (!session.webId) {
      const status =
        session.restoringSession || (!session.ready && !session.error) ? "restoring" : "signed-out";
      if (this.state.status !== status || this.state.webId)
        this.publish({ ...emptyState(), status, signingIn: !!session.pending });
    }
    if (this.state.signingIn !== !!session.pending)
      this.publish({ ...this.state, signingIn: !!session.pending });
  }

  async readProfile(): Promise<void> {
    const generation = ++this.generation;
    const webId = this.session?.webId;
    if (!webId) return;
    this.publish({ ...emptyState(), status: "loading", webId });
    try {
      const unique = await readStorageProfile(
        webId,
        this.publicFetch,
        this.fetch,
        () => generation === this.generation && this.session?.webId === webId,
      );
      if (generation !== this.generation || this.session?.webId !== webId) return;
      if (unique.length === 0) throw new Error("No storage roots");
      this.publish({ ...emptyState(), status: "choose-storage", webId, roots: unique });
      if (unique.length === 1 && unique[0]) await this.selectStorage(unique[0]);
    } catch {
      if (generation === this.generation && this.session?.webId === webId) {
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

  async selectStorage(root: string): Promise<void> {
    if (
      !this.state.webId ||
      this.session?.webId !== this.state.webId ||
      !this.state.roots.includes(root)
    )
      return;
    const generation = ++this.generation;
    const webId = this.state.webId;
    this.publish({
      ...this.state,
      status: "loading",
      root: null,
      implementation: undefined,
      accessSystem: "unknown",
      error: null,
    });
    const authenticatedFetch = this.fetch;
    const http = createPodHttp({
      root,
      fetch: (input, init) => authenticatedFetch(input, { ...init, credentials: "omit" }),
    });
    const signal = AbortSignal.timeout(10_000);
    let implementation = detectImplementation(root, null);
    let accessSystem: AccessSystem = "unknown";
    try {
      const head = await http.head(root, { signal });
      if (generation !== this.generation || this.session?.webId !== webId) return;
      if (head.ok) implementation ??= detectImplementation(root, head.headers.get("x-powered-by"));
      if (!implementation && (head.ok || head.status === 405 || head.status === 501)) {
        const response = await http.get(root, { signal });
        if (response.ok)
          implementation = detectImplementation(root, response.headers.get("x-powered-by"));
        await response.body?.cancel();
      }
      if (generation !== this.generation || this.session?.webId !== webId) return;
      accessSystem = await detectAccessSystem(
        { root, ownerWebId: webId, implementation, http },
        signal,
      );
    } catch {
      // Missing CORS exposure, errors and redirects supply no header evidence.
      // Storage host evidence is retained; the engine still checks permissions.
    }
    if (generation !== this.generation || this.session?.webId !== webId) return;
    this.publish({ ...this.state, status: "connected", root, implementation, accessSystem });
  }

  async logout(): Promise<void> {
    ++this.generation;
    const session = this.session;
    this.session = null;
    this.publish({ ...emptyState(), status: "signed-out" });
    await session?.logout();
  }
}

export function createConnections(origin: string, base = "/"): [PodConnection, PodConnection] {
  return [
    new PodConnection("source", connectionAuth("source", origin, base)),
    new PodConnection("target", connectionAuth("target", origin, base)),
  ];
}
