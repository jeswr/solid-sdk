// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Drive's token-free session over the browser extension's storage grant. */
import { type DatasetCore, fetchRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { boundedRead } from "./bounded-read";
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
  readonly window?: Pick<
    Window,
    "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout"
  > & {
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
  readonly signal?: AbortSignal;
}

export function isLiveStorageGrant(grant: SolidExtensionGrant, now: number): boolean {
  return (
    grant.dataClass === STORAGE_CLASS &&
    grant.expiresAt > now &&
    grant.modes.includes("read") &&
    grant.modes.includes("write")
  );
}

/** Empty or unusable old grants must not shadow a later, usable consent. */
export function chooseSession(
  grants: readonly SolidExtensionGrant[],
  now = Date.now(),
): SolidExtensionGrant | undefined {
  return grants.find(
    (grant) =>
      isLiveStorageGrant(grant, now) &&
      grant.targets.some((target) => target.kind === "container" && storageUrl(target.url)),
  );
}

function storageUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
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
  const isSessionCurrent = () =>
    win.solid === api &&
    win.solid.webId === webId &&
    isCurrent(generation) &&
    Date.now() < expiresAt;
  const assertCurrent = () => {
    if (!isSessionCurrent()) throw new ExtensionSessionError("stale");
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
    const grants = await checked(() =>
      boundedRead(() => listGrants.call(api), 5000, deps.signal, win),
    );
    assertCurrent();
    grant = chooseSession(grants);
    if (!grant && grants.some((candidate) => isLiveStorageGrant(candidate, Date.now())))
      throw new ExtensionSessionError("no-storage");
  }
  if (!grant || !isLiveStorageGrant(grant, Date.now()))
    throw new ExtensionSessionError("not-granted");
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

  const pageFetch = deps.fetch ?? globalThis.fetch;
  // inject.ts leaves Request inputs on the page's native fetch path. Using a string here
  // would enter its transparency patch even with credentials:"omit".
  const publicFetch: typeof fetch = (input, init) =>
    checked(() => pageFetch(new Request(input, { ...init, credentials: "omit" })));
  let displayName = webId;
  try {
    const { dataset } = await checked<{ dataset: DatasetCore }>(() =>
      boundedRead<{ dataset: DatasetCore }>(
        () => (deps.fetchRdf ?? fetchRdf)(documentUrl.href, { fetch: publicFetch }),
        3000,
        deps.signal,
        win,
      ),
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
    publicFetch,
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
        if (isSessionCurrent()) listener(root);
      };
      win.addEventListener("focus", onFocus);
      return () => win.removeEventListener("focus", onFocus);
    },
    async disconnect() {
      assertCurrent();
      const { disconnect, listGrants, revokeGrant } = api;
      if (disconnect) {
        assertCurrent();
        // Successful self-revocation may broadcast and invalidate us before its reply.
        if ((await disconnect.call(api)) !== true) {
          assertCurrent();
          throw new Error("The extension did not acknowledge disconnect.");
        }
        return;
      }
      if (!listGrants || !revokeGrant) throw new ExtensionSessionError("unavailable");
      const grants = await checked(() =>
        boundedRead(() => listGrants.call(api), 5000, deps.signal, win),
      );
      assertCurrent();
      // Sequential dispatch lets a switch during any revocation stop all later ones.
      for (const grant of grants) {
        if (grant.dataClass !== STORAGE_CLASS) continue;
        assertCurrent();
        if ((await revokeGrant.call(api, grant.grantId)) !== true) {
          assertCurrent();
          throw new Error("The extension did not acknowledge disconnect.");
        }
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
