// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Drive's token-free session over the browser extension's storage grant. */
import { type DatasetCore, fetchRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import type { SolidExtensionApi, SolidExtensionGrant } from "./extension-session";
import type { ExtensionPodSession } from "./pod-session";

export const STORAGE_CLASS = "http://www.w3.org/ns/pim/space#Storage";
const NAME_PREDICATES = ["http://xmlns.com/foaf/0.1/name", "http://www.w3.org/2006/vcard/ns#fn"];

export class ExtensionSessionError extends Error {
  override readonly name = "ExtensionSessionError";

  constructor(readonly code: "no-storage" | "not-granted" | "unavailable" | "stale") {
    super(code);
  }
}

export interface ExtensionPodSessionDeps {
  readonly window?: Pick<Window, "addEventListener" | "removeEventListener"> & {
    readonly solid?: SolidExtensionApi;
  };
  readonly fetch?: typeof globalThis.fetch;
  readonly fetchRdf?: (
    url: string,
    options: { fetch: typeof globalThis.fetch },
  ) => Promise<{ dataset: DatasetCore }>;
  /** The provider captures a generation and invalidates it whenever its session changes. */
  readonly generation?: number;
  readonly isCurrent?: (generation: number) => boolean;
  readonly grant?: SolidExtensionGrant;
}

/** An origin binding or another data class never selects Drive's session. */
export function chooseSession(
  grants: readonly SolidExtensionGrant[],
  now = Date.now(),
): SolidExtensionGrant | undefined {
  return grants.find(
    (grant) =>
      grant.dataClass === STORAGE_CLASS &&
      grant.expiresAt > now &&
      grant.modes.includes("read") &&
      grant.modes.includes("write"),
  );
}

function storageUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    const loopback =
      url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost") ||
      url.hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (
      (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search &&
      url.pathname.endsWith("/")
    ) {
      return url;
    }
  } catch {
    // The page API is an untrusted UI hint; ignore unusable targets.
  }
  return undefined;
}

export async function openExtensionSession(
  api: SolidExtensionApi,
  deps: ExtensionPodSessionDeps = {},
): Promise<ExtensionPodSession> {
  if (!api.fetch || !api.webId) throw new ExtensionSessionError("not-granted");
  const webId = api.webId;
  const generation = deps.generation ?? 0;
  const isCurrent = deps.isCurrent ?? (() => true);
  const win = deps.window ?? (window as ExtensionPodSessionDeps["window"] & Window);
  let expiresAt = Number.POSITIVE_INFINITY;
  const assertCurrent = () => {
    if (
      win.solid !== api ||
      win.solid.webId !== webId ||
      !isCurrent(generation) ||
      Date.now() >= expiresAt
    ) {
      throw new ExtensionSessionError("stale");
    }
  };
  // Check rejected awaits too: an account switch always wins over a transport error.
  const checked = async <T>(dispatch: () => Promise<T>): Promise<T> => {
    assertCurrent();
    try {
      return await dispatch();
    } finally {
      assertCurrent();
    }
  };
  assertCurrent();
  let grant = deps.grant;
  if (!grant) {
    const listGrants = api.listGrants;
    if (!listGrants) throw new ExtensionSessionError("unavailable");
    const grants = await checked(() => listGrants.call(api));
    assertCurrent();
    grant = chooseSession(grants);
  }
  if (!grant || !chooseSession([grant])) throw new ExtensionSessionError("not-granted");
  expiresAt = grant.expiresAt;
  const documentUrl = new URL(webId);
  documentUrl.hash = "";
  const candidates = new Set<string>();
  for (const target of grant.targets) {
    if (target.kind !== "container") continue;
    const url = storageUrl(target.url);
    if (url) candidates.add(url.href);
  }
  const ordered = [...candidates].sort();
  const root = ordered.find((url) => new URL(url).origin === documentUrl.origin) ?? ordered[0];
  if (!root) throw new ExtensionSessionError("no-storage");

  let displayName = webId;
  try {
    const pageFetch = deps.fetch ?? globalThis.fetch;
    const publicFetch: typeof fetch = (input, init) =>
      checked(() => pageFetch(input, { ...init, credentials: "omit" }));
    const { dataset } = await checked<{ dataset: DatasetCore }>(() =>
      (deps.fetchRdf ?? fetchRdf)(documentUrl.href, { fetch: publicFetch }),
    );
    assertCurrent();
    const subject = DataFactory.namedNode(webId);
    for (const predicate of NAME_PREDICATES) {
      const name = [...dataset.match(subject, DataFactory.namedNode(predicate))].find(
        ({ object }) => object.termType === "Literal" && object.value.trim(),
      );
      if (name) {
        displayName = name.object.value;
        break;
      }
    }
  } catch {
    // A public profile can be private, offline or malformed; it is only decoration.
    assertCurrent();
  }
  assertCurrent();
  return {
    mode: "extension",
    webId,
    displayName,
    storageUrl: root,
    fetch: async (input, init) => {
      assertCurrent();
      const fetch = api.fetch;
      if (!fetch) throw new ExtensionSessionError("not-granted");
      const response = await checked(() => fetch.call(api, input, init));
      assertCurrent();
      return response;
    },
    subscribe(listener) {
      assertCurrent();
      const onFocus = () => {
        assertCurrent();
        listener(root);
        assertCurrent();
      };
      win.addEventListener("focus", onFocus);
      return () => win.removeEventListener("focus", onFocus);
    },
    async disconnect() {
      assertCurrent();
      const { disconnect, listGrants, revokeGrant } = api;
      if (disconnect) {
        await checked(() => disconnect.call(api));
        assertCurrent();
        return;
      }
      if (!listGrants || !revokeGrant) throw new ExtensionSessionError("unavailable");
      const grants = await checked(() => listGrants.call(api));
      assertCurrent();
      // Sequential dispatch lets a switch during any revocation stop all later ones.
      for (const grant of grants) {
        if (grant.dataClass !== STORAGE_CLASS) continue;
        await checked(() => revokeGrant.call(api, grant.grantId));
        assertCurrent();
      }
    },
  };
}

export async function requestStorageAccess(api: SolidExtensionApi): Promise<boolean> {
  if (!api.requestAccess) throw new ExtensionSessionError("unavailable");
  const { ok } = await api.requestAccess({
    classes: [STORAGE_CLASS],
    modes: ["read", "write"],
    purpose: "Solid Suite",
    duration: "P30D",
  });
  return ok;
}
