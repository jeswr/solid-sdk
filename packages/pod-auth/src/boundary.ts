// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  type ChallengeBinding,
  CredentialBoundary,
  describes,
  type HttpOptions,
  isWithin,
  secureDocumentFetch,
} from "@jeswr/reactive-authentication";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Parser, Store } from "n3";
import { isLoopback, secureUrl } from "./options.js";
import type { PodAuthOptions } from "./types.js";

const PIM = "http://www.w3.org/ns/pim/space#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** Identity assertions authorize roots. Resource responses can only narrow that authority. */
export function createBoundary(
  options: Pick<PodAuthOptions, "boundary" | "allowInsecureLoopback">,
  http: HttpOptions,
) {
  const insecure = options.allowInsecureLoopback === true;
  const eligible = (value: string | URL) => {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || (insecure && url.protocol === "http:" && isLoopback(url))) &&
      (options.boundary?.eligible?.(url) ?? true)
    );
  };
  const fixed = new CredentialBoundary(options.boundary?.roots, { allowInsecureHttp: insecure });
  let automatic = new CredentialBoundary([], { allowInsecureHttp: insecure });
  // Configured server endpoints on a verified storage's origin, mapped to that storage root.
  let endpoints = new Map<string, string>();
  let learnedWebId: string | undefined;
  let learnedSignal: AbortSignal | undefined;
  let epoch = 0;
  const clear = () => {
    ++epoch;
    learnedSignal?.removeEventListener("abort", clear);
    learnedSignal = undefined;
    automatic = new CredentialBoundary([], { allowInsecureHttp: insecure });
    endpoints = new Map();
    learnedWebId = undefined;
  };
  const roots = () => [...new Set([...fixed.entries, ...automatic.entries])];
  const allows = (url: string | URL) =>
    eligible(url) && (fixed.allows(url) || automatic.allows(url));
  // Exchanges may use only origins already vouched for, including configured AS roots.
  const trustsOrigin = (url: string | URL) =>
    roots().some((root) => eligible(root) && new URL(root).origin === new URL(url).origin);
  const add = (boundary: CredentialBoundary, root: string) => {
    try {
      if (eligible(root)) boundary.add(root);
    } catch {
      // Invalid identity assertions never become credential destinations.
    }
  };
  const descriptionRoots = async (storage: string, signal: AbortSignal): Promise<string[]> => {
    try {
      const url = secureUrl(storage, insecure, "storage description");
      const response = await http.fetch!(url, {
        headers: { accept: "application/lws+cid, text/turtle;q=0.9" },
        credentials: "omit",
        redirect: "error",
        signal,
      });
      if (!response.ok || !describes(response, url.href)) return [];
      if (
        response.headers.get("content-type")?.includes("json") ||
        response.headers.get("content-type")?.includes("application/lws+cid")
      ) {
        const document = await response.json();
        const includes = (value: unknown, type: string) =>
          value === type || (Array.isArray(value) && value.includes(type));
        if (document?.id !== storage || !includes(document.type, "Storage")) return [];
        return (Array.isArray(document.service) ? document.service : [])
          .filter((service: { type?: unknown } | null) => includes(service?.type, "StorageRoot"))
          .map((service: { serviceEndpoint?: unknown }) => service.serviceEndpoint)
          .filter((root: unknown): root is string => typeof root === "string");
      }
      const dataset = new Store(new Parser({ baseIRI: storage }).parse(await response.text()));
      return dataset
        .getSubjects(DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${PIM}Storage`), null)
        .filter((subject) => subject.termType === "NamedNode")
        .map((subject) => subject.value);
    } catch {
      return [];
    }
  };
  const trustAuthorizationServer = ({
    authorizationServer,
    resource,
  }: {
    authorizationServer: URL;
    resource: URL;
  }) => allows(resource) && trustsOrigin(authorizationServer);
  const trustLws = async (
    { authorizationServer, realm, resource }: ChallengeBinding,
    signal: AbortSignal,
  ) => {
    signal.throwIfAborted();
    if (!trustAuthorizationServer({ authorizationServer, resource })) return false;
    if (
      (realm.href.endsWith("/") || realm.href === resource.href) &&
      allows(realm) &&
      isWithin(resource, realm)
    )
      return true;
    // A description can identify an audience only inside an existing grant; it cannot add roots.
    if (realm.origin !== resource.origin) return false;
    const descriptions = await descriptionRoots(realm.href, signal);
    signal.throwIfAborted();
    return descriptions.some(
      (root) => root.endsWith("/") && allows(root) && isWithin(resource, root),
    );
  };
  return {
    roots,
    /** Credential roots that are storages, without the configured server endpoints. */
    storages: () => roots().filter((root) => !endpoints.has(root)),
    allows,
    // No response-driven discovery, including ancestor HEADs or self-asserted pim:Storage types.
    isCandidate: (_url: string | URL) => false,
    trustAuthorizationServer,
    trustLws,
    exchangeHttp: {
      ...http,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.method === "POST" && !trustsOrigin(request.url))
          throw new Error("Credential exchange endpoint is not trusted");
        return await http.fetch!(new Request(request, { redirect: "error" }));
      },
    } satisfies HttpOptions,
    learn: async (webId: string | undefined, signal: AbortSignal, lifetime = signal) => {
      if (options.boundary?.automatic === false) return;
      if (webId === undefined) {
        clear();
        return;
      }
      if (learnedWebId === webId) return;
      const started = epoch;
      const { response, url } = await secureDocumentFetch(
        new URL(webId),
        "text/turtle",
        signal,
        http,
      );
      if (!response.ok) throw new Error("WebID storage discovery failed");
      const dataset = new Store(new Parser({ baseIRI: url.href }).parse(await response.text()));
      const agent = new TermWrapper(webId, dataset, DataFactory);
      const storages = SetFrom.subjectPredicate(
        agent,
        `${PIM}storage`,
        NamedNodeAs.string,
        NamedNodeFrom.string,
      );
      const next = new CredentialBoundary([], { allowInsecureHttp: insecure });
      for (const storage of storages) {
        add(next, storage);
        // Solid roots are containers. Non-container identifiers may be LWS/Solid descriptions.
        if (next.allows(storage) && !storage.endsWith("/"))
          for (const root of await descriptionRoots(storage, signal)) add(next, root);
      }
      const nextEndpoints = new Map<string, string>();
      for (const root of [...next.entries])
        for (const path of options.boundary?.storageEndpoints ?? []) {
          const endpoint = new URL(path, root).href;
          if (nextEndpoints.has(endpoint)) continue;
          add(next, endpoint);
          if (next.entries.includes(endpoint)) nextEndpoints.set(endpoint, root);
        }
      signal.throwIfAborted();
      lifetime.throwIfAborted();
      if (started !== epoch) throw new Error("Credential boundary changed during discovery");
      learnedSignal?.removeEventListener("abort", clear);
      automatic = next;
      endpoints = nextEndpoints;
      learnedWebId = webId;
      learnedSignal = lifetime;
      lifetime.addEventListener("abort", clear, { once: true });
    },
    clear,
    contextKey: async (request: Request) => {
      const url = new URL(request.url);
      url.hash = "";
      const best = roots()
        .filter((r) =>
          r.endsWith("/")
            ? isWithin(url, r)
            : new URL(r).origin === url.origin && new URL(r).pathname === url.pathname,
        )
        .sort((a, b) => b.length - a.length)[0];
      // A storage endpoint uses its storage's grant rather than a separate authorization.
      return best === undefined ? url.href : (endpoints.get(best) ?? best);
    },
  };
}
