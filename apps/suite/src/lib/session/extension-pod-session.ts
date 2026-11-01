// AUTHORED-BY Codex GPT-6.1-Sol
/** Drive's token-free session over the browser extension's origin grant. */
import { type DatasetCore, fetchRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import type { SolidExtensionApi, SolidExtensionState } from "./extension-session";
import type { ExtensionPodSession } from "./pod-session";

export const STORAGE_CLASS = "http://www.w3.org/ns/pim/space#Storage";
const STORAGE = "http://www.w3.org/ns/pim/space#storage";
const NAME_PREDICATES = ["http://xmlns.com/foaf/0.1/name", "http://www.w3.org/2006/vcard/ns#fn"];

export class ExtensionSessionError extends Error {
  override readonly name = "ExtensionSessionError";

  constructor(readonly code: "no-storage" | "not-granted" | "unavailable") {
    super(code);
  }
}

export interface ExtensionPodSessionDeps {
  readonly window?: Pick<Window, "addEventListener" | "removeEventListener">;
  readonly fetchRdf?: (
    url: string,
    options: { fetch: typeof globalThis.fetch },
  ) => Promise<{ dataset: DatasetCore }>;
  readonly reload?: () => void;
}

/** Presence alone must never switch Drive away from its demo session. */
export function chooseSession(state: SolidExtensionState): "demo" | "extension" {
  return state.present && state.granted && state.webId ? "extension" : "demo";
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
      !url.hash
    ) {
      return url;
    }
  } catch {
    // Foreign RDF can contain a NamedNode whose value is not a usable URL.
  }
  return undefined;
}

export async function openExtensionSession(
  api: SolidExtensionApi,
  deps: ExtensionPodSessionDeps = {},
): Promise<ExtensionPodSession> {
  if (!api.fetch || !api.webId) throw new ExtensionSessionError("not-granted");
  const webId = api.webId;
  const documentUrl = new URL(webId);
  documentUrl.hash = "";
  const { dataset } = await (deps.fetchRdf ?? fetchRdf)(documentUrl.href, { fetch: api.fetch });
  const subject = DataFactory.namedNode(webId);
  const candidates = new Set<string>();
  for (const { object } of dataset.match(subject, DataFactory.namedNode(STORAGE))) {
    if (object.termType !== "NamedNode") continue;
    const url = storageUrl(object.value);
    if (url) candidates.add(url.href);
  }
  // Prefer this WebID's origin, then lexical URL order, independent of RDF quad order.
  const ordered = [...candidates].sort();
  const preferred = ordered.filter((url) => new URL(url).origin === documentUrl.origin);
  const others = ordered.filter((url) => new URL(url).origin !== documentUrl.origin);
  let root: string | undefined;
  for (const url of [...preferred, ...others]) {
    try {
      // The extension enforces the grant. Refuse redirects rather than accepting
      // an unrelated origin as proof that this advertised storage is reachable.
      const response = await api.fetch(url, { method: "HEAD", redirect: "manual" });
      if (response.ok) {
        root = url;
        break;
      }
    } catch {
      // A stale or unavailable storage must not hide a later reachable one.
    }
  }
  if (!root) throw new ExtensionSessionError("no-storage");
  const storage = root;
  let displayName = webId;
  for (const predicate of NAME_PREDICATES) {
    const name = [...dataset.match(subject, DataFactory.namedNode(predicate))].find(
      ({ object }) => object.termType === "Literal" && object.value.trim(),
    );
    if (name) {
      displayName = name.object.value;
      break;
    }
  }
  return {
    mode: "extension",
    webId,
    displayName,
    storageUrl: storage,
    fetch: async (input, init) => {
      if (!api.fetch) throw new ExtensionSessionError("not-granted");
      return api.fetch(input, init);
    },
    subscribe(listener) {
      const win = deps.window ?? window;
      const onFocus = () => listener(storage);
      win.addEventListener("focus", onFocus);
      return () => win.removeEventListener("focus", onFocus);
    },
    async disconnect() {
      const { listGrants, revokeGrant } = api;
      if (!listGrants || !revokeGrant) throw new ExtensionSessionError("unavailable");
      const grants = await listGrants.call(api);
      await Promise.all(
        grants
          .filter((grant) => grant.dataClass === STORAGE_CLASS)
          .map((grant) => revokeGrant.call(api, grant.grantId)),
      );
      (deps.reload ?? (() => window.location.reload()))();
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
